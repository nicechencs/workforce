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

export interface PlacementCandidate {
  nodeId: string;
  runtimeInstallationId: string;
  workspaceInstanceId: string;
  transport: "process" | "sdk" | "http";
}

export interface PlacementDecision {
  candidate: PlacementCandidate;
  reason: string;
}

/**
 * Selects Node / RuntimeInstallation / WorkspaceInstance for one Run.
 * This is not the Workflow DAG scheduler.
 */
export interface PlacementScheduler {
  resolve(input: {
    intent: {
      mode: "automatic" | "local_only" | "remote_only" | "specific_node";
      nodeId?: string;
    };
    inventory?: Partial<PlacementCandidate>;
  }): PlacementDecision;
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

export interface CapturedSpawnRequest extends SpawnRequest {
  stdin?: Uint8Array;
}

export type ProcessOutputSource = "stdout" | "stderr";

export interface ProcessOutput {
  source: ProcessOutputSource;
  chunk: Uint8Array;
}

export interface ProcessExitResult {
  /** Root-process result observed by the OS, not a Workflow or Run outcome. */
  exitCode: number | null;
  /** Native diagnostic signal. Consumers must not infer a business outcome from it. */
  signal: string | null;
}

export type ProcessControllerOperation = "spawn" | "wait" | "output" | "inspect" | "cancel";

export type ProcessControllerErrorCode =
  | "unsupported_capability"
  | "invalid_request"
  | "spawn_failed"
  | "identity_mismatch"
  | "process_tree_unverified"
  | "process_input_failed"
  | "process_output_failed"
  | "process_output_overflow"
  | "process_output_abandoned"
  | "process_wait_failed"
  | "process_cancel_failed";

/**
 * A stable failure from the single ProcessController port. `wait()` rejects
 * rather than returning a plausible ProcessExitResult when terminal process
 * ownership, output handling, or cancellation cannot be verified.
 */
export class ProcessControllerError extends Error {
  override readonly name = "ProcessControllerError";
  readonly capability?: "process.capture" | "process.cancel.graceful";
  readonly platform?: string;

  constructor(
    readonly code: ProcessControllerErrorCode,
    readonly operation: ProcessControllerOperation,
    message: string,
    options?: {
      capability?: "process.capture" | "process.cancel.graceful";
      platform?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    if (options?.capability !== undefined) {
      this.capability = options.capability;
    }
    if (options?.platform !== undefined) {
      this.platform = options.platform;
    }
  }
}

export interface CapturedProcess {
  handle: ProcessHandle;
  /**
   * A single-consumer, multiplexed stream drained from stdout and stderr.
   * If never consumed, the process continues while output is held only in a bounded queue.
   * Returning before EOF force-cancels the managed process. If that queue overflows because
   * output is not consumed, the process is force-cancelled and iteration fails.
   */
  output: AsyncIterable<ProcessOutput>;
  /**
   * Resolves idempotently only after the root has exited, output reached EOF,
   * and the owned process tree is confirmed empty. It rejects with
   * ProcessControllerError when that conclusion cannot be made safely.
   */
  wait(): Promise<ProcessExitResult>;
}

export interface ProcessController {
  spawn(req: SpawnRequest): Promise<ProcessHandle>;
  spawnCaptured(req: CapturedSpawnRequest): Promise<CapturedProcess>;
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
