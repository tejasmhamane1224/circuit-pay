import crypto from "node:crypto";

export function verifyMultiHopperWebhook(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret) {
    return false;
  }

  try {
    const cleanSig = signature.replace(/^sha256[=:]/i, "").trim().toLowerCase();
    if (cleanSig.length !== 64 || !/^[0-9a-f]{64}$/.test(cleanSig)) {
      return false;
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")
      .toLowerCase();

    const signatureBuffer = Buffer.from(cleanSig, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
