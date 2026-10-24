import { MULTIHOPPER_RULES } from "../constants";

export interface PayoutDestinationInput {
  wallet: string;
  amountRaw: string;
  recipientName?: string;
}

export interface PayoutChunk {
  chunkIndex: number;
  externalId: string;
  destinations: { wallet: string; amountRaw: string }[];
  chunkAmountRaw: string;
  recipientCount: number;
}

export function chunkPayoutDestinations(
  batchId: string,
  destinations: PayoutDestinationInput[],
  maxChunkSize: number = MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK
): PayoutChunk[] {
  if (destinations.length === 0) {
    return [];
  }

  if (maxChunkSize < 1 || maxChunkSize > 20) {
    throw new Error(`Invalid maxChunkSize: ${maxChunkSize}. MultiHopper requires 1 to 20 destinations.`);
  }

  const chunks: PayoutChunk[] = [];
  const totalItems = destinations.length;

  for (let i = 0; i < totalItems; i += maxChunkSize) {
    const chunkIndex = Math.floor(i / maxChunkSize);
    const slice = destinations.slice(i, i + maxChunkSize);

    const chunkDestinations = slice.map((item) => ({
      wallet: item.wallet,
      amountRaw: item.amountRaw,
    }));

    const chunkAmountRaw = chunkDestinations
      .reduce((sum, item) => sum + BigInt(item.amountRaw), BigInt(0))
      .toString();

    // MultiHopper externalId pattern: batchId + chunkIndex
    const externalId = `${batchId}_chunk_${chunkIndex}`;

    chunks.push({
      chunkIndex,
      externalId,
      destinations: chunkDestinations,
      chunkAmountRaw,
      recipientCount: chunkDestinations.length,
    });
  }

  return chunks;
}
