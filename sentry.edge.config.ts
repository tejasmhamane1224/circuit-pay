import * as Sentry from "@sentry/nextjs";
import { scrubSensitiveData } from "./src/lib/monitoring/scrubber";

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.2,
    debug: false,
    environment: process.env.NODE_ENV || "production",

    beforeSend(event) {
      if (event.extra) {
        event.extra = scrubSensitiveData(event.extra);
      }
      return event;
    },
  });
}
