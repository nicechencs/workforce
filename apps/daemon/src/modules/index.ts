import type { CommandReceipt, WorkforceEvent } from "@workforce/protocol";

import type {
  ApprovalDecisionInput,
  ApprovalDto,
  ArtifactContentDto,
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
  CancelInput,
  CapabilitiesDto,
  CommandAcceptedDto,
  CommandContext,
  ConfirmPlanInput,
  CreateProjectInput,
  EventListQuery,
  ListQuery,
  PageDto,
  PatchProjectInput,
  ProjectDto,
  RunDto,
  RunInputBody,
  StartProjectInput,
  TaskDto,
} from "./dto.js";

export type { AppError } from "./errors.js";
export * from "./dto.js";

export interface CommandResult<T> {
  status: 200 | 201 | 202;
  body: T;
  revision?: number;
}

export interface AppServices {
  capabilities(): CapabilitiesDto;
  getOperation(operationId: string, principalId: string): CommandReceipt | null;
  rememberOperation(receipt: CommandReceipt): void;

  listProjects(query: ListQuery): PageDto<ProjectDto>;
  getProject(id: string): ProjectDto | null;
  createProject(ctx: CommandContext, input: CreateProjectInput): CommandResult<ProjectDto>;
  patchProject(
    ctx: CommandContext,
    id: string,
    input: PatchProjectInput,
  ): CommandResult<ProjectDto>;
  startPlanning(ctx: CommandContext, id: string): CommandResult<ProjectDto>;
  confirmPlan(ctx: CommandContext, id: string, input: ConfirmPlanInput): CommandResult<ProjectDto>;
  startProject(
    ctx: CommandContext,
    id: string,
    input: StartProjectInput,
  ): CommandResult<ProjectDto>;
  cancelProject(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): CommandResult<CommandAcceptedDto | ProjectDto>;

  listTasks(query: ListQuery): PageDto<TaskDto>;
  getTask(id: string): TaskDto | null;
  retryTask(ctx: CommandContext, id: string): CommandResult<{ task: TaskDto; run: RunDto }>;
  cancelTask(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): CommandResult<CommandAcceptedDto | TaskDto>;

  listRuns(query: ListQuery): PageDto<RunDto>;
  getRun(id: string): RunDto | null;
  cancelRun(ctx: CommandContext, id: string, input: CancelInput): CommandResult<CommandAcceptedDto>;
  sendRunInput(ctx: CommandContext, id: string, input: RunInputBody): CommandResult<RunDto>;
  listRunEvents(runId: string, query: EventListQuery): PageDto<WorkforceEvent>;

  listApprovals(query: ListQuery): PageDto<ApprovalDto>;
  getApproval(id: string): ApprovalDto | null;
  approve(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): CommandResult<ApprovalDto>;
  reject(ctx: CommandContext, id: string, input: ApprovalDecisionInput): CommandResult<ApprovalDto>;
  requestChanges(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): CommandResult<ApprovalDto>;

  listArtifacts(query: ListQuery): PageDto<ArtifactDto>;
  getArtifact(id: string): ArtifactDto | null;
  getArtifactVersion(id: string, versionId: string): ArtifactVersionDto | null;
  readArtifactContent(id: string, versionId: string): ArtifactContentDto | null;
  getArtifactLineage(id: string, versionId: string): ArtifactLineageDto | null;

  listEvents(query: EventListQuery): PageDto<WorkforceEvent>;
  highWaterMark(): number;
  trimHorizon(): number;
}
