import crypto from "node:crypto";
import { payoutStore, type StoredBatch } from "@/lib/db/payout-store";

export type ScheduleFrequency = "weekly" | "bi-weekly" | "monthly";
export type ScheduleStatus = "active" | "paused" | "cancelled";

export interface RecurringScheduleItem {
  recipientWallet: string;
  amountFormatted: string;
  recipientName?: string;
  amountRaw?: string;
}

export interface RecurringSchedule {
  id: string;
  organizationId: string;
  title: string;
  frequency: ScheduleFrequency;
  cronExpression: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenDecimals: number;
  senderWallet: string;
  network: "mainnet-beta" | "devnet";
  hops: number;
  arrivalSeconds: number;
  items: RecurringScheduleItem[];
  status: ScheduleStatus;
  nextRunAt: string;
  lastRunAt?: string;
  totalRuns: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleParams {
  organizationId?: string;
  title: string;
  frequency: ScheduleFrequency;
  cronExpression?: string;
  tokenMint: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  senderWallet?: string;
  network?: "mainnet-beta" | "devnet";
  hops?: number;
  arrivalSeconds?: number;
  items: RecurringScheduleItem[];
  startDate?: string;
}

export function computeNextRunDate(frequency: ScheduleFrequency, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate.getTime());
  switch (frequency) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "bi-weekly":
      next.setDate(next.getDate() + 14);
      break;
    case "monthly": {
      const originalDay = fromDate.getDate();
      next.setMonth(next.getMonth() + 1);
      // If the day rolled over into the month after (e.g. Jan 31 -> Mar 3), clamp to the last day of target month
      if (next.getDate() !== originalDay) {
        next.setDate(0);
      }
      break;
    }
  }
  return next;
}

export function frequencyToCron(frequency: ScheduleFrequency): string {
  switch (frequency) {
    case "weekly":
      return "0 9 * * 1"; // Every Monday at 09:00 UTC
    case "bi-weekly":
      return "0 9 1,15 * *"; // 1st & 15th at 09:00 UTC
    case "monthly":
      return "0 9 1 * *"; // 1st of month at 09:00 UTC
  }
}

class ScheduleManager {
  private schedules = new Map<string, RecurringSchedule>();

  constructor() {
    this.seedDefaultSchedule();
  }

  private seedDefaultSchedule() {
    const id = "sched-core-dev-weekly";
    const nextRun = computeNextRunDate("weekly");
    this.schedules.set(id, {
      id,
      organizationId: "00000000-0000-0000-0000-000000000001",
      title: "Weekly Engineering & Contributor Stipends",
      frequency: "weekly",
      cronExpression: "0 9 * * 1",
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      network: "devnet",
      hops: 4,
      arrivalSeconds: 900,
      items: [
        {
          recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
          amountFormatted: "1250.00",
          recipientName: "Core Protocol Lead",
        },
        {
          recipientWallet: "Bob4hYq7B98gD74G123kLMNop987654321ZYXwvutsr",
          amountFormatted: "950.00",
          recipientName: "Frontend Engineer",
        },
      ],
      status: "active",
      nextRunAt: nextRun.toISOString(),
      totalRuns: 3,
      createdAt: new Date(Date.now() - 21 * 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  public createSchedule(params: CreateScheduleParams): RecurringSchedule {
    const id = `sched-${crypto.randomUUID()}`;
    const now = new Date();
    const frequency = params.frequency;
    const cronExpression = params.cronExpression || frequencyToCron(frequency);
    const startDate = params.startDate ? new Date(params.startDate) : now;
    const nextRunAt = computeNextRunDate(frequency, startDate).toISOString();

    const schedule: RecurringSchedule = {
      id,
      organizationId: params.organizationId || "00000000-0000-0000-0000-000000000001",
      title: params.title,
      frequency,
      cronExpression,
      tokenMint: params.tokenMint,
      tokenSymbol: params.tokenSymbol || "USDC",
      tokenDecimals: params.tokenDecimals ?? 6,
      senderWallet: params.senderWallet || "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      network: params.network || "devnet",
      hops: params.hops || 4,
      arrivalSeconds: params.arrivalSeconds || 900,
      items: params.items,
      status: "active",
      nextRunAt,
      totalRuns: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.schedules.set(id, schedule);
    return schedule;
  }

  public listSchedules(organizationId?: string): RecurringSchedule[] {
    const all = Array.from(this.schedules.values());
    if (!organizationId) return all;
    return all.filter((s) => s.organizationId === organizationId);
  }

  public getSchedule(id: string): RecurringSchedule | null {
    return this.schedules.get(id) || null;
  }

  public updateSchedule(id: string, updates: Partial<RecurringSchedule>): RecurringSchedule {
    const schedule = this.schedules.get(id);
    if (!schedule) {
      throw new Error(`Schedule ${id} not found`);
    }

    Object.assign(schedule, updates, { updatedAt: new Date().toISOString() });
    return schedule;
  }

  public deleteSchedule(id: string): boolean {
    return this.schedules.delete(id);
  }

  /**
   * Executes a recurring schedule:
   * Generates a draft payout batch from the scheduled payout items and updates nextRunAt.
   */
  public async triggerSchedule(id: string): Promise<{ schedule: RecurringSchedule; batch: StoredBatch }> {
    const schedule = this.schedules.get(id);
    if (!schedule) {
      throw new Error(`Schedule ${id} not found`);
    }

    if (schedule.status === "paused") {
      throw new Error(`Schedule ${id} is paused; unpause before triggering`);
    }

    const runTimestamp = new Date().toISOString().split("T")[0];
    const batchTitle = `${schedule.title} (${runTimestamp})`;

    // Automatically create draft payout batch in payoutStore
    const batch = await payoutStore.createPayoutBatch({
      organizationId: schedule.organizationId,
      title: batchTitle,
      senderWallet: schedule.senderWallet,
      tokenMint: schedule.tokenMint,
      tokenSymbol: schedule.tokenSymbol,
      tokenDecimals: schedule.tokenDecimals,
      network: schedule.network,
      hops: schedule.hops,
      arrivalSeconds: schedule.arrivalSeconds,
      items: schedule.items.map((i) => ({
        recipientWallet: i.recipientWallet,
        amountFormatted: i.amountFormatted,
        recipientName: i.recipientName,
      })),
    });

    const now = new Date();
    schedule.lastRunAt = now.toISOString();
    schedule.totalRuns += 1;
    schedule.nextRunAt = computeNextRunDate(schedule.frequency, now).toISOString();
    schedule.updatedAt = now.toISOString();

    await payoutStore.recordAuditLog({
      organizationId: schedule.organizationId,
      actorWallet: "scheduler",
      action: "schedule.triggered",
      resourceType: "recurring_schedule",
      resourceId: schedule.id,
      details: {
        batchId: batch.id,
        runNumber: schedule.totalRuns,
        nextRunAt: schedule.nextRunAt,
      },
    });

    return { schedule, batch };
  }
}

const globalForSchedule = globalThis as unknown as { scheduleManager?: ScheduleManager };
export const scheduleManager = globalForSchedule.scheduleManager ?? new ScheduleManager();
globalForSchedule.scheduleManager = scheduleManager;
