import { describe, it, expect } from "vitest";
import { chunkPayoutDestinations, type PayoutDestinationInput } from "@/lib/multihopper/chunker";

describe("MultiHopper Destination Chunker (20-Cap Constraint)", () => {
  const dummyWallet = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";

  it("handles empty destination array", () => {
    const chunks = chunkPayoutDestinations("batch_empty", []);
    expect(chunks).toEqual([]);
  });

  it("produces exactly 1 chunk for <= 20 recipients", () => {
    const destinations: PayoutDestinationInput[] = [];
    for (let i = 0; i < 20; i++) {
      destinations.push({
        wallet: dummyWallet,
        amountRaw: "1000000",
      });
    }

    const chunks = chunkPayoutDestinations("batch_20", destinations);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].recipientCount).toBe(20);
    expect(chunks[0].externalId).toBe("batch_20_chunk_0");
    expect(chunks[0].chunkAmountRaw).toBe("20000000");
  });

  it("splits 21 recipients into 2 chunks (20 + 1)", () => {
    const destinations: PayoutDestinationInput[] = [];
    for (let i = 0; i < 21; i++) {
      destinations.push({
        wallet: dummyWallet,
        amountRaw: "1000000",
      });
    }

    const chunks = chunkPayoutDestinations("batch_21", destinations);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].recipientCount).toBe(20);
    expect(chunks[0].externalId).toBe("batch_21_chunk_0");
    expect(chunks[0].chunkAmountRaw).toBe("20000000");

    expect(chunks[1].recipientCount).toBe(1);
    expect(chunks[1].externalId).toBe("batch_21_chunk_1");
    expect(chunks[1].chunkAmountRaw).toBe("1000000");
  });

  it("splits 45 recipients into 3 chunks (20 + 20 + 5) preserving exact totals", () => {
    const destinations: PayoutDestinationInput[] = [];
    let expectedTotalRaw = BigInt(0);

    for (let i = 0; i < 45; i++) {
      const amount = BigInt((i + 1) * 100000);
      expectedTotalRaw += amount;
      destinations.push({
        wallet: dummyWallet,
        amountRaw: amount.toString(),
      });
    }

    const chunks = chunkPayoutDestinations("batch_45", destinations);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].recipientCount).toBe(20);
    expect(chunks[1].recipientCount).toBe(20);
    expect(chunks[2].recipientCount).toBe(5);

    const actualTotalRaw = chunks.reduce((sum, chk) => sum + BigInt(chk.chunkAmountRaw), BigInt(0));
    expect(actualTotalRaw).toBe(expectedTotalRaw);
  });

  it("throws on invalid maxChunkSize (>20 or <1)", () => {
    const destinations = [{ wallet: dummyWallet, amountRaw: "1000" }];
    expect(() => chunkPayoutDestinations("batch", destinations, 0)).toThrow();
    expect(() => chunkPayoutDestinations("batch", destinations, 21)).toThrow();
  });
});
