import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/siws/session";

export async function GET(req: NextRequest) {
  // Check cookie first, then Authorization header
  const cookieToken = req.cookies.get("circuitpay_session")?.value;
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const token = cookieToken || bearerToken;

  if (!token) {
    return NextResponse.json({ authenticated: false, session: null });
  }

  const session = verifySessionToken(token);

  if (!session) {
    return NextResponse.json({ authenticated: false, session: null });
  }

  return NextResponse.json({
    authenticated: true,
    session,
  });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, message: "Logged out" });
  response.cookies.delete("circuitpay_session");
  return response;
}
