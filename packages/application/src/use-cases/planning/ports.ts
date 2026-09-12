import type {
  Clock,
  CommandReceiptRepository,
  EventStore,
  IdGenerator,
  UnitOfWork,
} from "../../ports/index.js";
import type {
  ConfirmedWorkflowVersion,
  PlanApprovalRecord,
  PlanArtifactRecord,
  PlannerProjectRecord,
  PlannerRunRecord,
  PlannerTaskRecord,
  ProjectSnapshot,
} from "./types.js";

export interface ProjectReader {
  get(projectId: string): Promise<ProjectSnapshot | null>;
}

export interface PlanArtifactRepository {
  get(artifactVersionId: string): Promise<PlanArtifactRecord | null>;
}

export interface PlanApprovalRepository {
  get(approvalId: string): Promise<PlanApprovalRecord | null>;
  consume(approvalId: string, consumedAt: string): Promise<void>;
}

export interface ConfirmedWorkflowRepository {
  getByProject(projectId: string): Promise<ConfirmedWorkflowVersion | null>;
  put(version: ConfirmedWorkflowVersion): Promise<void>;
}

export interface ConfirmPlanDeps {
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  events: EventStore;
  receipts: CommandReceiptRepository;
  projects: ProjectReader;
  plans: PlanArtifactRepository;
  approvals: PlanApprovalRepository;
  confirmed: ConfirmedWorkflowRepository;
}

export interface PlannerProjectReader {
  get(projectId: string): Promise<PlannerProjectRecord | null>;
}

export interface PlannerTaskRepository {
  getByProject(projectId: string): Promise<PlannerTaskRecord | null>;
  get(taskId: string): Promise<PlannerTaskRecord | null>;
  put(task: PlannerTaskRecord): Promise<void>;
}

/**
 * Starts a governed Run for an existing planner Task.
 * Implementations must delegate to the Application `startRun` use case
 * (Runtime SPI Host). They must not call RuntimeAdapter.start.
 */
export interface PlannerTaskRunPort {
  startRun(input: {
    operationId: string;
    idempotencyKey: string;
    taskId: string;
    snapshotRef: string;
  }): Promise<{ runId: string; handleId?: string; reused: boolean }>;
}

export interface PlannerRunRepository {
  get(runId: string): Promise<PlannerRunRecord | null>;
  getByTask(taskId: string): Promise<PlannerRunRecord | null>;
}

export interface PlannerPlanOutput {
  artifactVersionId: string;
  hash: string;
  status: "staging" | "available" | "quarantined" | "archived";
  body: unknown;
}

export interface PlannerPlanOutputReader {
  readPlanSlot(input: { runId: string; taskId: string }): Promise<PlannerPlanOutput | null>;
}

export interface PlanArtifactWriter {
  put(record: PlanArtifactRecord): Promise<void>;
}

export interface PlanApprovalWriter {
  create(record: PlanApprovalRecord): Promise<void>;
}

export interface StartPlannerDeps {
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  events: EventStore;
  receipts: CommandReceiptRepository;
  projects: PlannerProjectReader;
  tasks: PlannerTaskRepository;
  runRecords: PlannerRunRepository;
  runs: PlannerTaskRunPort;
}

export interface AcceptPlannerArtifactDeps {
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  events: EventStore;
  receipts: CommandReceiptRepository;
  projects: PlannerProjectReader;
  tasks: PlannerTaskRepository;
  runRecords: PlannerRunRepository;
  outputs: PlannerPlanOutputReader;
  plans: PlanArtifactWriter;
  approvals: PlanApprovalWriter;
  confirmed: ConfirmedWorkflowRepository;
}
