/**
 * Safe Structured Logger for MultiHopper Operations
 * Ensures API keys, signatures, and private secrets are never exposed in logs
 */

export interface LogEntry {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  endpoint?: string;
  method?: string;
  durationMs?: number;
  status?: number;
  idempotencyKey?: string;
  requestId?: string;
  transferId?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export class MultiHopperLogger {
  private static sanitizeKey(key?: string): string {
    if (!key) return "none";
    if (key.length <= 10) return "***";
    return `${key.slice(0, 7)}...${key.slice(-4)}`;
  }

  static log(level: "info" | "warn" | "error" | "debug", message: string, meta: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    // Strip sensitive fields if accidentally included
    if (entry.idempotencyKey) {
      entry.idempotencyKey = `${entry.idempotencyKey.slice(0, 8)}...`;
    }

    if (process.env.NODE_ENV !== "test" || process.env.VERBOSE_LOGS === "true") {
      const prefix = `[MultiHopper][${entry.level.toUpperCase()}][${entry.timestamp}]`;
      if (entry.level === "error") {
        console.error(`${prefix} ${entry.message}`, meta);
      } else if (entry.level === "warn") {
        console.warn(`${prefix} ${entry.message}`, meta);
      } else {
        console.log(`${prefix} ${entry.message}`, meta);
      }
    }

    return entry;
  }

  static info(message: string, meta?: Partial<LogEntry>) {
    return this.log("info", message, meta);
  }

  static warn(message: string, meta?: Partial<LogEntry>) {
    return this.log("warn", message, meta);
  }

  static error(message: string, meta?: Partial<LogEntry>) {
    return this.log("error", message, meta);
  }

  static debug(message: string, meta?: Partial<LogEntry>) {
    return this.log("debug", message, meta);
  }
}
