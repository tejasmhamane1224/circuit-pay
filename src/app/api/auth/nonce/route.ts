import { NextResponse } from "next/server";
import { generateNonce } from "@/lib/siws/message";

export async function GET() {
  const nonce = generateNonce();
  return NextResponse.json({
    nonce,
    issuedAt: new Date().toISOString(),
  });
}

export async function POST() {
  const nonce = generateNonce();
  return NextResponse.json({
    nonce,
    issuedAt: new Date().toISOString(),
  });
}
