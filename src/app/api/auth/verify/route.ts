import { NextRequest, NextResponse } from "next/server";
import { verifySiwsRequestSchema } from "@/lib/validations/auth";
import { verifySIWSSignature } from "@/lib/siws/verify";
import { createSessionToken } from "@/lib/siws/session";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(req: NextRequest) {
  try {
    const rateLimit = checkRequestRateLimit(req, "default");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const body = await req.json();
    const parseResult = verifySiwsRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request payload",
          details: parseResult.error.format(),
        },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const { message, signature, publicKey, nonce } = parseResult.data;

    // Cryptographic signature and message verification
    const verification = verifySIWSSignature({
      message,
      signature,
      publicKey,
      expectedNonce: nonce,
    });

    if (!verification.valid) {
      return NextResponse.json(
        {
          success: false,
          error: verification.reason || "Cryptographic signature verification failed",
        },
        { status: 401, headers: rateLimit.headers }
      );
    }

    // Generate secure session token
    const token = createSessionToken(publicKey, { role: "admin" });

    const response = NextResponse.json(
      {
        success: true,
        address: publicKey,
        token,
      },
      { headers: rateLimit.headers }
    );

    // Set secure HTTP-only cookie
    response.cookies.set({
      name: "circuitpay_session",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/auth/verify", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
