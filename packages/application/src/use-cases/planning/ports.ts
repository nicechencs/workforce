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
