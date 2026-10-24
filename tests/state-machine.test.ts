import { describe, it, expect } from "vitest";
import {
  isValidBatchTransition,
  assertValidBatchTransition,
  isValidTransferTransition,
  assertValidTransferTransition,
  isValidItemTransition,
  assertValidItemTransition,
  aggregateBatchStatusFromChunks,
  isTerminalBatchStatus,
} from "../src/lib/multihopper/state-machine";

describe("MultiHopper Status State Machine", () => {
  describe("Batch State Transitions", () => {
    it("allows valid forward transitions", () => {
      expect(isValidBatchTransition("draft", "quoting")).toBe(true);
      expect(isValidBatchTransition("quoting", "awaiting_signature")).toBe(true);
      expect(isValidBatchTransition("awaiting_signature", "processing")).toBe(true);
      expect(isValidBatchTransition("processing", "completed")).toBe(true);
      expect(isValidBatchTransition("processing", "refunded")).toBe(true);
      expect(isValidBatchTransition("processing", "failed")).toBe(true);
    });

    it("allows self-transitions (no-op)", () => {
      expect(isValidBatchTransition("draft", "draft")).toBe(true);
      expect(isValidBatchTransition("processing", "processing")).toBe(true);
      expect(isValidBatchTransition("completed", "completed")).toBe(true);
    });

    it("forbids invalid transitions", () => {
      expect(isValidBatchTransition("completed", "draft")).toBe(false);
      expect(isValidBatchTransition("completed", "processing")).toBe(false);
      expect(isValidBatchTransition("draft", "completed")).toBe(false);
      expect(isValidBatchTransition("refunded", "processing")).toBe(false);
    });

    it("assertValidBatchTransition throws informative error for forbidden transition", () => {
      expect(() => assertValidBatchTransition("completed", "quoting")).toThrow(
        /Invalid batch state transition: cannot transition from 'completed' to 'quoting'/
      );
    });

    it("correctly identifies terminal statuses", () => {
      expect(isTerminalBatchStatus("completed")).toBe(true);
      expect(isTerminalBatchStatus("refunded")).toBe(true);
      expect(isTerminalBatchStatus("cancelled")).toBe(true);
      expect(isTerminalBatchStatus("processing")).toBe(false);
      expect(isTerminalBatchStatus("draft")).toBe(false);
    });
  });

  describe("Transfer State Transitions", () => {
    it("allows valid transfer transitions", () => {
      expect(isValidTransferTransition("created", "quote")).toBe(true);
      expect(isValidTransferTransition("quote", "awaiting_signature")).toBe(true);
      expect(isValidTransferTransition("awaiting_signature", "processing")).toBe(true);
      expect(isValidTransferTransition("processing", "completed")).toBe(true);
      expect(isValidTransferTransition("processing", "failed")).toBe(true);
      expect(isValidTransferTransition("failed", "recoverable")).toBe(true);
      expect(isValidTransferTransition("failed", "refunded")).toBe(true);
      expect(isValidTransferTransition("awaiting_signature", "refunded")).toBe(true);
    });

    it("assertValidTransferTransition throws on invalid transition", () => {
      expect(() => assertValidTransferTransition("completed", "created")).toThrow(
        /Invalid transfer state transition/
      );
    });
  });

  describe("aggregateBatchStatusFromChunks", () => {
    it("returns completed if all chunks completed", () => {
      expect(aggregateBatchStatusFromChunks(["completed", "completed"])).toBe("completed");
    });

    it("returns processing if any chunk is processing or active", () => {
      expect(aggregateBatchStatusFromChunks(["completed", "processing"])).toBe("processing");
      expect(aggregateBatchStatusFromChunks(["active", "quote"])).toBe("processing");
    });

    it("returns partially_failed if some chunks failed and others completed", () => {
      expect(aggregateBatchStatusFromChunks(["completed", "failed"])).toBe("partially_failed");
    });

    it("returns partially_failed if some chunks refunded and others completed", () => {
      expect(aggregateBatchStatusFromChunks(["completed", "refunded"])).toBe("partially_failed");
    });

    it("returns partially_failed for mixed failed and refunded chunks", () => {
      expect(aggregateBatchStatusFromChunks(["failed", "refunded"])).toBe("partially_failed");
    });

    it("returns failed if all chunks failed", () => {
      expect(aggregateBatchStatusFromChunks(["failed", "failed"])).toBe("failed");
    });

    it("returns refunded if all chunks refunded", () => {
      expect(aggregateBatchStatusFromChunks(["refunded", "refunded"])).toBe("refunded");
    });

    it("returns awaiting_signature if chunks awaiting signature and none processing", () => {
      expect(aggregateBatchStatusFromChunks(["awaiting_signature", "quote"])).toBe("awaiting_signature");
    });

    it("returns draft for empty chunk list", () => {
      expect(aggregateBatchStatusFromChunks([])).toBe("draft");
    });
  });

  describe("PayoutItem State Transitions", () => {
    it("allows valid forward item transitions", () => {
      expect(isValidItemTransition("pending", "routing")).toBe(true);
      expect(isValidItemTransition("routing", "delivered")).toBe(true);
      expect(isValidItemTransition("routing", "failed")).toBe(true);
      expect(isValidItemTransition("pending", "processing")).toBe(true);
      expect(isValidItemTransition("processing", "paid")).toBe(true);
      expect(isValidItemTransition("processing", "failed")).toBe(true);
      expect(isValidItemTransition("failed", "processing")).toBe(true);
      expect(isValidItemTransition("failed", "paid")).toBe(true);
      expect(isValidItemTransition("pending", "refunded")).toBe(true);
    });

    it("forbids invalid item transitions away from terminal delivered state", () => {
      expect(isValidItemTransition("delivered", "routing")).toBe(false);
      expect(isValidItemTransition("delivered", "pending")).toBe(false);
      expect(isValidItemTransition("delivered", "failed")).toBe(false);
      expect(isValidItemTransition("delivered", "delivered")).toBe(true);
      expect(() => assertValidItemTransition("delivered", "routing")).toThrow(/Invalid payout item state transition/);
    });

    it("forbids invalid item transitions away from terminal paid state", () => {
      expect(isValidItemTransition("paid", "processing")).toBe(false);
      expect(isValidItemTransition("paid", "pending")).toBe(false);
      expect(isValidItemTransition("paid", "failed")).toBe(false);
      expect(isValidItemTransition("paid", "paid")).toBe(true);
      expect(() => assertValidItemTransition("paid", "processing")).toThrow(/Invalid payout item state transition/);
    });
  });
});
