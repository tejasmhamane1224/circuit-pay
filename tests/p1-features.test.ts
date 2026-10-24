import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";
import {
  scheduleManager,
  computeNextRunDate,
  frequencyToCron,
} from "@/lib/schedules/schedule-manager";
import {
  outboundWebhookManager,
  signWebhookPayload,
  verifyOutboundWebhookSignature,
} from "@/lib/webhooks/outbound";
import {
  getRequiredApprovalsCount,
  evaluateBatchApprovals,
  hasPermission,
  type BatchApproval,
} from "@/lib/security/roles";
import {
  dispatchBatchLifecycleNotification,
  notificationDispatcher,
} from "@/lib/notifications";
import { payoutStore } from "@/lib/db/payout-store";
import { GET as getSchedules, POST as postSchedules } from "@/app/api/schedules/route";
import { POST as triggerScheduleRoute } from "@/app/api/schedules/[id]/trigger/route";
import {
  GET as getOutboundWebhooks,
  POST as postOutboundWebhooks,
  DELETE as deleteOutboundWebhook,
} from "@/app/api/webhooks/outbound/route";
import {
  GET as getBatchApproval,
  POST as postBatchApproval,
} from "@/app/api/batches/[id]/approve/route";
import { POST as prepareBatch } from "@/app/api/batches/[id]/prepare/route";
import { POST as broadcastBatch } from "@/app/api/batches/[id]/broadcast/route";
import { GET as getVolumeRoute } from "@/app/api/volume/route";

describe("Phase 6: P1 Features Engine", () => {
  beforeEach(() => {
    // Reset defaults before each run
    payoutStore.seedDefaultData();
  });

  // ==========================================
  // 1. RECURRING SCHEDULES
  // ==========================================
  describe("1. Recurring Schedules Engine", () => {
    it("should compute accurate next run dates for weekly, bi-weekly, and monthly schedules", () => {
      const baseDate = new Date("2026-10-01T09:00:00Z");

      const weekly = computeNextRunDate("weekly", baseDate);
      expect(weekly.toISOString()).toBe("2026-10-08T09:00:00.000Z");

      const biweekly = computeNextRunDate("bi-weekly", baseDate);
      expect(biweekly.toISOString()).toBe("2026-10-15T09:00:00.000Z");

      const monthly = computeNextRunDate("monthly", baseDate);
      expect(monthly.toISOString()).toBe("2026-11-01T09:00:00.000Z");
    });

    it("should clamp month-end dates correctly when computing monthly next run dates (e.g. Jan 31 -> Feb 28)", () => {
      // Jan 31, 2026 (non-leap year): Next month has 28 days -> must clamp to Feb 28, not rollover to Mar 3
      const jan31 = new Date("2026-01-31T09:00:00.000Z");
      const febResult = computeNextRunDate("monthly", jan31);
      expect(febResult.toISOString()).toBe("2026-02-28T09:00:00.000Z");

      // Aug 31: Next month (September) has 30 days -> must clamp to Sep 30, not Oct 1
      const aug31 = new Date("2026-08-31T14:30:00.000Z");
      const sepResult = computeNextRunDate("monthly", aug31);
      expect(sepResult.toISOString()).toBe("2026-09-30T14:30:00.000Z");
    });

    it("should convert frequencies to standard cron expressions", () => {
      expect(frequencyToCron("weekly")).toBe("0 9 * * 1");
      expect(frequencyToCron("bi-weekly")).toBe("0 9 1,15 * *");
      expect(frequencyToCron("monthly")).toBe("0 9 1 * *");
    });

    it("should create, list, and retrieve recurring schedules", () => {
      const sched = scheduleManager.createSchedule({
        title: "Dev Team Weekly Grants",
        frequency: "weekly",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "500.00",
            recipientName: "Grantee 1",
          },
        ],
      });

      expect(sched.id).toBeDefined();
      expect(sched.title).toBe("Dev Team Weekly Grants");
      expect(sched.status).toBe("active");
      expect(sched.totalRuns).toBe(0);

      const found = scheduleManager.getSchedule(sched.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(sched.id);

      const all = scheduleManager.listSchedules();
      expect(all.some((s) => s.id === sched.id)).toBe(true);
    });

    it("should trigger schedule execution and auto-create draft payout batch in payoutStore", async () => {
      const sched = scheduleManager.createSchedule({
        title: "Automated Monthly Payroll",
        frequency: "monthly",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "1200.00",
            recipientName: "Lead Contributor",
          },
          {
            recipientWallet: "Bob4hYq7B98gD74G123kLMNop987654321ZYXwvutsr",
            amountFormatted: "800.00",
            recipientName: "Frontend Contributor",
          },
        ],
      });

      const { schedule: updatedSched, batch } = await scheduleManager.triggerSchedule(sched.id);

      // Verify schedule execution updates
      expect(updatedSched.totalRuns).toBe(1);
      expect(updatedSched.lastRunAt).toBeDefined();
      expect(new Date(updatedSched.nextRunAt).getTime()).toBeGreaterThan(Date.now());

      // Verify created batch in store
      expect(batch.id).toBeDefined();
      expect(batch.title).toContain("Automated Monthly Payroll");
      expect(batch.status).toBe("draft");
      expect(batch.items.length).toBe(2);
      expect(batch.totalAmountFormatted).toBe("2000.00");

      const storedBatch = await payoutStore.getPayoutBatch(batch.id);
      expect(storedBatch).not.toBeNull();
      expect(storedBatch?.id).toBe(batch.id);
    });

    it("should reject triggering a paused schedule", async () => {
      const sched = scheduleManager.createSchedule({
        title: "Paused Schedule Test",
        frequency: "weekly",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "100.00",
          },
        ],
      });

      scheduleManager.updateSchedule(sched.id, { status: "paused" });

      await expect(scheduleManager.triggerSchedule(sched.id)).rejects.toThrow(
        /is paused/i
      );
    });

    it("should handle GET and POST /api/schedules endpoints", async () => {
      // GET
      const getReq = new NextRequest("http://localhost:3000/api/schedules");
      const getRes = await getSchedules(getReq);
      const getData = await getRes.json();
      expect(getData.success).toBe(true);
      expect(Array.isArray(getData.schedules)).toBe(true);

      // POST create
      const postReq = new NextRequest("http://localhost:3000/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "API Created Schedule",
          frequency: "bi-weekly",
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          items: [
            {
              recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
              amountFormatted: "450.00",
            },
          ],
        }),
      });
      const postRes = await postSchedules(postReq);
      const postData = await postRes.json();
      expect(postData.success).toBe(true);
      expect(postData.schedule.title).toBe("API Created Schedule");

      // POST trigger via route /api/schedules/[id]/trigger
      const triggerReq = new NextRequest(
        `http://localhost:3000/api/schedules/${postData.schedule.id}/trigger`,
        { method: "POST" }
      );
      const triggerRes = await triggerScheduleRoute(triggerReq, {
        params: Promise.resolve({ id: postData.schedule.id }),
      });
      const triggerData = await triggerRes.json();
      expect(triggerData.success).toBe(true);
      expect(triggerData.batch.id).toBeDefined();
    });
  });

  // ==========================================
  // 2. SIGNED OUTBOUND WEBHOOKS
  // ==========================================
  describe("2. Signed Outbound Webhooks Engine", () => {
    const testSecret = "whsec_test_secret_for_hmac_testing_12345";
    const samplePayload = {
      event: "batch.completed",
      batchId: "batch-xyz-123",
      amountFormatted: "15,000.00",
      status: "completed",
    };

    it("should generate valid HMAC-SHA256 signatures with timestamp tags", () => {
      const fixedTimestamp = 1700000000;
      const { signature, timestamp, signatureHeader } = signWebhookPayload(
        samplePayload,
        testSecret,
        fixedTimestamp
      );

      expect(timestamp).toBe(fixedTimestamp);
      expect(signatureHeader).toBe(`t=${fixedTimestamp},v1=${signature}`);

      // Manual recalculation verification
      const expected = crypto
        .createHmac("sha256", testSecret)
        .update(`${fixedTimestamp}.${JSON.stringify(samplePayload)}`)
        .digest("hex");
      expect(signature).toBe(expected);
    });

    it("should verify HMAC-SHA256 signatures using timing-safe comparisons", () => {
      const fixedTimestamp = Math.floor(Date.now() / 1000);
      const rawBody = JSON.stringify(samplePayload);
      const { signatureHeader } = signWebhookPayload(rawBody, testSecret, fixedTimestamp);

      // Valid signature must pass
      const isValid = verifyOutboundWebhookSignature(rawBody, signatureHeader, testSecret);
      expect(isValid).toBe(true);

      // Tampered payload must fail
      const tamperedBody = JSON.stringify({ ...samplePayload, amountFormatted: "99,999.00" });
      const isTamperedValid = verifyOutboundWebhookSignature(
        tamperedBody,
        signatureHeader,
        testSecret
      );
      expect(isTamperedValid).toBe(false);

      // Wrong secret must fail
      const isWrongSecretValid = verifyOutboundWebhookSignature(
        rawBody,
        signatureHeader,
        "whsec_wrong_attacker_secret"
      );
      expect(isWrongSecretValid).toBe(false);
    });

    it("should reject signatures outside the clock skew tolerance window", () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const rawBody = JSON.stringify(samplePayload);
      const { signatureHeader } = signWebhookPayload(rawBody, testSecret, staleTimestamp);

      // Default tolerance is 300 seconds (5 min); 10 min must fail
      const isValid = verifyOutboundWebhookSignature(rawBody, signatureHeader, testSecret, 300);
      expect(isValid).toBe(false);

      // Increasing tolerance allows it
      const isLenientValid = verifyOutboundWebhookSignature(
        rawBody,
        signatureHeader,
        testSecret,
        900
      );
      expect(isLenientValid).toBe(true);
    });

    it("should verify webhook signatures with explicit timestamp header and case-insensitive hex", () => {
      const nowTs = Math.floor(Date.now() / 1000);
      const rawBody = JSON.stringify(samplePayload);
      const { signature } = signWebhookPayload(rawBody, testSecret, nowTs);

      // 1. Separate explicit timestamp with uppercase signature hex
      const uppercaseSig = signature.toUpperCase();
      const isValidExplicit = verifyOutboundWebhookSignature(
        rawBody,
        `v1=${uppercaseSig}`,
        testSecret,
        300,
        nowTs
      );
      expect(isValidExplicit).toBe(true);

      // 2. Bare signature with explicit timestamp
      const isValidBare = verifyOutboundWebhookSignature(
        rawBody,
        signature,
        testSecret,
        300,
        nowTs
      );
      expect(isValidBare).toBe(true);
    });

    it("should register customer webhook subscriptions and dispatch events", async () => {
      const sub = outboundWebhookManager.registerWebhook({
        url: "https://example.com/webhooks/listener",
        events: ["batch.completed", "batch.failed"],
        description: "ERP Accounting Listener",
      });

      expect(sub.id).toBeDefined();
      expect(sub.secret.startsWith("whsec_")).toBe(true);
      expect(sub.events).toContain("batch.completed");

      const deliveries = await outboundWebhookManager.dispatchOutboundEvent(
        "batch.completed",
        samplePayload
      );

      expect(deliveries.length).toBeGreaterThan(0);
      const myDelivery = deliveries.find((d) => d.subscriptionId === sub.id);
      expect(myDelivery).toBeDefined();
      expect(myDelivery?.event).toBe("batch.completed");
      expect(myDelivery?.success).toBe(true);
    });

    it("should handle /api/webhooks/outbound CRUD and test actions", async () => {
      // 1. Register via POST
      const postReq = new NextRequest("http://localhost:3000/api/webhooks/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/api/webhooks",
          events: ["batch.settled"],
          description: "Integration test listener",
        }),
      });
      const postRes = await postOutboundWebhooks(postReq);
      const postData = await postRes.json();
      expect(postData.success).toBe(true);
      expect(postData.webhook.id).toBeDefined();

      const newId = postData.webhook.id;

      // 2. List via GET
      const getReq = new NextRequest("http://localhost:3000/api/webhooks/outbound");
      const getRes = await getOutboundWebhooks(getReq);
      const getData = await getRes.json();
      expect(getData.success).toBe(true);
      expect(getData.webhooks.some((w: { id: string }) => w.id === newId)).toBe(true);

      // 3. Test dispatch via POST action: "test"
      const testReq = new NextRequest("http://localhost:3000/api/webhooks/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const testRes = await postOutboundWebhooks(testReq);
      const testData = await testRes.json();
      expect(testData.success).toBe(true);
      expect(testData.action).toBe("test_dispatched");

      // 4. Delete via DELETE
      const deleteReq = new NextRequest(
        `http://localhost:3000/api/webhooks/outbound?id=${newId}`,
        { method: "DELETE" }
      );
      const delRes = await deleteOutboundWebhook(deleteReq);
      const delData = await delRes.json();
      expect(delData.success).toBe(true);
    });
  });

  // ==========================================
  // 3. TEAM ROLES & MULTI-APPROVAL POLICY
  // ==========================================
  describe("3. Team Roles & Multi-Approval Engine", () => {
    it("should enforce role-based permissions correctly", () => {
      expect(hasPermission("owner", "canApproveThresholdBatch")).toBe(true);
      expect(hasPermission("admin", "canApproveThresholdBatch")).toBe(true);
      expect(hasPermission("member", "canApproveThresholdBatch")).toBe(false);
      expect(hasPermission("viewer", "canApproveThresholdBatch")).toBe(false);

      expect(hasPermission("owner", "canDeleteBatch")).toBe(true);
      expect(hasPermission("admin", "canDeleteBatch")).toBe(false);
    });

    it("should require 1 approval for batches under the $10,000 USD threshold", () => {
      const required = getRequiredApprovalsCount(5000);
      expect(required).toBe(1);

      const approvals: BatchApproval[] = [
        {
          id: "app-1",
          batchId: "batch-1",
          approverWallet: "AdminWallet1",
          role: "admin",
          approvedAt: new Date().toISOString(),
        },
      ];

      const evaluation = evaluateBatchApprovals(5000, approvals);
      expect(evaluation.isApproved).toBe(true);
      expect(evaluation.requiredApprovals).toBe(1);
      expect(evaluation.remainingApprovals).toBe(0);
    });

    it("should require 2 distinct admin/owner approvals for batches >= $10,000 USD", () => {
      const required = getRequiredApprovalsCount(15000);
      expect(required).toBe(2);

      // Single admin approval -> incomplete
      const approvals1: BatchApproval[] = [
        {
          id: "app-1",
          batchId: "batch-2",
          approverWallet: "AdminWallet1",
          role: "admin",
          approvedAt: new Date().toISOString(),
        },
      ];
      const eval1 = evaluateBatchApprovals(15000, approvals1);
      expect(eval1.isApproved).toBe(false);
      expect(eval1.requiredApprovals).toBe(2);
      expect(eval1.remainingApprovals).toBe(1);
      expect(eval1.rejectionReason).toContain("exceeds the $10,000 multi-approval threshold");

      // Second approval from same wallet must NOT satisfy threshold
      const duplicateApprovals: BatchApproval[] = [
        ...approvals1,
        {
          id: "app-2",
          batchId: "batch-2",
          approverWallet: "AdminWallet1", // duplicate
          role: "admin",
          approvedAt: new Date().toISOString(),
        },
      ];
      const evalDup = evaluateBatchApprovals(15000, duplicateApprovals);
      expect(evalDup.isApproved).toBe(false);
      expect(evalDup.remainingApprovals).toBe(1);

      // Second approval from a different admin -> fully approved
      const twoApprovals: BatchApproval[] = [
        ...approvals1,
        {
          id: "app-3",
          batchId: "batch-2",
          approverWallet: "AdminWallet2",
          role: "owner",
          approvedAt: new Date().toISOString(),
        },
      ];
      const eval2 = evaluateBatchApprovals(15000, twoApprovals);
      expect(eval2.isApproved).toBe(true);
      expect(eval2.remainingApprovals).toBe(0);
      expect(eval2.approverWallets).toEqual(["AdminWallet1", "AdminWallet2"]);
    });

    it("should not count member approvals toward multi-approval threshold batches", () => {
      const approvalsWithMember: BatchApproval[] = [
        {
          id: "app-1",
          batchId: "batch-3",
          approverWallet: "MemberWallet1",
          role: "member", // Member cannot approve threshold
          approvedAt: new Date().toISOString(),
        },
        {
          id: "app-2",
          batchId: "batch-3",
          approverWallet: "AdminWallet1",
          role: "admin",
          approvedAt: new Date().toISOString(),
        },
      ];

      const evaluation = evaluateBatchApprovals(25000, approvalsWithMember);
      expect(evaluation.isApproved).toBe(false);
      expect(evaluation.currentCount).toBe(1); // Only AdminWallet1 counted
      expect(evaluation.remainingApprovals).toBe(1);
    });

    it("should record approvals in payoutStore and transition batch status to awaiting_signature upon full approval", async () => {
      // Create a batch in store with total >= 10k
      const batch = await payoutStore.createPayoutBatch({
        title: "Executive Bonus Distribution",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "12500.00",
          },
        ],
      });

      expect(batch.status).toBe("draft");

      // First approval
      const res1 = await payoutStore.addBatchApproval(batch.id, {
        approverWallet: "SignerAdminA1",
        role: "admin",
        notes: "First review passed",
      });
      expect(res1.evaluation.isApproved).toBe(false);
      expect(res1.evaluation.remainingApprovals).toBe(1);

      // Verify duplicate approval error
      await expect(
        payoutStore.addBatchApproval(batch.id, {
          approverWallet: "SignerAdminA1",
          role: "admin",
        })
      ).rejects.toThrow(/already approved/i);

      // Second approval by different admin
      const res2 = await payoutStore.addBatchApproval(batch.id, {
        approverWallet: "SignerOwnerB2",
        role: "owner",
        notes: "Final sign-off",
      });
      expect(res2.evaluation.isApproved).toBe(true);

      // The batch should transition status
      const updated = await payoutStore.getPayoutBatch(batch.id);
      expect(updated?.status).toBe("awaiting_signature");
    });

    it("should reject member approval on threshold batches via /api/batches/[id]/approve endpoint", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "High Value Payroll",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "20000.00",
          },
        ],
      });

      // Member attempts to approve
      const memberReq = new NextRequest(
        `http://localhost:3000/api/batches/${batch.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approverWallet: "MemberWalletX",
            role: "member",
          }),
        }
      );
      const memberRes = await postBatchApproval(memberReq, {
        params: Promise.resolve({ id: batch.id }),
      });
      expect(memberRes.status).toBe(403);
      const memberData = await memberRes.json();
      expect(memberData.error).toContain("is not permitted to approve threshold batches");

      // Admin approves successfully
      const adminReq = new NextRequest(
        `http://localhost:3000/api/batches/${batch.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approverWallet: "AdminWalletY",
            role: "admin",
          }),
        }
      );
      const adminRes = await postBatchApproval(adminReq, {
        params: Promise.resolve({ id: batch.id }),
      });
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.success).toBe(true);
      expect(adminData.approval.approverWallet).toBe("AdminWalletY");

      // Query approvals via GET
      const getReq = new NextRequest(
        `http://localhost:3000/api/batches/${batch.id}/approve`
      );
      const getRes = await getBatchApproval(getReq, {
        params: Promise.resolve({ id: batch.id }),
      });
      const getData = await getRes.json();
      expect(getData.success).toBe(true);
      expect(getData.approvals.length).toBe(1);
    });

    it("should correctly handle floating-point threshold boundary conditions ($10,000.00 vs $9,999.99)", () => {
      // Exactly $10,000.00 requires 2 approvals
      expect(getRequiredApprovalsCount(10000.0)).toBe(2);
      expect(getRequiredApprovalsCount(10000.000001)).toBe(2);

      // Under threshold ($9,999.99 and $9,999.90) requires 1 approval
      expect(getRequiredApprovalsCount(9999.99)).toBe(1);
      expect(getRequiredApprovalsCount(9999.90)).toBe(1);
    });

    it("should reject viewer role from approving any batch via /api/batches/[id]/approve", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "Standard Batch For Viewer Test",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "500.00",
          },
        ],
      });

      const viewerReq = new NextRequest(
        `http://localhost:3000/api/batches/${batch.id}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approverWallet: "ViewerWalletZ",
            role: "viewer",
          }),
        }
      );
      const viewerRes = await postBatchApproval(viewerReq, {
        params: Promise.resolve({ id: batch.id }),
      });
      expect(viewerRes.status).toBe(403);
      const viewerData = await viewerRes.json();
      expect(viewerData.error).toContain("read-only and not permitted to approve batches");
    });

    it("should block POST /prepare and POST /broadcast on unapproved threshold batches and allow once approved", async () => {
      const thresholdBatch = await payoutStore.createPayoutBatch({
        title: "Protected Executive Payroll",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "15000.00",
          },
        ],
      });

      // 1. Unapproved threshold batch cannot be prepared
      const prepReq = new NextRequest(
        `http://localhost:3000/api/batches/${thresholdBatch.id}/prepare`,
        { method: "POST" }
      );
      const prepRes = await prepareBatch(prepReq, {
        params: Promise.resolve({ id: thresholdBatch.id }),
      });
      expect(prepRes.status).toBe(403);
      const prepData = await prepRes.json();
      expect(prepData.error).toContain("requires multi-approval before preparation/signing");

      // 2. Unapproved threshold batch cannot be broadcast
      const bcastReq = new NextRequest(
        `http://localhost:3000/api/batches/${thresholdBatch.id}/broadcast`,
        { method: "POST" }
      );
      const bcastRes = await broadcastBatch(bcastReq, {
        params: Promise.resolve({ id: thresholdBatch.id }),
      });
      expect(bcastRes.status).toBe(403);
      const bcastData = await bcastRes.json();
      expect(bcastData.error).toContain("requires multi-approval before signing/broadcast");

      // 3. Submit first approval (1/2) -> Still blocked
      await payoutStore.addBatchApproval(thresholdBatch.id, {
        approverWallet: "AdminWallet1",
        role: "admin",
      });

      const prepRes2 = await prepareBatch(prepReq, {
        params: Promise.resolve({ id: thresholdBatch.id }),
      });
      expect(prepRes2.status).toBe(403);

      // 4. Submit second approval (2/2) -> Unlocks prepare & broadcast
      await payoutStore.addBatchApproval(thresholdBatch.id, {
        approverWallet: "OwnerWallet2",
        role: "owner",
      });

      const prepRes3 = await prepareBatch(prepReq, {
        params: Promise.resolve({ id: thresholdBatch.id }),
      });
      expect(prepRes3.status).toBe(200);
      const prepData3 = await prepRes3.json();
      expect(prepData3.success).toBe(true);
    });
  });

  // ==========================================
  // 4. NOTIFICATIONS ENGINE
  // ==========================================
  describe("4. Notifications Engine", () => {
    it("should dispatch batch lifecycle events and record notification logs", async () => {
      const log = await dispatchBatchLifecycleNotification("batch.completed", {
        batchId: "batch-notify-test",
        title: "May Engineering Stipends",
        totalAmountFormatted: "8,500.00",
        tokenSymbol: "USDC",
        recipientCount: 12,
        network: "devnet",
      });

      expect(log.id).toBeDefined();
      expect(log.event).toBe("batch.completed");
      expect(log.channels.length).toBe(2); // email + telegram

      const emailResult = log.channels.find((c) => c.channel === "email");
      const telegramResult = log.channels.find((c) => c.channel === "telegram");

      expect(emailResult?.success).toBe(true);
      expect(telegramResult?.success).toBe(true);

      const logs = notificationDispatcher.getNotificationLogs("batch-notify-test");
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].batchId).toBe("batch-notify-test");
    });

    it("should automatically dispatch batch.awaiting_approval notification upon threshold batch creation", async () => {
      const highValueBatch = await payoutStore.createPayoutBatch({
        title: "Treasury Quarterly Bonus",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        items: [
          {
            recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
            amountFormatted: "25000.00",
          },
        ],
      });

      // Confirm notification was automatically recorded for this batch
      const logs = notificationDispatcher.getNotificationLogs(highValueBatch.id);
      expect(logs.length).toBeGreaterThan(0);
      const approvalLog = logs.find((l) => l.event === "batch.awaiting_approval");
      expect(approvalLog).toBeDefined();
      expect(approvalLog?.batchId).toBe(highValueBatch.id);
    });
  });

  // ==========================================
  // 5. REAL-DATA COUNTERS
  // ==========================================
  describe("5. Real-Data Live Telemetry Counters", () => {
    it("should calculate volume processed and fees saved strictly from real store data", async () => {
      const req = new NextRequest("http://localhost:3000/api/volume");
      const res = await getVolumeRoute(req);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.metrics).toBeDefined();

      // Real data checks: volumeProcessedUsd must equal maximum of principal ledger or batch sum
      expect(typeof data.metrics.volumeProcessedUsd).toBe("number");
      expect(typeof data.metrics.feesSavedUsd).toBe("number");
      expect(typeof data.metrics.batchesCount).toBe("number");
      expect(typeof data.metrics.recipientsCount).toBe("number");

      // Verify fee savings formula: 2.0% net savings vs 2.50% custodial wire
      const expectedSavings = data.metrics.volumeProcessedUsd * 0.02;
      expect(data.metrics.feesSavedUsd).toBeCloseTo(expectedSavings, 2);
    });
  });
});
