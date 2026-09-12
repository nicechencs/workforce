import type {
  ApprovalGate,
  ApprovalStatus,
  ArtifactVersionStatus,
  ProjectStatus,
  RunStatus,
  TaskStatus,
  WorkflowInstanceStatus,
} from "@workforce/domain";
import type { OrchestrationMode, RunExecutionSnapshot } from "@workforce/protocol";
import type {
  Clock,
  CommandReceiptRepository,
  EventStore,
  IdGenerator,
  Tx,
  UnitOfWork,
} from "../../ports/index.js";
import type {
  CommandReceipt,
  ProtocolError,
  ReceiptScope,
  WorkforceEvent,
} from "@workforce/protocol";

import type { BudgetState, NodeInstanceStatus, WorkflowGraph } from "./engine-port.js";

export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  objective: string;
  status: ProjectStatus;
  stateRevision: number;
  teamVersionId?: string;
  runtimeId?: string;
  workspaceId?: string;
  budgetId?: string;
  executionNodeId?: string;
  runtimeInstallationId?: string;
  workspaceInstanceId?: string;
  workflowInstanceId?: string;
  workflowVersionId?: string;
  planArtifactVersionId?: string;
  /** D02: the confirmed execution snapshot. Written once when the plan is confirmed. */
  executionSnapshotId?: string;
  /** Echo of requested D18 mode after `:start`. Not a StartRunRequest field. */
  orchestrationMode?: OrchestrationMode;
  cancelRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * D02/D18: the immutable execution freeze for one Project.
 *
 * workflow-bound Runs and WorkflowInstances read WorkflowVersion/TeamVersion
 * from here instead of carrying their own version columns.
 */
export interface ProjectExecutionSnapshotRecord {
  id: string;
  projectId: string;
  workflowVersionId: string;
  teamVersionId: string;
  contentHash: string;
  policySnapshot: Record<string, unknown>;
  budgetSnapshot?: Record<string, unknown>;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  workflowInstanceId?: string;
  workflowNodeId?: string;
  role: "planner" | "developer" | "reviewer" | "approver";
  title: string;
  status: TaskStatus;
  stateRevision: number;
  definitionRevision: number;
  generation: number;
  attempt: number;
  maxAttempts: number;
  maxReworkCycles: number;
  priority: number;
  requiresReview: boolean;
  expectedOutputs: { id: string; kind: string; required: boolean }[];
  outputBindings: Record<string, string>;
  dependsOn: { taskId: string; waitFor: "outputs_ready" | "completed" }[];
  inputArtifactVersionIds: string[];
  nextAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  taskId: string;
  projectId: string;
  status: RunStatus;
  stateRevision: number;
  attempt: number;
  generation: number;
  definitionRevision: number;
  operationId: string;
  cancelRequestedAt?: string;
  handleId?: string;
  /** Copied from the project `:start` request onto this Run. Not a StartRunRequest field. */
  orchestrationMode?: OrchestrationMode;
  /**
   * D18: the resolved, immutable execution axes for this Run.
   *
   * This is optional while the additive migration is in progress: pre-existing
   * M3 rows intentionally have no execution facts and must remain all-null.
   */
  executionSnapshot?: RunExecutionSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  projectId: string;
  taskId?: string;
  gate: ApprovalGate;
  status: ApprovalStatus;
  stateRevision: number;
  actionDigest: string;
  resource: string;
  artifactVersionId?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface ArtifactRecord {
  artifactVersionId: string;
  projectId: string;
  taskId?: string;
  slotId?: string;
  digest: string;
  status: ArtifactVersionStatus;
}

export interface WorkflowInstanceRecord {
  id: string;
  projectId: string;
  workflowVersionId: string;
  /** D02: the execution snapshot this instance derives its versions from. */
  executionSnapshotId?: string;
  graph: WorkflowGraph;
  status: WorkflowInstanceStatus;
  stateRevision: number;
  cancelRequestedAt?: string;
}

export interface NodeInstanceRecord {
  id: string;
  workflowInstanceId: string;
  nodeId: string;
  taskId?: string;
  status: NodeInstanceStatus;
  generation: number;
  stateRevision: number;
}

export interface BudgetRecord extends BudgetState {
  id: string;
  projectId: string;
}

export interface ReservationRecord {
  id: string;
  budgetId: string;
  amountMinor: number;
  runId?: string;
}

export class MemoryClock implements Clock {
  private current: Date;

  constructor(iso = "2026-09-10T10:00:00.000Z") {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class MemoryIds implements IdGenerator {
  private seq = 0;

  ulid(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq.toString(16).padStart(26, "0")}`;
  }
}

export class MemoryUnitOfWork implements UnitOfWork {
  async withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({ kind: "tx" });
  }
}

export class MemoryEventStore implements EventStore {
  readonly events: WorkforceEvent[] = [];

  async append(_tx: Tx, event: WorkforceEvent): Promise<{ ingestionPosition: number }> {
    const ingestionPosition = this.events.length + 1;
    this.events.push({
      ...event,
      ingestionPosition,
      sequence: event.sequence ?? ingestionPosition,
    });
    return { ingestionPosition };
  }

  async read(query: {
    stream?: string;
    afterIngestionPosition?: number;
    types?: string[];
    projectId?: string;
    limit: number;
  }): Promise<WorkforceEvent[]> {
    return this.events
      .filter((event) => {
        if (query.stream !== undefined && event.stream !== query.stream) {
          return false;
        }
        if (
          query.afterIngestionPosition !== undefined &&
          (event.ingestionPosition ?? 0) <= query.afterIngestionPosition
        ) {
          return false;
        }
        if (query.types && !query.types.includes(event.type)) {
          return false;
        }
        if (query.projectId !== undefined && event.projectId !== query.projectId) {
          return false;
        }
        return true;
      })
      .slice(0, query.limit);
  }
}

function scopeKey(scope: ReceiptScope): string {
  return [
    scope.principalId,
    scope.clientId,
    scope.canonicalOperation,
    scope.resource,
    scope.idempotencyKey,
  ].join("\u0000");
}

export class MemoryReceipts implements CommandReceiptRepository {
  private readonly byScope = new Map<string, CommandReceipt>();
  private readonly byOperation = new Map<string, CommandReceipt>();

  async get(scope: ReceiptScope): Promise<CommandReceipt | null> {
    return this.byScope.get(scopeKey(scope)) ?? null;
  }

  async getByOperationId(operationId: string): Promise<CommandReceipt | null> {
    return this.byOperation.get(operationId) ?? null;
  }

  async putPending(_tx: Tx, receipt: CommandReceipt): Promise<void> {
    this.byScope.set(scopeKey(receipt.scope), receipt);
    this.byOperation.set(receipt.operationId, receipt);
  }

  async complete(_tx: Tx, operationId: string, result: unknown): Promise<void> {
    const receipt = this.byOperation.get(operationId);
    if (!receipt) {
      return;
    }
    const next: CommandReceipt = { ...receipt, status: "committed", result };
    this.byOperation.set(operationId, next);
    this.byScope.set(scopeKey(next.scope), next);
  }

  async fail(_tx: Tx, operationId: string, error: ProtocolError): Promise<void> {
    const receipt = this.byOperation.get(operationId);
    if (!receipt) {
      return;
    }
    const next: CommandReceipt = { ...receipt, status: "failed", result: error };
    this.byOperation.set(operationId, next);
    this.byScope.set(scopeKey(next.scope), next);
  }
}

export class MemoryWorld {
  readonly projects = new Map<string, ProjectRecord>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly runs = new Map<string, RunRecord>();
  readonly approvals = new Map<string, ApprovalRecord>();
  readonly artifacts = new Map<string, ArtifactRecord>();
  readonly workflows = new Map<string, WorkflowInstanceRecord>();
  readonly nodes = new Map<string, NodeInstanceRecord>();
  readonly budgets = new Map<string, BudgetRecord>();
  readonly executionSnapshots = new Map<string, ProjectExecutionSnapshotRecord>();
  readonly usageKeys = new Set<string>();
  readonly reservations = new Map<string, ReservationRecord>();
  readonly unknownStatuses = new Set<string>();
  readonly clock: MemoryClock;
  readonly ids: MemoryIds;
  readonly uow: MemoryUnitOfWork;
  readonly events: MemoryEventStore;
  readonly receipts: MemoryReceipts;

  constructor() {
    this.clock = new MemoryClock();
    this.ids = new MemoryIds();
    this.uow = new MemoryUnitOfWork();
    this.events = new MemoryEventStore();
    this.receipts = new MemoryReceipts();
  }

  nowIso(): string {
    return this.clock.now().toISOString();
  }

  tasksForProject(projectId: string): TaskRecord[] {
    return [...this.tasks.values()].filter((task) => task.projectId === projectId);
  }

  activeRunForTask(taskId: string): RunRecord | undefined {
    return [...this.runs.values()].find(
      (run) =>
        run.taskId === taskId &&
        (run.status === "pending" ||
          run.status === "starting" ||
          run.status === "running" ||
          run.status === "waiting_input" ||
          run.status === "paused"),
    );
  }

  executionSnapshotForProject(projectId: string): ProjectExecutionSnapshotRecord | undefined {
    return [...this.executionSnapshots.values()].find(
      (snapshot) => snapshot.projectId === projectId,
    );
  }

  requiredOutputsReady(task: TaskRecord): boolean {
    return task.expectedOutputs
      .filter((output) => output.required)
      .every((output) => task.outputBindings[output.id] !== undefined);
  }
}
