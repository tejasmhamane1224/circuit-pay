"use client";

import React, { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-zinc-950 text-white min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center space-y-4 shadow-xl">
          <div className="h-12 w-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center font-bold text-lg">
            !
          </div>
          <h2 className="text-lg font-semibold text-zinc-100">Application Error</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            An unexpected error occurred in CircuitPay. Our error monitoring system has safely logged this incident.
          </p>
          <button
            onClick={() => reset()}
            className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
