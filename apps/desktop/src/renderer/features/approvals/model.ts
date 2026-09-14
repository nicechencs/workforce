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

export const FIELD_UNRETURNED = "未返回";
export const EVALUATION_ROW = "判定：未返回";
export const EVALUATION_PENDING = "尚未判定";
export const EVALUATION_UNAVAILABLE =
  "没有独立 Evaluation 列表。判定看 evaluation / test_result 产物内容，不能把 Run 成功或聊天当成完成。";

export interface ApprovalExtraRefs {
  workerVersionId?: string;
  runId?: string;
  nodeId?: string;
  workspaceInstanceId?: string;
  impact?: string;
}

export function approvalExtraRefs(approval: ApprovalDto): ApprovalExtraRefs {
  const extra = approval as ApprovalDto & ApprovalExtraRefs;
  return {
    ...(typeof extra.workerVersionId === "string" && extra.workerVersionId.length > 0
      ? { workerVersionId: extra.workerVersionId }
      : {}),
    ...(typeof extra.runId === "string" && extra.runId.length > 0 ? { runId: extra.runId } : {}),
    ...(typeof extra.nodeId === "string" && extra.nodeId.length > 0 ? { nodeId: extra.nodeId } : {}),
    ...(typeof extra.workspaceInstanceId === "string" && extra.workspaceInstanceId.length > 0
      ? { workspaceInstanceId: extra.workspaceInstanceId }
      : {}),
    ...(typeof extra.impact === "string" && extra.impact.length > 0 ? { impact: extra.impact } : {}),
  };
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
