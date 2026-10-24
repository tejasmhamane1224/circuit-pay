import * as Sentry from "@sentry/nextjs";
import { scrubSensitiveData } from "./scrubber";
import { MultiHopperLogger } from "../multihopper/logger";

/**
 * Resilient Error Logger and Sentry Reporter
 * Scrubbed of all private keys, secrets, and auth tokens.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): string | undefined {
  const scrubbedContext = context ? scrubSensitiveData(context) : undefined;

  let eventId: string | undefined;

  try {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN) {
      eventId = Sentry.captureException(error, {
        extra: scrubbedContext,
      });
    }
  } catch (err) {
    MultiHopperLogger.warn("Failed to report exception to Sentry", {
      errorCode: err instanceof Error ? err.message : String(err),
    });
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  MultiHopperLogger.error(`[Error Captured]: ${errorMessage}`, {
    requestId: (scrubbedContext?.requestId as string) || undefined,
    transferId: (scrubbedContext?.transferId as string) || undefined,
  });

  return eventId;
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  context?: Record<string, unknown>
): string | undefined {
  const scrubbedContext = context ? scrubSensitiveData(context) : undefined;
  let eventId: string | undefined;

  try {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN) {
      eventId = Sentry.captureMessage(message, {
        level,
        extra: scrubbedContext,
      });
    }
  } catch (err) {
    MultiHopperLogger.warn("Failed to report message to Sentry", {
      errorCode: err instanceof Error ? err.message : String(err),
    });
  }

  const logFn = level === "error" ? MultiHopperLogger.error : level === "warning" ? MultiHopperLogger.warn : MultiHopperLogger.info;
  logFn(message, {
    requestId: (scrubbedContext?.requestId as string) || undefined,
  });

  return eventId;
}
