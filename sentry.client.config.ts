import * as Sentry from "@sentry/nextjs";
import { scrubSensitiveData } from "./src/lib/monitoring/scrubber";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
    debug: false,
    environment: process.env.NODE_ENV || "production",

    beforeSend(event) {
      // Deep scrub all event data
      if (event.extra) {
        event.extra = scrubSensitiveData(event.extra);
      }
      if (event.request) {
        if (event.request.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
          delete event.request.headers["x-multihopper-signature"];
        }
        if (event.request.data) {
          event.request.data = scrubSensitiveData(event.request.data);
        }
      }
      return event;
    },
  });
}
