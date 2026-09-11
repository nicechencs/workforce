export interface HealthDto {
  ok: true;
  pid: number;
  port: number;
  startIdentity: string;
  protocolVersion: string;
}

export interface VersionDto {
  protocolVersion: string;
  apiVersion: string;
}

export interface ReadyDto {
  ready: boolean;
  checks: Record<string, boolean>;
}

export interface CapabilitiesDto {
  protocolVersion: string;
  apiVersion: string;
  run: {
    pause: boolean;
    resume: boolean;
    input: boolean;
    takeOver: boolean;
  };
  project: {
    pause: boolean;
    resume: boolean;
    archive: boolean;
  };
}

export type { TaskDependency, TaskDto } from "@workforce/protocol";

export interface PageDto<T> {
  items: T[];
  page: { nextCursor: string | null; hasMore: boolean };
}

export interface ProjectDto {
  id: string;
  organizationId: string;
  name: string;
  objective: string;
  status: string;
  stateRevision: number;
  protocolVersion: "0.1";
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  planArtifactVersionId?: string;
  teamVersionId?: string;
}

export interface RunDto {
  id: string;
  taskId: string;
  projectId: string;
  status: string;
  stateRevision: number;
  definitionRevision: number;
  generation: number;
  attempt: number;
  protocolVersion: "0.1";
  cancelRequested: boolean;
  usage: {
    costMinor: number;
    currency: string;
    kind: "unknown" | "estimated" | "settled";
  };
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalDto {
  id: string;
  projectId: string;
  gate: "plan" | "artifact" | "action" | "budget";
  status: string;
  stateRevision: number;
  actionDigest: string;
  resource: string;
  requestedAt: string;
  taskId?: string;
  artifactVersionId?: string;
  decisionReason?: string;
}

export interface ArtifactVersionSummaryDto {
  id: string;
  version: number;
  status: string;
  hash: string;
  size: number;
  createdAt: string;
}

export interface ArtifactDto {
  id: string;
  projectId: string;
  logicalName: string;
  kind: string;
  createdAt: string;
  versions: ArtifactVersionSummaryDto[];
}

export interface ArtifactVersionDto extends ArtifactVersionSummaryDto {
  artifactId: string;
  mediaType: string;
}

export interface ArtifactLineageDto {
  artifactVersionId: string;
  parents: string[];
  children: string[];
}

export interface CommandAcceptedDto {
  operationId: string;
  acceptedAt: string;
  resource: { type: string; id: string };
}

export interface OperationDto {
  operationId: string;
  status: "pending" | "committed" | "failed";
  acceptedAt: string;
  result?: unknown;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  requestId: string;
  retryable: boolean;
  fields?: unknown[];
  currentRevision?: number;
}

export interface ListQuery {
  limit?: number;
  cursor?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  status?: string;
}

export interface EventListQuery {
  limit?: number;
  after?: string;
  projectId?: string;
  runId?: string;
  types?: string[];
  cursor?: string;
}

export interface CommandOptions {
  idempotencyKey: string;
  ifMatch?: number | string;
  operationId?: string;
}

export interface CreateProjectInput {
  name: string;
  objective: string;
}

export interface PatchProjectInput {
  name?: string;
  objective?: string;
  teamVersionId?: string;
}

export interface ConfirmPlanInput {
  planArtifactVersionId: string;
}

export interface StartProjectInput {
  budgetHardLimitMinor?: number;
}

export interface CancelInput {
  reason?: string;
  mode?: string;
}

export interface RunInputBody {
  text?: string;
  payload?: Record<string, unknown>;
}

export interface ApprovalDecisionInput {
  decisionReason: string;
  digest?: string;
  artifactVersionId?: string;
  requestedChanges?: Array<{ criterionId: string; instruction: string }>;
}

export interface SessionDto {
  sessionToken: string;
  principalId: string;
}

export type {
  CreateTeamInput,
  CreateTeamVersionInput,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  PatchTeamInput,
  PatchTeamVersionInput,
  PatchWorkflowInput,
  PatchWorkflowVersionInput,
  TeamDto,
  TeamMemberDto,
  TeamRoleDto,
  TeamVersionDto,
  WorkflowDto,
  WorkflowGraphEdgeDto,
  WorkflowGraphNodeDto,
  WorkflowStepDto,
  WorkflowVersionDto,
} from "@workforce/protocol";

export interface NodeDto {
  id: string;
  kind: "local";
  status: "online" | "offline";
  platform: "windows" | "macos" | "linux";
  displayName: string;
  capacity: { maxConcurrentRuns: number };
}

export interface RuntimeDto {
  id: string;
  displayName: string;
  adapterId: string;
  version: string;
  protocolVersion: "0.1";
  transport: "sdk";
}

export interface RuntimeCapabilityItemDto {
  name: string;
  version: string;
  available: boolean;
}

export interface RuntimeCapabilitiesDto {
  runtimeId: string;
  input: boolean;
  pause: boolean;
  resume: boolean;
  takeOver: boolean;
  capabilities: RuntimeCapabilityItemDto[];
}

export interface ProjectBudgetDto {
  projectId: string;
  currency: string;
  kind: "unknown" | "estimated" | "settled";
  reservedMinor: number;
  settledMinor: number;
  authorizationVersion: number;
  estimatedLimitMinor?: number;
  settledLimitMinor?: number;
}

export interface WorkspaceDto {
  id: string;
  projectId: string;
  status: string;
  kind: "local";
  authorizationRef: string;
  createdAt: string;
}

export interface CreateWorkspaceInput {
  authorizationRef: string;
}

export interface ExportBundleDto {
  projectId: string;
  digest: string;
  artifactVersionId: string;
  status: "exported";
  report: {
    projectId: string;
    projectStatus: string;
    integratedDigest?: string;
    approvedDigest?: string;
    artifacts: Array<{ versionId: string; hash: string; slotId?: string }>;
  };
}
