export type BatchNotificationEventType =
  | "batch.completed"
  | "batch.failed"
  | "batch.awaiting_approval";

export interface BatchNotificationEvent {
  event: BatchNotificationEventType;
  batchId: string;
  organizationId?: string;
  title: string;
  totalAmountFormatted: string;
  tokenSymbol: string;
  recipientCount: number;
  network: "mainnet-beta" | "devnet";
  error?: string;
  approversNeeded?: number;
  approversCount?: number;
  timestamp: string;
}

export interface NotificationResult {
  channel: "email" | "telegram";
  success: boolean;
  simulated: boolean;
  recipient?: string;
  error?: string;
  messageId?: string;
}

export interface NotificationLogEntry {
  id: string;
  event: BatchNotificationEventType;
  batchId: string;
  channels: NotificationResult[];
  timestamp: string;
}
