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
  CreateWorkspaceInput,
  EventListQuery,
  ListQuery,
  NodeDto,
  PageDto,
  PatchProjectInput,
  ProjectBudgetDto,
  ProjectDto,
  RunDto,
  RunInputBody,
  RuntimeCapabilitiesDto,
  RuntimeDto,
  StartProjectInput,
  TaskDto,
  TeamDto,
  TeamVersionDto,
  WorkflowDto,
  WorkflowVersionDto,
  WorkspaceDto,
  CreateTeamInput,
  CreateTeamVersionInput,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  PatchTeamInput,
  PatchTeamVersionInput,
  PatchWorkflowInput,
  PatchWorkflowVersionInput,
} from "./dto.js";

export type { AppError } from "./errors.js";
export * from "./dto.js";

export interface CommandResult<T> {
  status: 200 | 201 | 202;
  body: T;
  revision?: number;
}

export type MaybeAsync<T> = T | Promise<T>;

export interface AppServices {
  capabilities(): CapabilitiesDto;
  getOperation(operationId: string, principalId: string): CommandReceipt | null;
  rememberOperation(receipt: CommandReceipt): void;

  listTeams(query: ListQuery): PageDto<TeamDto>;
  getTeam(id: string): TeamDto | null;
  getTeamVersion(id: string, versionId: string): TeamVersionDto | null;
  createTeam(ctx: CommandContext, input: CreateTeamInput): MaybeAsync<CommandResult<TeamDto>>;
  patchTeam(
    ctx: CommandContext,
    id: string,
    input: PatchTeamInput,
  ): MaybeAsync<CommandResult<TeamDto>>;
  createTeamVersion(
    ctx: CommandContext,
    id: string,
    input: CreateTeamVersionInput,
  ): MaybeAsync<CommandResult<TeamVersionDto>>;
  patchTeamVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
    input: PatchTeamVersionInput,
  ): MaybeAsync<CommandResult<TeamVersionDto>>;
  publishTeamVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): MaybeAsync<CommandResult<TeamVersionDto>>;
  listWorkflows(query: ListQuery): PageDto<WorkflowDto>;
  getWorkflow(id: string): WorkflowDto | null;
  getWorkflowVersion(id: string, versionId: string): WorkflowVersionDto | null;
  createWorkflow(
    ctx: CommandContext,
    input: CreateWorkflowInput,
  ): MaybeAsync<CommandResult<WorkflowDto>>;
  patchWorkflow(
    ctx: CommandContext,
    id: string,
    input: PatchWorkflowInput,
  ): MaybeAsync<CommandResult<WorkflowDto>>;
  createWorkflowVersion(
    ctx: CommandContext,
    id: string,
    input: CreateWorkflowVersionInput,
  ): MaybeAsync<CommandResult<WorkflowVersionDto>>;
  patchWorkflowVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
    input: PatchWorkflowVersionInput,
  ): MaybeAsync<CommandResult<WorkflowVersionDto>>;
  publishWorkflowVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): MaybeAsync<CommandResult<WorkflowVersionDto>>;
  listNodes(query: ListQuery): PageDto<NodeDto>;
  getNode(id: string): NodeDto | null;
  listRuntimes(query: ListQuery): PageDto<RuntimeDto>;
  getRuntime(id: string): RuntimeDto | null;
  getRuntimeCapabilities(id: string): RuntimeCapabilitiesDto | null;
  getProjectBudget(id: string): ProjectBudgetDto | null;
  createProjectWorkspace(
    ctx: CommandContext,
    id: string,
    input: CreateWorkspaceInput,
  ): MaybeAsync<CommandResult<WorkspaceDto>>;

  listProjects(query: ListQuery): PageDto<ProjectDto>;
  getProject(id: string): ProjectDto | null;
  createProject(
    ctx: CommandContext,
    input: CreateProjectInput,
  ): MaybeAsync<CommandResult<ProjectDto>>;
  patchProject(
    ctx: CommandContext,
    id: string,
    input: PatchProjectInput,
  ): MaybeAsync<CommandResult<ProjectDto>>;
  startPlanning(ctx: CommandContext, id: string): MaybeAsync<CommandResult<ProjectDto>>;
  confirmPlan(
    ctx: CommandContext,
    id: string,
    input: ConfirmPlanInput,
  ): MaybeAsync<CommandResult<ProjectDto>>;
  startProject(
    ctx: CommandContext,
    id: string,
    input: StartProjectInput,
  ): MaybeAsync<CommandResult<ProjectDto>>;
  cancelProject(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): MaybeAsync<CommandResult<CommandAcceptedDto | ProjectDto>>;

  listTasks(query: ListQuery): PageDto<TaskDto>;
  getTask(id: string): TaskDto | null;
  retryTask(
    ctx: CommandContext,
    id: string,
  ): MaybeAsync<CommandResult<{ task: TaskDto; run: RunDto }>>;
  cancelTask(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): MaybeAsync<CommandResult<CommandAcceptedDto | TaskDto>>;

  listRuns(query: ListQuery): PageDto<RunDto>;
  getRun(id: string): RunDto | null;
  cancelRun(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): MaybeAsync<CommandResult<CommandAcceptedDto>>;
  pauseRun(ctx: CommandContext, id: string): MaybeAsync<CommandResult<CommandAcceptedDto | RunDto>>;
  sendRunInput(
    ctx: CommandContext,
    id: string,
    input: RunInputBody,
  ): MaybeAsync<CommandResult<RunDto>>;
  listRunEvents(runId: string, query: EventListQuery): PageDto<WorkforceEvent>;

  listApprovals(query: ListQuery): PageDto<ApprovalDto>;
  getApproval(id: string): ApprovalDto | null;
  approve(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): MaybeAsync<CommandResult<ApprovalDto>>;
  reject(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): MaybeAsync<CommandResult<ApprovalDto>>;
  requestChanges(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): MaybeAsync<CommandResult<ApprovalDto>>;

  listArtifacts(query: ListQuery): PageDto<ArtifactDto>;
  getArtifact(id: string): ArtifactDto | null;
  getArtifactVersion(id: string, versionId: string): ArtifactVersionDto | null;
  readArtifactContent(id: string, versionId: string): ArtifactContentDto | null;
  getArtifactLineage(id: string, versionId: string): ArtifactLineageDto | null;

  listEvents(query: EventListQuery): PageDto<WorkforceEvent>;
  highWaterMark(): number;
  trimHorizon(): number;
  exportProject(
    ctx: CommandContext,
    id: string,
  ): MaybeAsync<CommandResult<import("./dto.js").ExportBundleDto>>;
  close?(): Promise<void> | void;
}
