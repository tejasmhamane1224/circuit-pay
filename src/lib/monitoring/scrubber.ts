/**
 * CircuitPay Sensitive Data Scrubber
 * Ensures private keys, seeds, API keys, and session tokens are never leaked
 * to Sentry, PostHog, or external log sinks.
 */

// Known sensitive environment keys
const SENSITIVE_ENV_KEYS = [
  "MULTIHOPPER_API_KEY",
  "MULTIHOPPER_WEBHOOK_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
  "HELIUS_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "DATABASE_URL",
  "POSTGRES_URL",
];

// Patterns identifying private keys or tokens
const BASE58_SECRET_REGEX = /\b[1-9A-HJ-NP-Za-km-z]{64,88}\b/g;
const SECRET_PREFIX_REGEX = /(?:mh_live_|mh_test_|whsec_|sntrys_|eyJhbGciOi)[A-Za-z0-9_.-]+/g;
const BEARER_AUTH_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const DB_CONN_REGEX = /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi;

/**
 * Sanitizes a string by replacing recognized secrets with redacted placeholders
 */
export function sanitizeString(value: string): string {
  if (!value || typeof value !== "string") return value;

  let sanitized = value;

  // Redact database credentials embedded in connection strings
  sanitized = sanitized.replace(DB_CONN_REGEX, "$1[REDACTED_PASSWORD]$3");

  // Redact known env secret values if present in process.env
  for (const envKey of SENSITIVE_ENV_KEYS) {
    const secret = process.env[envKey];
    if (secret && secret.length > 5 && sanitized.includes(secret)) {
      sanitized = sanitized.split(secret).join(`[REDACTED_${envKey}]`);
    }
  }

  // Redact Bearer tokens
  sanitized = sanitized.replace(BEARER_AUTH_REGEX, "Bearer [REDACTED_TOKEN]");

  // Redact known secret prefix formats (MultiHopper keys, JWTs, Sentry tokens)
  sanitized = sanitized.replace(SECRET_PREFIX_REGEX, "[REDACTED_SECRET]");

  // Redact base58 private keys (64-88 chars)
  sanitized = sanitized.replace(BASE58_SECRET_REGEX, "[REDACTED_BASE58_SECRET]");

  return sanitized;
}

/**
 * Recursively scrubs an object, array, or primitive of sensitive data
 */
export function scrubSensitiveData<T>(data: T, depth = 0): T {
  if (depth > 8 || data === null || data === undefined) {
    return data;
  }

  if (typeof data === "string") {
    return sanitizeString(data) as unknown as T;
  }

  // Guard against leaking raw Solana secret keys in Uint8Array, Buffer, or other TypedArrays
  if (ArrayBuffer.isView(data) || (typeof data === "object" && data instanceof Uint8Array)) {
    if (data.byteLength === 32 || data.byteLength === 64) {
      return "[REDACTED_KEY_BYTES]" as unknown as T;
    }
    return "[REDACTED_BUFFER]" as unknown as T;
  }

  if (Array.isArray(data)) {
    // Check if array is a 32 or 64 byte number array (Solana secret key byte array)
    if (
      (data.length === 32 || data.length === 64) &&
      data.every((item) => typeof item === "number" && item >= 0 && item <= 255)
    ) {
      return "[REDACTED_KEY_BYTES]" as unknown as T;
    }

    return data.map((item) => scrubSensitiveData(item, depth + 1)) as unknown as T;
  }

  if (typeof data === "object") {
    const scrubbed: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      // Mask sensitive keys completely
      if (
        lowerKey.includes("secret") ||
        lowerKey.includes("privatekey") ||
        lowerKey.includes("privkey") ||
        lowerKey.includes("seed") ||
        lowerKey.includes("password") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("cookie") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("signature")
      ) {
        scrubbed[key] = "[REDACTED]";
      } else {
        scrubbed[key] = scrubSensitiveData(val, depth + 1);
      }
    }

    return scrubbed as unknown as T;
  }

  return data;
}
