import type {
  CommandReceipt,
  ProtocolError,
  ReceiptScope,
  WorkforceEvent,
} from "@workforce/protocol";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  ulid(prefix: string): string;
}

export interface Tx {
  readonly kind: "tx";
}

export interface UnitOfWork {
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface EventStore {
  append(tx: Tx, event: WorkforceEvent): Promise<{ ingestionPosition: number }>;
  read(query: {
    stream?: string;
    afterIngestionPosition?: number;
    types?: string[];
    projectId?: string;
    limit: number;
  }): Promise<WorkforceEvent[]>;
}

export interface CommandReceiptRepository {
  get(scope: ReceiptScope): Promise<CommandReceipt | null>;
  putPending(tx: Tx, receipt: CommandReceipt): Promise<void>;
  complete(tx: Tx, operationId: string, result: unknown): Promise<void>;
  fail(tx: Tx, operationId: string, error: ProtocolError): Promise<void>;
}

export interface WorkspaceBinding {
  workspaceId: string;
  authorizationRef: string;
}

export interface WorkspaceInstance {
  workspaceInstanceId: string;
  baseSha: string;
}

export interface DiffArtifactProposal {
  baseSha: string;
  patch: string;
  changedPaths: string[];
}

export interface WorkspaceService {
  bind(input: { projectId: string; authorizationRef: string }): Promise<WorkspaceBinding>;
  provisionRunWorkspace(runId: string, baseSha: string): Promise<WorkspaceInstance>;
  captureDiff(instanceId: string): Promise<DiffArtifactProposal>;
}

export type ProcessCancelMode = "graceful" | "force";

export interface ProcessHandle {
  pid: number;
  startIdentity: string;
}

export interface SpawnRequest {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface ProcessStatus {
  alive: boolean;
  startIdentity: string;
}

export interface ProcessController {
  spawn(req: SpawnRequest): Promise<ProcessHandle>;
  cancel(handle: ProcessHandle, mode: ProcessCancelMode): Promise<void>;
  inspect(handle: ProcessHandle): Promise<ProcessStatus>;
}

export type PolicyDecisionName = "allow" | "deny" | "require_approval";

export interface CanonicalAction {
  type: string;
  digest: string;
  resource: string;
  version?: string;
}

export interface PolicyDecision {
  decision: PolicyDecisionName;
  policyVersion: string;
  reason?: string;
}

export interface PolicyEngine {
  decide(action: CanonicalAction): Promise<PolicyDecision>;
}

export interface ArtifactBytes {
  slotId: string;
  mediaType: string;
  body: Uint8Array;
}

export interface StagingRef {
  stagingId: string;
}

export interface ArtifactVersion {
  artifactVersionId: string;
  hash: string;
  size: number;
  status: "staging" | "available" | "quarantined" | "archived";
}

export interface ArtifactStore {
  stage(bytes: ArtifactBytes): Promise<StagingRef>;
  commit(staging: StagingRef): Promise<ArtifactVersion>;
  get(artifactVersionId: string): Promise<ArtifactVersion>;
  read(artifactVersionId: string): AsyncIterable<Uint8Array>;
}
