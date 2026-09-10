import type { ApprovalDecisionInput, ApprovalDto } from "@workforce/desktop-client";

export const GATE_LABELS: Record<ApprovalDto["gate"], string> = {
  plan: "计划确认",
  artifact: "产物验收",
  action: "动作授权",
  budget: "预算门禁",
};

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  changes_requested: "已要求修改",
  expired: "已过期",
  consumed: "已消费",
  superseded: "已作废",
  cancelled: "已取消",
};

export function approvalDigest(
  approval: Pick<ApprovalDto, "actionDigest"> | { actionDigest?: string },
): string | null {
  const digest = approval.actionDigest;
  if (typeof digest !== "string" || digest.trim().length === 0) {
    return null;
  }
  return digest;
}

export function canApproveApproval(
  approval:
    Pick<ApprovalDto, "status" | "actionDigest"> | { status: string; actionDigest?: string },
): boolean {
  return approval.status === "pending" && approvalDigest(approval) !== null;
}

export function canDecideApproval(approval: Pick<ApprovalDto, "status">): boolean {
  return approval.status === "pending";
}

export function approvalExpiry(approval: ApprovalDto): string {
  const extra = approval as ApprovalDto & { expiresAt?: string; expiry?: string };
  if (typeof extra.expiresAt === "string" && extra.expiresAt.length > 0) {
    return extra.expiresAt;
  }
  if (typeof extra.expiry === "string" && extra.expiry.length > 0) {
    return extra.expiry;
  }
  return "未提供";
}

export function gateLabel(gate: ApprovalDto["gate"] | string): string {
  if (gate === "plan" || gate === "artifact" || gate === "action" || gate === "budget") {
    return GATE_LABELS[gate];
  }
  return gate;
}

export function approvalStatusLabel(status: string): string {
  return APPROVAL_STATUS_LABELS[status] ?? status;
}

/** Bind the decision to the digest currently on the approval DTO — never a stale copy. */
export function decisionPayload(
  approval: ApprovalDto,
  decisionReason: string,
  requestedChanges?: ApprovalDecisionInput["requestedChanges"],
): ApprovalDecisionInput | null {
  const digest = approvalDigest(approval);
  if (digest === null) {
    return null;
  }
  const input: ApprovalDecisionInput = { decisionReason, digest };
  if (approval.artifactVersionId !== undefined) {
    input.artifactVersionId = approval.artifactVersionId;
  }
  if (requestedChanges !== undefined) {
    input.requestedChanges = requestedChanges;
  }
  return input;
}
