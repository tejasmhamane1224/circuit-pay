import crypto from "node:crypto";

export interface SessionPayload {
  address: string;
  role?: string;
  organizationId?: string;
  iat: number;
  exp: number;
}

const DEFAULT_SECRET = process.env.SESSION_SECRET || "circuitpay_super_secret_session_key_32_chars_min";
const SESSION_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export function createSessionToken(
  address: string,
  extra: Partial<Omit<SessionPayload, "address" | "iat" | "exp">> = {},
  secret: string = DEFAULT_SECRET
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    address,
    ...extra,
    iat: now,
    exp: now + SESSION_EXPIRY_SECONDS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string = DEFAULT_SECRET): SessionPayload | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSignature] = parts;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  if (
    providedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(encodedPayload, "base64url").toString("utf-8");
    const payload = JSON.parse(jsonStr) as SessionPayload;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}
