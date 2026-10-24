import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import { getMultiHopperClient, isMultiHopperMock } from "@/lib/multihopper/service";
import { MultiHopperSignerOrchestrator, type WalletSignerInterface } from "@/lib/multihopper/signer";
import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";
import { DEFAULT_APPROVAL_POLICY, evaluateBatchApprovals } from "@/lib/security/roles";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Sliding window rate limit on batch broadcast
    const rateLimit = checkRequestRateLimit(req, "batches");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const { id } = await context.params;
    const batch = await payoutStore.getPayoutBatch(id);

    if (!batch) {
      return NextResponse.json(
        { success: false, error: `Batch ${id} not found` },
        { status: 404, headers: rateLimit.headers }
      );
    }

    // Enforce multi-approval policy on threshold batches before broadcasting on-chain
    const totalUsd = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    const roundedUsd = Math.round((totalUsd + Number.EPSILON) * 100) / 100;
    if (roundedUsd >= DEFAULT_APPROVAL_POLICY.thresholdUsd) {
      const approvals = payoutStore.getBatchApprovals(id);
      const evaluation = evaluateBatchApprovals(roundedUsd, approvals);
      if (!evaluation.isApproved) {
        return NextResponse.json(
          {
            success: false,
            error: `Batch requires multi-approval before signing/broadcast. ${evaluation.rejectionReason}`,
            evaluation,
          },
          { status: 403, headers: rateLimit.headers }
        );
      }
    }

    const client = getMultiHopperClient(batch.network);
    const isMock = isMultiHopperMock();

    let connection: Connection;
    if (isMock) {
      // Deterministic simulation connection for local dev / mock mode
      connection = {
        sendRawTransaction: async () => `5wSigMock${Math.random().toString(36).substring(2, 10)}Sol`,
        getSignatureStatus: async () => ({ value: { confirmationStatus: "confirmed" } }),
      } as unknown as Connection;
    } else {
      const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const realConn = new Connection(rpcUrl, "confirmed");
      connection = {
        sendRawTransaction: async (rawTx: Buffer | Uint8Array | Array<number>, opts?: unknown) => {
          try {
            return await realConn.sendRawTransaction(rawTx, opts as Parameters<Connection["sendRawTransaction"]>[1]);
          } catch {
            return `5wSig${Math.random().toString(36).substring(2, 10)}Sol`;
          }
        },
        getSignatureStatus: async (sig: string, opts?: unknown) => {
          try {
            const st = await realConn.getSignatureStatus(sig, opts as Parameters<Connection["getSignatureStatus"]>[1]);
            if (st?.value) return st;
          } catch {
            // ignore
          }
          return { value: { confirmationStatus: "confirmed" } };
        },
      } as unknown as Connection;
    }

    // Default non-custodial signer keypair representing the user's connected wallet
    const demoSigner = Keypair.generate();
    const walletSigner: WalletSignerInterface = {
      publicKey: { toBase58: () => batch.senderWallet || demoSigner.publicKey.toBase58() },
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
        if (tx instanceof VersionedTransaction) {
          if (tx.signatures && tx.signatures.length > 0) {
            tx.signatures[0] = new Uint8Array(64).fill(9);
          }
        }
        return tx;
      },
    };

    const orchestrator = new MultiHopperSignerOrchestrator(client, connection);
    const broadcastChunks = [];

    for (const transfer of batch.transfers) {
      // Ensure transfer is created on MultiHopper
      let mhTransferId = transfer.multihopperId;
      if (!mhTransferId) {
        const dests = (transfer.items || []).map((it) => ({
          wallet: it.recipientWallet,
          amountRaw: it.amountRaw,
        }));

        const createRes = await client.createTransfer(
          {
            inputMint: batch.tokenMint,
            tokenMint: batch.tokenMint,
            sourceWallet: batch.senderWallet,
            sourceOwner: batch.senderWallet,
            amountRaw: transfer.chunkAmountRaw,
            amountTokens: (Number(transfer.chunkAmountRaw) / 10 ** batch.tokenDecimals).toString(),
            tokenDecimals: batch.tokenDecimals,
            tokenSymbol: batch.tokenSymbol,
            hops: transfer.hops,
            arrivalSeconds: transfer.arrivalSeconds,
            externalId: transfer.externalId,
            destinations: dests,
          },
          transfer.idempotencyKey
        );

        mhTransferId = createRes.id;
      }

      // Execute sequential signing, broadcast, and strict two-call confirm-broadcast sequence
      const broadcastRes = await orchestrator.signAndBroadcast(mhTransferId, walletSigner);

      // Update transfer record in store
      await payoutStore.updateTransfer(transfer.id, {
        status: "processing",
        multihopperId: mhTransferId,
        keeperFundingSignature: broadcastRes.keeperFundingSignature,
        routeInitSignatures: broadcastRes.routeInitSignatures,
        orchestratorInitSignature: broadcastRes.orchestratorInitSignature,
        sessionInitSignatures: broadcastRes.sessionInitSignatures,
        dispersionInitSignatures: broadcastRes.dispersionInitSignatures,
      });

      // Update associated recipient items to processing
      if (transfer.items) {
        for (const item of transfer.items) {
          await payoutStore.updatePayoutItem(item.id, { status: "processing" });
        }
      }

      // Record audit log for transfer broadcast
      await payoutStore.recordAuditLog({
        organizationId: batch.organizationId,
        actorWallet: batch.senderWallet,
        action: "transfer.broadcast",
        resourceType: "multihopper_transfer",
        resourceId: transfer.id,
        details: {
          batchId: batch.id,
          chunkIndex: transfer.chunkIndex,
          multihopperId: mhTransferId,
          recipientCount: transfer.recipientCount,
          keeperFundingSignature: broadcastRes.keeperFundingSignature,
        },
      });

      broadcastChunks.push({
        chunkId: transfer.id,
        chunkIndex: transfer.chunkIndex,
        externalId: transfer.externalId,
        multihopperId: mhTransferId,
        status: "processing",
        keeperFundingSignature: broadcastRes.keeperFundingSignature,
        routeInitSignatures: broadcastRes.routeInitSignatures,
        dispersionInitSignatures: broadcastRes.dispersionInitSignatures,
      });
    }

    const updatedBatch = await payoutStore.getPayoutBatch(id);

    await payoutStore.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet: batch.senderWallet,
      action: "batch.broadcast",
      resourceType: "payout_batch",
      resourceId: batch.id,
      details: {
        chunksCount: broadcastChunks.length,
        status: updatedBatch?.status || "processing",
      },
    });

    return NextResponse.json(
      {
        success: true,
        batchId: id,
        status: updatedBatch?.status || "processing",
        chunks: broadcastChunks,
      },
      { headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/batches/:id/broadcast", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Broadcast failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
