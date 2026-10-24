import crypto from "node:crypto";
import { sendEmailNotification } from "./email";
import { sendTelegramNotification } from "./telegram";
import type {
  BatchNotificationEvent,
  BatchNotificationEventType,
  NotificationLogEntry,
  NotificationResult,
} from "./types";

class NotificationDispatcher {
  private logs: NotificationLogEntry[] = [];

  public async notifyBatchEvent(event: BatchNotificationEvent): Promise<NotificationLogEntry> {
    const results = await Promise.allSettled([
      sendEmailNotification(event),
      sendTelegramNotification(event),
    ]);

    const channelResults: NotificationResult[] = results.map((r, idx) => {
      if (r.status === "fulfilled") {
        return r.value;
      }
      return {
        channel: idx === 0 ? "email" : "telegram",
        success: false,
        simulated: false,
        error: r.reason instanceof Error ? r.reason.message : "Unknown dispatcher error",
      };
    });

    const logEntry: NotificationLogEntry = {
      id: `notif-${crypto.randomUUID()}`,
      event: event.event,
      batchId: event.batchId,
      channels: channelResults,
      timestamp: new Date().toISOString(),
    };

    this.logs.unshift(logEntry);
    if (this.logs.length > 100) {
      this.logs.pop();
    }

    return logEntry;
  }

  public getNotificationLogs(batchId?: string): NotificationLogEntry[] {
    if (!batchId) return [...this.logs];
    return this.logs.filter((l) => l.batchId === batchId);
  }
}

const globalForDispatcher = globalThis as unknown as { notificationDispatcher?: NotificationDispatcher };
export const notificationDispatcher =
  globalForDispatcher.notificationDispatcher ?? new NotificationDispatcher();
globalForDispatcher.notificationDispatcher = notificationDispatcher;

export async function dispatchBatchLifecycleNotification(
  event: BatchNotificationEventType,
  params: Omit<BatchNotificationEvent, "event" | "timestamp">
): Promise<NotificationLogEntry> {
  const fullEvent: BatchNotificationEvent = {
    ...params,
    event,
    timestamp: new Date().toISOString(),
  };
  return notificationDispatcher.notifyBatchEvent(fullEvent);
}
