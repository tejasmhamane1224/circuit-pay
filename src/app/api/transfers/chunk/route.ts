import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { destinationItemSchema } from "@/lib/validations/transfers";
import { chunkPayoutDestinations } from "@/lib/multihopper/chunker";

const chunkRequestSchema = z.object({
  batchId: z.string().min(1),
  destinations: z.array(destinationItemSchema).min(1),
  maxChunkSize: z.number().int().min(1).max(20).default(20),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = chunkRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { batchId, destinations, maxChunkSize } = parsed.data;
    const chunks = chunkPayoutDestinations(batchId, destinations, maxChunkSize);

    const totalAmountRaw = destinations
      .reduce((sum, d) => sum + BigInt(d.amountRaw), BigInt(0))
      .toString();

    return NextResponse.json({
      success: true,
      batchId,
      totalRecipients: destinations.length,
      totalAmountRaw,
      totalChunks: chunks.length,
      chunks,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
