/**
 * Role-Based Access Control (RBAC) & Multi-Approval Policy Engine
 * 
 * Roles:
 * - owner: Full administrative authority across organization, rules, webhooks, signing, deletion
 * - admin: Can create batches, approve payouts, sign, and manage outbound webhooks
 * - member: Can submit draft payout batches, view batch history (cannot approve threshold payouts)
 * - viewer: Read-only access to dashboard, reconciliation reports, and audit logs
 */

export type Role = "owner" | "admin" | "member" | "viewer";

export interface BatchApproval {
  id: string;
  batchId: string;
  approverWallet: string;
  role: Role;
  approvedAt: string;
  notes?: string;
}

export interface ApprovalPolicy {
  thresholdUsd: number;
  thresholdRequiredApprovals: number;
  standardRequiredApprovals: number;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  thresholdUsd: 10_000, // Payouts >= $10k require multi-approval
  thresholdRequiredApprovals: 2,
  standardRequiredApprovals: 1,
};

export const ROLE_PERMISSIONS = {
  owner: {
    canCreateBatch: true,
    canApproveBatch: true,
    canApproveThresholdBatch: true,
    canSignBatch: true,
    canDeleteBatch: true,
    canManageWebhooks: true,
    canManageSchedules: true,
    canManageMembers: true,
  },
  admin: {
    canCreateBatch: true,
    canApproveBatch: true,
    canApproveThresholdBatch: true,
    canSignBatch: true,
    canDeleteBatch: false,
    canManageWebhooks: true,
    canManageSchedules: true,
    canManageMembers: false,
  },
  member: {
    canCreateBatch: true,
    canApproveBatch: true,
    canApproveThresholdBatch: false,
    canSignBatch: false,
    canDeleteBatch: false,
    canManageWebhooks: false,
    canManageSchedules: false,
    canManageMembers: false,
  },
  viewer: {
    canCreateBatch: false,
    canApproveBatch: false,
    canApproveThresholdBatch: false,
    canSignBatch: false,
    canDeleteBatch: false,
    canManageWebhooks: false,
    canManageSchedules: false,
    canManageMembers: false,
  },
} as const;

export function hasPermission(
  role: Role,
  permission: keyof typeof ROLE_PERMISSIONS["owner"]
): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

/**
 * Calculates how many approvals are required for a batch based on its total USD value.
 * Handles floating-point epsilon rounding at boundary thresholds.
 */
export function getRequiredApprovalsCount(
  totalUsd: number,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY
): number {
  const roundedUsd = Math.round((totalUsd + Number.EPSILON) * 100) / 100;
  if (roundedUsd >= policy.thresholdUsd) {
    return policy.thresholdRequiredApprovals;
  }
  return policy.standardRequiredApprovals;
}

/**
 * Evaluates whether a set of approvals fulfills the policy for a batch.
 */
export function evaluateBatchApprovals(
  totalUsd: number,
  approvals: BatchApproval[],
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY
): {
  isApproved: boolean;
  requiredApprovals: number;
  currentCount: number;
  remainingApprovals: number;
  approverWallets: string[];
  rejectionReason?: string;
} {
  const roundedUsd = Math.round((totalUsd + Number.EPSILON) * 100) / 100;
  const requiredApprovals = getRequiredApprovalsCount(roundedUsd, policy);
  const isThreshold = roundedUsd >= policy.thresholdUsd;

  // Filter out any approvers whose role cannot approve
  const validApprovals: BatchApproval[] = [];
  const seenWallets = new Set<string>();

  for (const app of approvals) {
    if (seenWallets.has(app.approverWallet)) {
      continue; // Duplicate approval ignored
    }
    seenWallets.add(app.approverWallet);

    if (isThreshold) {
      if (hasPermission(app.role, "canApproveThresholdBatch")) {
        validApprovals.push(app);
      }
    } else {
      if (hasPermission(app.role, "canApproveBatch")) {
        validApprovals.push(app);
      }
    }
  }

  const currentCount = validApprovals.length;
  const isApproved = currentCount >= requiredApprovals;
  const remainingApprovals = Math.max(0, requiredApprovals - currentCount);

  let rejectionReason: string | undefined;
  if (!isApproved) {
    if (isThreshold) {
      rejectionReason = `Batch total of $${roundedUsd.toLocaleString()} exceeds the $${policy.thresholdUsd.toLocaleString()} multi-approval threshold. Requires ${requiredApprovals} distinct admin/owner approvals (current valid: ${currentCount}).`;
    } else {
      rejectionReason = `Batch requires ${requiredApprovals} approval before signing (current: ${currentCount}).`;
    }
  }

  return {
    isApproved,
    requiredApprovals,
    currentCount,
    remainingApprovals,
    approverWallets: validApprovals.map((a) => a.approverWallet),
    rejectionReason,
  };
}
