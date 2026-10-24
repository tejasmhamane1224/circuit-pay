import {
  Connection,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { PreparedTransactionsResponse, MultiHopperClient } from "./client";
import { MultiHopperLogger } from "./logger";

export interface WalletSignerInterface {
  publicKey: { toBase58: () => string };
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

export interface BroadcastProgressCallback {
  (step: string, current: number, total: number, signature?: string): void;
}

export interface BroadcastResult {
  keeperFundingSignature?: string;
  routeInitSignatures: string[];
  orchestratorInitSignature?: string;
  sessionInitSignatures: string[];
  dispersionInitSignatures: string[];
  status: "broadcast_confirmed" | "processing";
}

export interface SignerOrchestratorOptions {
  protocolDelayMs?: number;
  confirmationTimeoutMs?: number;
}

/**
 * Non-Custodial MultiHopper Transaction Signing & Broadcast Orchestrator
 * Strictly adheres to MultiHopper protocol broadcast sequencing and signature preservation
 */
export class MultiHopperSignerOrchestrator {
  private client: MultiHopperClient;
  private connection: Connection;
  private protocolDelayMs: number;

  constructor(
    client: MultiHopperClient,
    connection: Connection,
    options: SignerOrchestratorOptions = {}
  ) {
    this.client = client;
    this.connection = connection;
    this.protocolDelayMs =
      options.protocolDelayMs !== undefined
        ? options.protocolDelayMs
        : process.env.NODE_ENV === "test"
        ? 0
        : 3000;
  }

  /**
   * Helper: Wait for transaction confirmation on Solana RPC
   */
  private async waitForConfirmation(signature: string, maxWaitMs = 60000): Promise<void> {
    const startTime = Date.now();
    MultiHopperLogger.debug(`Waiting for confirmation of tx ${signature.slice(0, 8)}...`);

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      if (
        status?.value?.confirmationStatus === "confirmed" ||
        status?.value?.confirmationStatus === "finalized"
      ) {
        return;
      }

      if (status?.value?.err) {
        throw new Error(`Transaction ${signature} failed on-chain: ${JSON.stringify(status.value.err)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    throw new Error(`Transaction ${signature} timed out after ${maxWaitMs}ms`);
  }

  /**
   * Deserializes base64 strings into VersionedTransaction or Legacy Transaction objects
   */
  deserializePreparedTxs(prepared: PreparedTransactionsResponse["preparedTxs"]): {
    keeperTx: VersionedTransaction | null;
    routeTxs: VersionedTransaction[];
    orchestratorTx: Transaction | null;
    sessionTxs: VersionedTransaction[];
    dispersionTxs: VersionedTransaction[];
  } {
    const keeperTx = prepared.keeperFundingTx
      ? VersionedTransaction.deserialize(Buffer.from(prepared.keeperFundingTx, "base64"))
      : null;

    const routeTxs = (prepared.routeInitTxs || []).map((item) => {
      const b64 = typeof item === "string" ? item : item.base64;
      return VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    });

    const orchestratorTx = prepared.orchestratorInitTx
      ? Transaction.from(Buffer.from(prepared.orchestratorInitTx, "base64"))
      : null;

    const sessionTxs = (prepared.sessionInitTxs || []).map((b64) =>
      VersionedTransaction.deserialize(Buffer.from(b64, "base64"))
    );

    const dispersionTxs = (prepared.dispersionInitTxs || []).map((b64) =>
      VersionedTransaction.deserialize(Buffer.from(b64, "base64"))
    );

    return {
      keeperTx,
      routeTxs,
      orchestratorTx,
      sessionTxs,
      dispersionTxs,
    };
  }

  /**
   * Executes the full non-custodial signing, sequential broadcast, and two-call confirm cycle
   */
  async signAndBroadcast(
    transferId: string,
    wallet: WalletSignerInterface,
    onProgress?: BroadcastProgressCallback
  ): Promise<BroadcastResult> {
    MultiHopperLogger.info(`Starting non-custodial broadcast for transfer ${transferId}`);

    // 1. Fetch prepared transactions bundle from MultiHopper API
    const preparedRes = await this.client.prepareTransfer(transferId);
    const { preparedTxs, resume } = preparedRes;

    if (resume?.nothingToDo) {
      MultiHopperLogger.info(`Transfer ${transferId} already has nothing to do (already deployed)`);
      return {
        routeInitSignatures: [],
        sessionInitSignatures: [],
        dispersionInitSignatures: [],
        status: "processing",
      };
    }

    const deserialized = this.deserializePreparedTxs(preparedTxs);
    const result: BroadcastResult = {
      routeInitSignatures: [],
      sessionInitSignatures: [],
      dispersionInitSignatures: [],
      status: "broadcast_confirmed",
    };

    // Calculate total steps for progress bar
    const totalTxs =
      (deserialized.keeperTx ? 1 : 0) +
      deserialized.routeTxs.length +
      (deserialized.orchestratorTx ? 1 : 0) +
      deserialized.sessionTxs.length +
      deserialized.dispersionTxs.length;

    let currentStep = 0;

    // STEP A: Keeper Funding (VersionedTransaction v0)
    // Broadcast FIRST, and immediately notify API via intermediate confirm-broadcast call!
    if (deserialized.keeperTx) {
      currentStep++;
      onProgress?.("Signing Keeper Funding Transaction", currentStep, totalTxs);

      const signedKeeper = await wallet.signTransaction(deserialized.keeperTx);
      const rawTx = signedKeeper.serialize();
      const keeperSig = await this.connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        maxRetries: 3,
      });

      onProgress?.("Confirming Keeper Funding on-chain", currentStep, totalTxs, keeperSig);
      await this.waitForConfirmation(keeperSig);
      result.keeperFundingSignature = keeperSig;

      // IMMEDIATE INTERMEDIATE CALL: confirm-broadcast with keeper signature
      // Critical protocol rule: prevents double-funding keeper on retries/resume
      MultiHopperLogger.info(`Registering intermediate keeper confirmation: ${keeperSig}`);
      await this.client.confirmBroadcast(transferId, {
        routeInitSignatures: [],
        keeperFundingSignature: keeperSig,
      });
    }

    // STEP B: Route Initialization Transactions (VersionedTransaction v0)
    if (deserialized.routeTxs.length > 0) {
      if (this.protocolDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.protocolDelayMs));
      }

      for (let i = 0; i < deserialized.routeTxs.length; i++) {
        currentStep++;
        onProgress?.(`Broadcasting Route Init ${i + 1}/${deserialized.routeTxs.length}`, currentStep, totalTxs);

        const signedRouteTx = await wallet.signTransaction(deserialized.routeTxs[i]);
        const sig = await this.connection.sendRawTransaction(signedRouteTx.serialize(), {
          skipPreflight: false,
        });

        await this.waitForConfirmation(sig);
        result.routeInitSignatures.push(sig);
      }

      if (this.protocolDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.protocolDelayMs));
      }
    }

    // STEP C: Orchestrator Initialization (Legacy Transaction)
    if (deserialized.orchestratorTx) {
      currentStep++;
      onProgress?.("Broadcasting Orchestrator Initialization", currentStep, totalTxs);

      const signedOrch = await wallet.signTransaction(deserialized.orchestratorTx);
      const sig = await this.connection.sendRawTransaction(signedOrch.serialize(), {
        skipPreflight: false,
      });

      await this.waitForConfirmation(sig);
      result.orchestratorInitSignature = sig;

      if (this.protocolDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.protocolDelayMs));
      }
    }

    // STEP D: Session Initialization Transactions (VersionedTransaction v0)
    for (let i = 0; i < deserialized.sessionTxs.length; i++) {
      currentStep++;
      onProgress?.(`Broadcasting Session Init ${i + 1}/${deserialized.sessionTxs.length}`, currentStep, totalTxs);

      const signedSession = await wallet.signTransaction(deserialized.sessionTxs[i]);
      const sig = await this.connection.sendRawTransaction(signedSession.serialize(), {
        skipPreflight: false,
      });

      await this.waitForConfirmation(sig);
      result.sessionInitSignatures.push(sig);
    }

    // STEP E: Dispersion Initialization Transactions (Multi-Destination <=20)
    for (let i = 0; i < deserialized.dispersionTxs.length; i++) {
      currentStep++;
      onProgress?.(
        `Broadcasting Dispersion Init ${i + 1}/${deserialized.dispersionTxs.length}`,
        currentStep,
        totalTxs
      );

      const signedDispersion = await wallet.signTransaction(deserialized.dispersionTxs[i]);
      const sig = await this.connection.sendRawTransaction(signedDispersion.serialize(), {
        skipPreflight: false,
      });

      await this.waitForConfirmation(sig);
      result.dispersionInitSignatures.push(sig);
    }

    // FINAL CALL: Second confirm-broadcast with ALL signatures
    onProgress?.("Submitting Final Signatures to MultiHopper", currentStep, totalTxs);
    MultiHopperLogger.info(`Submitting final confirm-broadcast for transfer ${transferId}`);

    await this.client.confirmBroadcast(transferId, {
      routeInitSignatures: result.routeInitSignatures,
      orchestratorInitSignature: result.orchestratorInitSignature,
      sessionInitSignatures: result.sessionInitSignatures,
      dispersionInitSignatures: result.dispersionInitSignatures,
      keeperFundingSignature: result.keeperFundingSignature,
    });

    result.status = "processing";
    onProgress?.("Transfer Confirmed & Processing Hops", totalTxs, totalTxs);
    return result;
  }
}
