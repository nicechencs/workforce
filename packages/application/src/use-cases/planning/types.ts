import type { ApprovalGate, ApprovalStatus, ProjectStatus } from "@workforce/domain";
import type { AcceptanceCriterion, ExpectedOutput, ProtocolError } from "@workforce/protocol";

export const PLAN_PROTOCOL = "workforce.plan" as const;
export const PLAN_PROTOCOL_VERSION = "0.1" as const;
export const HARD_MAX_TASKS = 32;
export const HARD_MAX_DEPTH = 16;

export type PlanNodeKind = "task" | "approval";
export type PlanRole = "planner" | "developer" | "reviewer" | "human";
export type OnUpstream = "outputs_ready" | "completed";

export interface PlanRuntime {
  adapterId: string;
  protocolVersion: string;
}

export interface PlanBounds {
  maxDepth: number;
  maxTasks: number;
  maxAttempts: number;
  maxReworkCycles: number;
}

export interface PlanTaskNode {
  id: string;
  kind: "task";
  role: Exclude<PlanRole, "human">;
  workerRef: string;
  title: string;
  objective: string;
  expectedOutputs: ExpectedOutput[];
  acceptanceCriteria: AcceptanceCriterion[];
  maxAttempts: number;
  maxReworkCycles: number;
}

export interface PlanApprovalNode {
  id: string;
  kind: "approval";
  role: "human";
  gate: ApprovalGate;
  title: string;
  objective: string;
}

export type PlanNode = PlanTaskNode | PlanApprovalNode;

export interface PlanEdge {
  id: string;
  from: string;
  to: string;
  onUpstream: OnUpstream;
}

export interface PlanIntegration {
  strategy: "stable_node_id_order";
  worktree: "dedicated";
  contributorNodeIds: string[];
  bindDigestTo: string[];
  onConflict: "human";
}

export interface PlanArtifact {
  protocol: typeof PLAN_PROTOCOL;
  protocolVersion: typeof PLAN_PROTOCOL_VERSION;
  templateId: string;
  templateVersion: string;
  workflowId: string;
  objective: string;
  baseSha: string;
  policyRef: string;
  runtime: PlanRuntime;
  bounds: PlanBounds;
  nodes: PlanNode[];
  edges: PlanEdge[];
  integration: PlanIntegration;
}

export interface ConfirmedWorkflowNode {
  id: string;
  kind: PlanNodeKind;
  role: PlanRole;
  title: string;
  objective: string;
  workerRef?: string;
  gate?: ApprovalGate;
  expectedOutputs?: ExpectedOutput[];
  acceptanceCriteria?: AcceptanceCriterion[];
  maxAttempts?: number;
  maxReworkCycles?: number;
}

export interface ConfirmedWorkflowEdge {
  id: string;
  from: string;
  to: string;
  onUpstream: OnUpstream;
}

export interface ConfirmedWorkflowVersion {
  workflowVersionId: string;
  workflowId: string;
  version: number;
  projectId: string;
  planArtifactVersionId: string;
  planDigest: string;
  templateId: string;
  templateVersion: string;
  policyRef: string;
  runtime: PlanRuntime;
  immutable: true;
  publishedAt: string;
  intendedProjectStatus: Extract<ProjectStatus, "ready">;
  workflowStarted: false;
  entryNodeIds: string[];
  nodes: ConfirmedWorkflowNode[];
  edges: ConfirmedWorkflowEdge[];
  failurePolicy: { type: "fail_workflow" };
  concurrencyPolicy: { runWorktree: "isolated"; integrationWorktree: "dedicated" };
  integration: PlanIntegration;
  bounds: PlanBounds;
}

export interface PlanArtifactRecord {
  artifactVersionId: string;
  status: "staging" | "available" | "quarantined" | "archived";
  hash: string;
  body: unknown;
}

export interface PlanApprovalRecord {
  approvalId: string;
  gate: Extract<ApprovalGate, "plan">;
  projectId: string;
  planArtifactVersionId: string;
  digest: string;
  status: ApprovalStatus;
  principalId: string;
  policyVersion: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface ProjectSnapshot {
  projectId: string;
  status: ProjectStatus;
  stateRevision: number;
}

export interface ConfirmPlanCommand {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  planArtifactVersionId: string;
  planDigest: string;
  approvalId: string;
  principalId: string;
  clientId: string;
}

export type ConfirmPlanSuccess = {
  ok: true;
  workflowVersion: ConfirmedWorkflowVersion;
  replayed: boolean;
};

export type ConfirmPlanFailure = {
  ok: false;
  error: ProtocolError;
};

export type ConfirmPlanResult = ConfirmPlanSuccess | ConfirmPlanFailure;
