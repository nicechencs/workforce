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
}

export interface TaskDto {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  status: string;
  stateRevision: number;
  definitionRevision: number;
  generation: number;
  attempt: number;
  protocolVersion: "0.1";
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface ArtifactContentDto {
  mediaType: string;
  body: Uint8Array;
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

export interface ListQuery {
  limit: number;
  cursor?: string;
  projectId?: string;
  taskId?: string;
  runId?: string;
  status?: string;
}

export interface EventListQuery {
  limit: number;
  afterIngestionPosition: number;
  projectId?: string;
  runId?: string;
  types?: string[];
  stream?: string;
}

export interface CreateProjectInput {
  name: string;
  objective: string;
}

export interface PatchProjectInput {
  name?: string;
  objective?: string;
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

export interface CommandContext {
  principalId: string;
  clientId: string;
  operationId: string;
  ifMatch?: number;
}
