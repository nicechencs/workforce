import type {
  AuthoringSessionPageDto,
  AuthoringSessionViewDto,
  AuthoringTurnDto,
  AuthoringChatProposalDto,
  AuthoringCommandAcceptedDto,
  AuthoringTurnActionName,
  AuthoringTurnActionAcceptedDto,
  CommandReceipt,
  WorkforceEvent,
} from "@workforce/protocol";

import type {
  ApprovalDecisionInput,
  ApprovalDto,
  ArtifactContentDto,
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
  CancelInput,
  CapabilitiesDto,
  ChatClassifyInput,
  ChatClassifyResultDto,
  CommandAcceptedDto,
  CommandContext,
  ConfirmPlanInput,
  CreateProjectInput,
  CreateWorkspaceInput,
  CreateWorkerInput,
  EventListQuery,
  ForkWorkerVersionAcceptedDto,
  ListQuery,
  ListWorkersInput,
  NodeDto,
  PageDto,
  PatchProjectInput,
  PatchWorkerInput,
  ProjectBudgetDto,
  ProjectDto,
  ProjectProgressProjectionDto,
  RunDto,
  RunInputBody,
  RuntimeCapabilitiesDto,
  RuntimeDto,
  StartProjectInput,
  TaskDto,
  TeamDto,
  TeamVersionDto,
  WorkerDraftDto,
  WorkerDraftWrite,
  WorkerDto,
  WorkerPageDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
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

  listWorkers(query: ListWorkersInput): MaybeAsync<WorkerPageDto>;
  getWorker(id: string): MaybeAsync<WorkerDto | null>;
  getWorkerVersion(id: string, versionId: string): MaybeAsync<WorkerVersionDto | null>;
  getWorkerDraft(id: string, draftId: string): MaybeAsync<WorkerDraftDto | null>;
  listWorkerVersionReferences(
    id: string,
    versionId: string,
  ): MaybeAsync<WorkerVersionReferencesDto | null>;
  createWorker(ctx: CommandContext, input: CreateWorkerInput): MaybeAsync<CommandResult<WorkerDto>>;
  patchWorker(
    ctx: CommandContext,
    id: string,
    input: PatchWorkerInput,
  ): MaybeAsync<CommandResult<WorkerDto>>;
  createWorkerDraft(
    ctx: CommandContext,
    id: string,
    input: WorkerDraftWrite,
  ): MaybeAsync<CommandResult<WorkerDraftDto>>;
  patchWorkerDraft(
    ctx: CommandContext,
    id: string,
    draftId: string,
    input: WorkerDraftWrite,
  ): MaybeAsync<CommandResult<WorkerDraftDto>>;
  publishWorkerDraft(
    ctx: CommandContext,
    id: string,
    draftId: string,
  ): MaybeAsync<CommandResult<WorkerVersionDto>>;
  archiveWorkerVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): MaybeAsync<CommandResult<WorkerVersionDto>>;
  forkWorkerVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): MaybeAsync<CommandResult<ForkWorkerVersionAcceptedDto>>;

  classifyChatIntent(input: ChatClassifyInput): MaybeAsync<ChatClassifyResultDto>;
  queryProjectProgress(projectId: string): MaybeAsync<ProjectProgressProjectionDto>;

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
  startTaskRun(
    ctx: CommandContext,
    id: string,
    input: import("@workforce/protocol").StartTaskRunInput,
  ): MaybeAsync<CommandResult<RunDto>>;
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
  listRunEvents(runId: string, query: EventListQuery): MaybeAsync<PageDto<WorkforceEvent>>;

  createAuthoringSession(
    ctx: CommandContext,
    projectId: string,
  ): MaybeAsync<CommandResult<AuthoringSessionViewDto>>;
  listAuthoringSessions(projectId: string, query: ListQuery): MaybeAsync<AuthoringSessionPageDto>;
  getAuthoringSession(sessionId: string): MaybeAsync<AuthoringSessionViewDto | null>;
  getAuthoringTurn(sessionId: string, turnId: string): MaybeAsync<AuthoringTurnDto | null>;
  getAuthoringProposal(
    sessionId: string,
    proposalId: string,
  ): MaybeAsync<AuthoringChatProposalDto | null>;
  sendAuthoringMessage(
    ctx: CommandContext,
    sessionId: string,
    content: string,
  ): MaybeAsync<CommandResult<AuthoringCommandAcceptedDto & { turnId: string }>>;
  confirmAuthoringTurn(
    ctx: CommandContext,
    sessionId: string,
    turnId: string,
  ): MaybeAsync<CommandResult<AuthoringTurnActionAcceptedDto>>;
  authoringTurnAction(
    ctx: CommandContext,
    sessionId: string,
    turnId: string,
    action: Exclude<AuthoringTurnActionName, "confirm">,
  ): MaybeAsync<CommandResult<AuthoringTurnActionAcceptedDto>>;

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

  listEvents(query: EventListQuery): MaybeAsync<PageDto<WorkforceEvent>>;
  highWaterMark(): number;
  trimHorizon(): number;
  exportProject(
    ctx: CommandContext,
    id: string,
  ): MaybeAsync<CommandResult<import("./dto.js").ExportBundleDto>>;
  close?(): Promise<void> | void;
}
