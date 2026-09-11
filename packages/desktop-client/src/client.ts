import { isProblemDetails, ProblemError } from "./errors.js";
import { assertSafePath, paths } from "./paths.js";
import type { ClientTransport, TransportResponse } from "./transport.js";
import type {
  ApprovalDecisionInput,
  ApprovalDto,
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
  CancelInput,
  CapabilitiesDto,
  CommandAcceptedDto,
  CommandOptions,
  ConfirmPlanInput,
  CreateProjectInput,
  CreateTeamInput,
  CreateTeamVersionInput,
  CreateWorkspaceInput,
  EventListQuery,
  ExportBundleDto,
  HealthDto,
  ListQuery,
  NodeDto,
  OperationDto,
  PageDto,
  PatchProjectInput,
  PatchTeamInput,
  PatchTeamVersionInput,
  ProblemDetails,
  ProjectBudgetDto,
  ProjectDto,
  ReadyDto,
  RunDto,
  RunInputBody,
  RuntimeCapabilitiesDto,
  RuntimeDto,
  SessionDto,
  StartProjectInput,
  TaskDto,
  TeamDto,
  TeamVersionDto,
  VersionDto,
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
} from "./types.js";

export interface DesktopClientOptions {
  transport: ClientTransport;
}

function commandHeaders(options: CommandOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "idempotency-key": options.idempotencyKey,
  };
  if (options.ifMatch !== undefined) {
    headers["if-match"] = `"${options.ifMatch}"`;
  }
  return headers;
}

function withOperation<T extends object>(
  body: T,
  options: CommandOptions | undefined,
): T & { operationId?: string } {
  if (options?.operationId === undefined) {
    return body;
  }
  return { ...body, operationId: options.operationId };
}

export class DesktopClient {
  constructor(private readonly transport: ClientTransport) {}

  getHealth(): Promise<HealthDto> {
    return this.get(paths.health());
  }

  getReady(): Promise<ReadyDto> {
    return this.get(paths.ready());
  }

  getVersion(): Promise<VersionDto> {
    return this.get(paths.version());
  }

  getCapabilities(): Promise<CapabilitiesDto> {
    return this.get(paths.capabilities());
  }

  getOperation(operationId: string): Promise<OperationDto> {
    return this.get(paths.operation(operationId));
  }

  listProjects(query?: ListQuery): Promise<PageDto<ProjectDto>> {
    return this.get(paths.projects(query));
  }

  getProject(id: string): Promise<ProjectDto> {
    return this.get(paths.project(id));
  }

  createProject(input: CreateProjectInput, options: CommandOptions): Promise<ProjectDto> {
    return this.send("POST", paths.projects(), options, withOperation(input, options));
  }

  patchProject(id: string, input: PatchProjectInput, options: CommandOptions): Promise<ProjectDto> {
    return this.send("PATCH", paths.project(id), options, withOperation(input, options));
  }

  startPlanning(id: string, options: CommandOptions): Promise<ProjectDto> {
    return this.send("POST", paths.projectStartPlanning(id), options, withOperation({}, options));
  }

  confirmPlan(id: string, input: ConfirmPlanInput, options: CommandOptions): Promise<ProjectDto> {
    return this.send("POST", paths.projectConfirmPlan(id), options, withOperation(input, options));
  }

  startProject(
    id: string,
    options: CommandOptions,
    input: StartProjectInput = {},
  ): Promise<ProjectDto> {
    return this.send("POST", paths.projectStart(id), options, withOperation(input, options));
  }

  cancelProject(
    id: string,
    options: CommandOptions,
    input: CancelInput = {},
  ): Promise<CommandAcceptedDto | ProjectDto> {
    return this.send("POST", paths.projectCancel(id), options, withOperation(input, options));
  }

  exportProject(id: string, options: CommandOptions): Promise<ExportBundleDto> {
    return this.send("POST", paths.projectExport(id), options, withOperation({}, options));
  }

  listTeams(query?: ListQuery): Promise<PageDto<TeamDto>> {
    return this.get(paths.teams(query));
  }

  getTeam(id: string): Promise<TeamDto> {
    return this.get(paths.team(id));
  }

  getTeamVersion(id: string, versionId: string): Promise<TeamVersionDto> {
    return this.get(paths.teamVersion(id, versionId));
  }

  createTeam(input: CreateTeamInput, options: CommandOptions): Promise<TeamDto> {
    return this.send("POST", paths.teams(), options, withOperation(input, options));
  }

  patchTeam(id: string, input: PatchTeamInput, options: CommandOptions): Promise<TeamDto> {
    return this.send("PATCH", paths.team(id), options, withOperation(input, options));
  }

  createTeamVersion(
    id: string,
    input: CreateTeamVersionInput,
    options: CommandOptions,
  ): Promise<TeamVersionDto> {
    return this.send("POST", paths.teamVersions(id), options, withOperation(input, options));
  }

  patchTeamVersion(
    id: string,
    versionId: string,
    input: PatchTeamVersionInput,
    options: CommandOptions,
  ): Promise<TeamVersionDto> {
    return this.send(
      "PATCH",
      paths.teamVersion(id, versionId),
      options,
      withOperation(input, options),
    );
  }

  publishTeamVersion(
    id: string,
    versionId: string,
    options: CommandOptions,
  ): Promise<TeamVersionDto> {
    return this.send(
      "POST",
      paths.teamVersionPublish(id, versionId),
      options,
      withOperation({}, options),
    );
  }

  listWorkflows(query?: ListQuery): Promise<PageDto<WorkflowDto>> {
    return this.get(paths.workflows(query));
  }

  getWorkflow(id: string): Promise<WorkflowDto> {
    return this.get(paths.workflow(id));
  }

  getWorkflowVersion(id: string, versionId: string): Promise<WorkflowVersionDto> {
    return this.get(paths.workflowVersion(id, versionId));
  }

  createWorkflow(input: CreateWorkflowInput, options: CommandOptions): Promise<WorkflowDto> {
    return this.send("POST", paths.workflows(), options, withOperation(input, options));
  }

  patchWorkflow(
    id: string,
    input: PatchWorkflowInput,
    options: CommandOptions,
  ): Promise<WorkflowDto> {
    return this.send("PATCH", paths.workflow(id), options, withOperation(input, options));
  }

  createWorkflowVersion(
    id: string,
    input: CreateWorkflowVersionInput,
    options: CommandOptions,
  ): Promise<WorkflowVersionDto> {
    return this.send("POST", paths.workflowVersions(id), options, withOperation(input, options));
  }

  patchWorkflowVersion(
    id: string,
    versionId: string,
    input: PatchWorkflowVersionInput,
    options: CommandOptions,
  ): Promise<WorkflowVersionDto> {
    return this.send(
      "PATCH",
      paths.workflowVersion(id, versionId),
      options,
      withOperation(input, options),
    );
  }

  publishWorkflowVersion(
    id: string,
    versionId: string,
    options: CommandOptions,
  ): Promise<WorkflowVersionDto> {
    return this.send(
      "POST",
      paths.workflowVersionPublish(id, versionId),
      options,
      withOperation({}, options),
    );
  }

  listNodes(query?: ListQuery): Promise<PageDto<NodeDto>> {
    return this.get(paths.nodes(query));
  }

  getNode(id: string): Promise<NodeDto> {
    return this.get(paths.node(id));
  }

  listRuntimes(query?: ListQuery): Promise<PageDto<RuntimeDto>> {
    return this.get(paths.runtimes(query));
  }

  getRuntime(id: string): Promise<RuntimeDto> {
    return this.get(paths.runtime(id));
  }

  getRuntimeCapabilities(id: string): Promise<RuntimeCapabilitiesDto> {
    return this.get(paths.runtimeCapabilities(id));
  }

  getProjectBudget(id: string): Promise<ProjectBudgetDto> {
    return this.get(paths.projectBudget(id));
  }

  createProjectWorkspace(
    id: string,
    input: CreateWorkspaceInput,
    options: CommandOptions,
  ): Promise<WorkspaceDto> {
    return this.send("POST", paths.projectWorkspaces(id), options, withOperation(input, options));
  }

  listTasks(query?: ListQuery): Promise<PageDto<TaskDto>> {
    return this.get(paths.tasks(query));
  }

  getTask(id: string): Promise<TaskDto> {
    return this.get(paths.task(id));
  }

  retryTask(id: string, options: CommandOptions): Promise<{ task: TaskDto; run: RunDto }> {
    return this.send("POST", paths.taskRetry(id), options, withOperation({}, options));
  }

  cancelTask(
    id: string,
    options: CommandOptions,
    input: CancelInput = {},
  ): Promise<CommandAcceptedDto | TaskDto> {
    return this.send("POST", paths.taskCancel(id), options, withOperation(input, options));
  }

  listRuns(query?: ListQuery): Promise<PageDto<RunDto>> {
    return this.get(paths.runs(query));
  }

  getRun(id: string): Promise<RunDto> {
    return this.get(paths.run(id));
  }

  cancelRun(
    id: string,
    options: CommandOptions,
    input: CancelInput = {},
  ): Promise<CommandAcceptedDto> {
    return this.send("POST", paths.runCancel(id), options, withOperation(input, options));
  }

  sendRunInput(id: string, input: RunInputBody, options: CommandOptions): Promise<RunDto> {
    return this.send("POST", paths.runInput(id), options, withOperation(input, options));
  }

  listRunEvents(id: string, query?: ListQuery): Promise<PageDto<unknown>> {
    return this.get(paths.runEvents(id, query));
  }

  listApprovals(query?: ListQuery): Promise<PageDto<ApprovalDto>> {
    return this.get(paths.approvals(query));
  }

  getApproval(id: string): Promise<ApprovalDto> {
    return this.get(paths.approval(id));
  }

  approve(id: string, input: ApprovalDecisionInput, options: CommandOptions): Promise<ApprovalDto> {
    return this.send("POST", paths.approvalApprove(id), options, withOperation(input, options));
  }

  reject(id: string, input: ApprovalDecisionInput, options: CommandOptions): Promise<ApprovalDto> {
    return this.send("POST", paths.approvalReject(id), options, withOperation(input, options));
  }

  requestChanges(
    id: string,
    input: ApprovalDecisionInput,
    options: CommandOptions,
  ): Promise<ApprovalDto> {
    return this.send(
      "POST",
      paths.approvalRequestChanges(id),
      options,
      withOperation(input, options),
    );
  }

  listArtifacts(query?: ListQuery): Promise<PageDto<ArtifactDto>> {
    return this.get(paths.artifacts(query));
  }

  getArtifact(id: string): Promise<ArtifactDto> {
    return this.get(paths.artifact(id));
  }

  getArtifactVersion(id: string, versionId: string): Promise<ArtifactVersionDto> {
    return this.get(paths.artifactVersion(id, versionId));
  }

  getArtifactVersionContent(id: string, versionId: string): Promise<Uint8Array> {
    return this.get(paths.artifactVersionContent(id, versionId));
  }

  getArtifactVersionLineage(id: string, versionId: string): Promise<ArtifactLineageDto> {
    return this.get(paths.artifactVersionLineage(id, versionId));
  }

  listEvents(query?: EventListQuery): Promise<PageDto<unknown>> {
    return this.get(paths.events(query));
  }

  eventsStreamPath(query?: EventListQuery): string {
    return assertSafePath(paths.eventsStream(query));
  }

  createSession(bootstrapToken: string): Promise<SessionDto> {
    return this.send("POST", paths.session(), { idempotencyKey: "bootstrap" }, { bootstrapToken });
  }

  rotateSession(): Promise<SessionDto> {
    return this.send("POST", paths.session(), { idempotencyKey: "rotate" }, {});
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.transport.request({ method: "GET", path: assertSafePath(path) });
    return this.unwrap<T>(res);
  }

  private async send<T>(
    method: "POST" | "PATCH",
    path: string,
    options: CommandOptions,
    body: unknown,
  ): Promise<T> {
    const res = await this.transport.request({
      method,
      path: assertSafePath(path),
      headers: commandHeaders(options),
      body,
    });
    return this.unwrap<T>(res);
  }

  private unwrap<T>(res: TransportResponse): T {
    if (res.status >= 400) {
      if (isProblemDetails(res.body)) {
        throw new ProblemError(res.body, res.status);
      }
      const fallback: ProblemDetails = {
        type: "urn:workforce:error:request_failed",
        title: "Request failed",
        status: res.status,
        code: "request_failed",
        detail: `HTTP ${res.status}`,
        instance: "",
        requestId: "",
        retryable: false,
      };
      throw new ProblemError(fallback, res.status);
    }
    return res.body as T;
  }
}

export function createDesktopClient(options: DesktopClientOptions): DesktopClient {
  return new DesktopClient(options.transport);
}
