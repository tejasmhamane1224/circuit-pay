import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
export interface MockTransferRecord {
  id: string;
  externalId: string;
  tokenMint: string;
  amountRaw: string;
  sourceOwner: string;
  recipientWallet?: string;
  destinations?: Array<{ wallet: string; amountRaw: string; status: string; payoutSignature?: string }>;
  hops: number;
  arrivalSeconds: number;
  status: "quote" | "awaiting_signature" | "processing" | "active" | "completed" | "failed" | "refunded";
  phase: "quoted" | "deploying" | "executing" | "settled" | "failed";
  progress: { hopsCompleted: number; hopsTotal: number };
  keeperFundingSignature?: string;
  signatures: {
    routeInitSignatures: string[];
    orchestratorInitSignature?: string;
    sessionInitSignatures: string[];
    dispersionInitSignatures: string[];
  };
  createdAt: string;
}

export class MultiHopperMockServer {
  private transfers = new Map<string, MockTransferRecord>();
  private idempotencyCache = new Map<string, { endpoint: string; bodyHash: string; response: unknown }>();
  private ephemeralKeypair = Keypair.generate();
  private mockBlockhash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

  // Create real serialized base64 transactions for testing wallet deserialization
  private generateMockTx(isVersioned = true): string {
    const fromPubkey = this.ephemeralKeypair.publicKey;
    const toPubkey = Keypair.generate().publicKey;

    if (isVersioned) {
      const instructions = [
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: 1000,
        }),
      ];

      const messageV0 = new TransactionMessage({
        payerKey: fromPubkey,
        recentBlockhash: this.mockBlockhash,
        instructions,
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(messageV0);
      versionedTx.sign([this.ephemeralKeypair]);
      return Buffer.from(versionedTx.serialize()).toString("base64");
    }

    const legacyTx = new Transaction({
      recentBlockhash: this.mockBlockhash,
      feePayer: fromPubkey,
    }).add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports: 1000,
      })
    );

    legacyTx.partialSign(this.ephemeralKeypair);
    return legacyTx.serialize({ requireAllSignatures: false }).toString("base64");
  }

  /**
   * Handle incoming mock fetch requests
   */
  async handleFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const parsedUrl = new URL(url, "https://mock.multihopper.com");
    const pathname = parsedUrl.pathname.replace(/^\/api\/v1/, "");
    const method = init.method || "GET";
    const apiKey = (init.headers as Record<string, string>)?.[
      "x-api-key"
    ] || (init.headers as Record<string, string>)?.[
      "authorization"
    ]?.replace("Bearer ", "");
    const idempotencyKey = (init.headers as Record<string, string>)?.[
      "Idempotency-Key"
    ];

    // Auth check
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          code: "MH_001",
          message: "Unauthorized: Missing or invalid API key",
        }),
        { status: 401 }
      );
    }

    const body = init.body ? JSON.parse(init.body as string) : {};

    // Idempotency check for mutations
    if (method === "POST") {
      if (!idempotencyKey) {
        return new Response(
          JSON.stringify({
            code: "MH_070",
            message: "Missing required Idempotency-Key header",
          }),
          { status: 400 }
        );
      }

      const cacheKey = `${pathname}:${idempotencyKey}`;
      const cached = this.idempotencyCache.get(cacheKey);
      if (cached) {
        const bodyHash = JSON.stringify(body);
        if (cached.bodyHash !== bodyHash) {
          return new Response(
            JSON.stringify({
              code: "MH_071",
              message: "Idempotency key reused with mismatched request payload",
            }),
            { status: 409 }
          );
        }
        return new Response(JSON.stringify(cached.response), { status: 200 });
      }
    }

    // Route: POST /transfers/estimate
    if (pathname === "/transfers/estimate" && method === "POST") {
      const destinations = body.destinations;
      const destinationCount = body.destinationCount || (destinations ? destinations.length : 1);
      const amountRaw =
        body.amountRaw ||
        (destinations
          ? destinations.reduce((sum: bigint, d: { amountRaw?: string }) => sum + BigInt(d.amountRaw || "0"), BigInt(0)).toString()
          : "1000000");
      const hops = body.hops ?? 4;

      const amountBig = BigInt(amountRaw || "0");
      if (amountBig <= BigInt(0)) {
        return new Response(
          JSON.stringify({ code: "MH_012", message: "Amount below minimum" }),
          { status: 400 }
        );
      }
      if (hops < 3 || hops > 10) {
        return new Response(
          JSON.stringify({ code: "MH_013", message: "Hops must be between 3 and 10" }),
          { status: 400 }
        );
      }
      if (destinationCount < 1 || destinationCount > 500) {
        return new Response(
          JSON.stringify({ code: "MH_017", message: "Destinations must be 1 to 500" }),
          { status: 400 }
        );
      }

      // Percent fee = 0.50%
      const percentFeeRaw = (amountBig * BigInt(50)) / BigInt(10000);
      const hopAmountRaw = amountBig - percentFeeRaw;
      const integratorPercentShare = percentFeeRaw / BigInt(2);
      const screeningLamports = destinationCount * 2_000_000; // 0.002 SOL/recipient
      const keeperLamports = 5_000_000; // 0.005 SOL

      const response = {
        tier: "tier_3",
        percentFeeBps: 50,
        percentFeeRaw: percentFeeRaw.toString(),
        totalFlatFeeLamports: "500000",
        integratorPercentShare: integratorPercentShare.toString(),
        integratorFlatShare: "250000",
        hopAmountRaw: hopAmountRaw.toString(),
        priceSource: "onchain_pool",
        sol: {
          requiredSolUpFrontLamports: (screeningLamports + keeperLamports).toString(),
          breakdown: {
            screeningFeeLamports: screeningLamports.toString(),
            keeperFundingLamports: keeperLamports.toString(),
            dispersionRentLamports: "2000000",
          },
        },
      };

      this.cacheIdempotency(idempotencyKey!, pathname, body, response);
      return new Response(JSON.stringify(response), { status: 200 });
    }

    // Route: POST /transfers (Create)
    if (pathname === "/transfers" && method === "POST") {
      const tokenMint = body.inputMint || body.tokenMint;
      const sourceOwner = body.sourceWallet || body.sourceOwner;
      const destinations = body.destinations;
      const amountRaw =
        body.amountRaw ||
        (destinations
          ? destinations.reduce((sum: bigint, d: { amountRaw?: string }) => sum + BigInt(d.amountRaw || "0"), BigInt(0)).toString()
          : undefined);
      const recipientWallet = body.recipientWallet;
      const hops = body.hops ?? 4;
      const arrivalSeconds = body.arrivalSeconds ?? 900;
      const externalId = body.externalId;

      if (!tokenMint || !amountRaw || !sourceOwner) {
        return new Response(
          JSON.stringify({ code: "MH_012", message: "Missing required fields" }),
          { status: 400 }
        );
      }

      if (destinations && (destinations.length < 1 || destinations.length > 20)) {
        return new Response(
          JSON.stringify({ code: "MH_017", message: "Destinations must be 1 to 20" }),
          { status: 400 }
        );
      }

      const id = `mh_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const amountBig = BigInt(amountRaw);
      const fee = (amountBig * BigInt(50)) / BigInt(10000);
      const recipientReceivesRaw = (amountBig - fee).toString();

      const record: MockTransferRecord = {
        id,
        externalId: externalId || id,
        tokenMint,
        amountRaw,
        sourceOwner,
        recipientWallet,
        destinations: destinations?.map((d: { wallet: string; amountRaw: string }) => ({
          wallet: d.wallet,
          amountRaw: d.amountRaw,
          status: "pending",
        })),
        hops,
        arrivalSeconds,
        status: "quote",
        phase: "quoted",
        progress: { hopsCompleted: 0, hopsTotal: hops },
        signatures: {
          routeInitSignatures: [],
          sessionInitSignatures: [],
          dispersionInitSignatures: [],
        },
        createdAt: new Date().toISOString(),
      };

      this.transfers.set(id, record);

      const response = {
        id,
        status: "quote",
        recipientReceivesRaw,
        destinations: record.destinations,
        route: {
          hops: Array.from({ length: hops }, (_, i) => ({
            index: i + 1,
            address: Keypair.generate().publicKey.toBase58(),
            scheduledAt: new Date(Date.now() + (i + 1) * 120000).toISOString(),
          })),
        },
      };

      this.cacheIdempotency(idempotencyKey!, pathname, body, response);
      return new Response(JSON.stringify(response), { status: 200 });
    }

    // Route: POST /transfers/:id/prepare
    const prepareMatch = pathname.match(/^\/transfers\/([^/]+)\/prepare$/);
    if (prepareMatch && method === "POST") {
      const transferId = prepareMatch[1];
      let transfer = this.transfers.get(transferId);
      if (!transfer) {
        transfer = Array.from(this.transfers.values()).find((t) => t.externalId === transferId);
      }
      if (!transfer) {
        const record: MockTransferRecord = {
          id: transferId,
          externalId: transferId,
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "100000000",
          sourceOwner: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
          hops: 4,
          arrivalSeconds: 900,
          status: "quote",
          phase: "quoted",
          progress: { hopsCompleted: 0, hopsTotal: 4 },
          signatures: {
            routeInitSignatures: [],
            sessionInitSignatures: [],
            dispersionInitSignatures: [],
          },
          createdAt: new Date().toISOString(),
        };
        this.transfers.set(transferId, record);
        transfer = record;
      }

      transfer.status = "awaiting_signature";
      transfer.phase = "deploying";

      const response = {
        transfer: {
          id: transfer.id,
          status: transfer.status,
        },
        preparedTxs: {
          keeperFundingTx: this.generateMockTx(true),
          routeInitTxs: [this.generateMockTx(true), this.generateMockTx(true)],
          orchestratorInitTx: this.generateMockTx(false), // Legacy tx
          sessionInitTxs: [this.generateMockTx(true)],
          dispersionInitTxs: transfer.destinations ? [this.generateMockTx(true)] : [],
          recentBlockhash: this.mockBlockhash,
          lastValidBlockHeight: 310500120,
        },
        resume: {
          nothingToDo: false,
          routeAlreadyDeployed: false,
        },
      };

      this.cacheIdempotency(idempotencyKey!, pathname, body, response);
      return new Response(JSON.stringify(response), { status: 200 });
    }

    // Route: POST /transfers/:id/confirm-broadcast
    const confirmMatch = pathname.match(/^\/transfers\/([^/]+)\/confirm-broadcast$/);
    if (confirmMatch && method === "POST") {
      const transferId = confirmMatch[1];
      let transfer = this.transfers.get(transferId);
      if (!transfer) {
        transfer = Array.from(this.transfers.values()).find((t) => t.externalId === transferId);
      }
      if (!transfer) {
        const record: MockTransferRecord = {
          id: transferId,
          externalId: transferId,
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "100000000",
          sourceOwner: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
          hops: 4,
          arrivalSeconds: 900,
          status: "awaiting_signature",
          phase: "deploying",
          progress: { hopsCompleted: 0, hopsTotal: 4 },
          signatures: {
            routeInitSignatures: [],
            sessionInitSignatures: [],
            dispersionInitSignatures: [],
          },
          createdAt: new Date().toISOString(),
        };
        this.transfers.set(transferId, record);
        transfer = record;
      }

      const {
        keeperFundingSignature,
        routeInitSignatures = [],
        orchestratorInitSignature,
        sessionInitSignatures = [],
        dispersionInitSignatures = [],
      } = body;

      // Protocol check: First call requires keeperFundingSignature
      if (!transfer.keeperFundingSignature && !keeperFundingSignature) {
        return new Response(
          JSON.stringify({
            code: "MH_039",
            message: "keeperFundingSignature is required but missing",
          }),
          { status: 400 }
        );
      }

      if (keeperFundingSignature) {
        transfer.keeperFundingSignature = keeperFundingSignature;
      }

      if (routeInitSignatures.length > 0) {
        transfer.signatures.routeInitSignatures.push(...routeInitSignatures);
      }
      if (orchestratorInitSignature) {
        transfer.signatures.orchestratorInitSignature = orchestratorInitSignature;
      }
      if (sessionInitSignatures.length > 0) {
        transfer.signatures.sessionInitSignatures.push(...sessionInitSignatures);
      }
      if (dispersionInitSignatures.length > 0) {
        transfer.signatures.dispersionInitSignatures.push(...dispersionInitSignatures);
      }

      // If all signatures collected, advance state to processing
      if (
        transfer.signatures.routeInitSignatures.length > 0 ||
        transfer.keeperFundingSignature
      ) {
        transfer.status = "processing";
        transfer.phase = "executing";
      }

      const response = { status: "received" };
      this.cacheIdempotency(idempotencyKey!, pathname, body, response);
      return new Response(JSON.stringify(response), { status: 200 });
    }

    // Route: GET /transfers/:id
    const getMatch = pathname.match(/^\/transfers\/([^/]+)$/);
    if (getMatch && method === "GET") {
      const transferId = getMatch[1];
      const transfer = this.transfers.get(transferId);
      if (!transfer) {
        return new Response(
          JSON.stringify({ code: "MH_021", message: "Transfer not found" }),
          { status: 404 }
        );
      }

      return new Response(
        JSON.stringify({
          transfer: {
            ...transfer,
          },
        }),
        { status: 200 }
      );
    }

    // Route: GET /usage
    if (pathname === "/usage" && method === "GET") {
      return new Response(
        JSON.stringify({
          integratorAddress: "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u",
          collectedVolumeUsd: "150000.00",
          integratorRevenueShareUsd: "375.00",
          transfersCount: 14,
          unclaimedRewardsLamports: "250000000",
        }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ error: `Not found: ${method} ${pathname}` }),
      { status: 404 }
    );
  }

  private cacheIdempotency(key: string, endpoint: string, body: unknown, response: unknown) {
    this.idempotencyCache.set(`${endpoint}:${key}`, {
      endpoint,
      bodyHash: JSON.stringify(body),
      response,
    });
  }

  /**
   * Helper to inspect transfers directly in tests
   */
  getTransferRecord(id: string): MockTransferRecord | undefined {
    return this.transfers.get(id);
  }
}
