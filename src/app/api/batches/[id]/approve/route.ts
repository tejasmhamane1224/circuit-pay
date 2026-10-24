import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import {
  type Role,
  DEFAULT_APPROVAL_POLICY,
  evaluateBatchApprovals,
  hasPermission,
} from "@/lib/security/roles";
import { captureException } from "@/lib/monitoring/sentry";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const batch = await payoutStore.getPayoutBatch(id);

    if (!batch) {
      return NextResponse.json(
        { success: false, error: `Batch ${id} not found` },
        { status: 404 }
      );
    }

    const approvals = payoutStore.getBatchApprovals(id);
    const totalUsd = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    const evaluation = evaluateBatchApprovals(totalUsd, approvals);

    return NextResponse.json({
      success: true,
      batchId: id,
      totalAmountFormatted: batch.totalAmountFormatted,
      tokenSymbol: batch.tokenSymbol,
      status: batch.status,
      approvals,
      policy: DEFAULT_APPROVAL_POLICY,
      evaluation,
    });
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/batches/[id]/approve", method: "GET" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const batch = await payoutStore.getPayoutBatch(id);

    if (!batch) {
      return NextResponse.json(
        { success: false, error: `Batch ${id} not found` },
        { status: 404 }
      );
    }

    const body = await req.json();
    const {
      approverWallet,
      role = "admin",
      notes,
    } = body;

    if (!approverWallet || typeof approverWallet !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing required approverWallet" },
        { status: 400 }
      );
    }

    const validRoles: Role[] = ["owner", "admin", "member", "viewer"];
    if (!validRoles.includes(role as Role)) {
      return NextResponse.json(
        { success: false, error: `Invalid role: must be one of ${validRoles.join(", ")}` },
        { status: 400 }
      );
    }

    const userRole = role as Role;
    if (!hasPermission(userRole, "canApproveBatch")) {
      return NextResponse.json(
        {
          success: false,
          error: `Forbidden: role '${userRole}' is read-only and not permitted to approve batches`,
        },
        { status: 403 }
      );
    }

    const totalUsd = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    const roundedUsd = Math.round((totalUsd + Number.EPSILON) * 100) / 100;
    const isThresholdBatch = roundedUsd >= DEFAULT_APPROVAL_POLICY.thresholdUsd;

    // Check if role is allowed to approve threshold batches
    if (isThresholdBatch && !hasPermission(userRole, "canApproveThresholdBatch")) {
      return NextResponse.json(
        {
          success: false,
          error: `Forbidden: role '${userRole}' is not permitted to approve threshold batches (>= $${DEFAULT_APPROVAL_POLICY.thresholdUsd.toLocaleString()} USD)`,
        },
        { status: 403 }
      );
    }

    // Check if wallet already approved
    const existingApprovals = payoutStore.getBatchApprovals(id);
    if (existingApprovals.some((a) => a.approverWallet === approverWallet)) {
      return NextResponse.json(
        {
          success: false,
          error: `Approver wallet ${approverWallet} has already approved batch ${id}`,
        },
        { status: 400 }
      );
    }

    // Record approval in store
    const { approval, evaluation } = await payoutStore.addBatchApproval(id, {
      approverWallet,
      role: userRole,
      notes,
    });

    // If fully approved and currently in draft, move batch status to awaiting_signature
    if (evaluation.isApproved && batch.status === "draft") {
      await payoutStore.updateBatchStatus(id, "awaiting_signature");
    }

    return NextResponse.json({
      success: true,
      message: `Approval recorded for batch ${id}`,
      batchId: id,
      approval,
      evaluation,
      canSign: evaluation.isApproved,
    });
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/batches/[id]/approve", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
