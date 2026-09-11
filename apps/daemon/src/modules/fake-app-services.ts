import type { ApprovalStatus, ProjectStatus, RunStatus, TaskStatus } from "@workforce/domain";
import type { CommandReceipt, WorkforceEvent } from "@workforce/protocol";
import { InvalidTransitionError } from "@workforce/workflow-engine";
import {
  nextApprovalStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
} from "@workforce/workflow-engine";

import { sha256Hex } from "./digest.js";
import {
  LOCAL_NODE,
  LOCAL_NODE_ID,
  MOCK_RUNTIME,
  MOCK_RUNTIME_CAPABILITIES,
  MOCK_RUNTIME_ID,
  SOFTWARE_TEAM,
  TEAM_ID,
  findPublishedWorkflow,
  findPublishedWorkflowVersion,
  pageOf,
  publishedWorkflows,
  unknownProjectBudget,
} from "../composition/catalog.js";
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
  ExportBundleDto,
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
  WorkflowDto,
  WorkflowVersionDto,
  WorkspaceDto,
} from "./dto.js";
import { AppError } from "./errors.js";
import { createIdFactory, prefixes, type IdFactory } from "./ids.js";
import type { AppServices, CommandResult } from "./index.js";
import { paginate } from "./paginate.js";

const ORGANIZATION_ID = "org_local";
const PROTOCOL_VERSION = "0.1" as const;

interface ProjectRecord {
  dto: ProjectDto;
}

interface TaskRecord {
  dto: TaskDto;
}

interface RunRecord {
  dto: RunDto;
}

interface ApprovalRecord {
  dto: ApprovalDto;
}

interface ArtifactRecord {
  dto: ArtifactDto;
  versions: Map<
    string,
    ArtifactVersionDto & { content: Uint8Array; parents: string[]; children: string[] }
  >;
}

export interface FakeAppServicesOptions {
  now?: () => Date;
  ids?: IdFactory;
  runInput?: boolean;
  trimHorizon?: number;
}

function asProjectStatus(value: string): ProjectStatus {
  return value as ProjectStatus;
}

function asTaskStatus(value: string): TaskStatus {
  return value as TaskStatus;
}

function asRunStatus(value: string): RunStatus {
  return value as RunStatus;
}

function asApprovalStatus(value: string): ApprovalStatus {
  return value as ApprovalStatus;
}

export class FakeAppServices implements AppServices {
  private readonly now: () => Date;
  private readonly ids: IdFactory;
  private readonly runInput: boolean;
  private readonly horizon: number;
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly runs = new Map<string, RunRecord>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly events: WorkforceEvent[] = [];
  private readonly operations = new Map<string, CommandReceipt>();

  constructor(options: FakeAppServicesOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.ids = options.ids ?? createIdFactory();
    this.runInput = options.runInput ?? true;
    this.horizon = options.trimHorizon ?? 0;
  }

  capabilities(): CapabilitiesDto {
    return {
      protocolVersion: PROTOCOL_VERSION,
      apiVersion: "v1",
      run: {
        pause: false,
        resume: false,
        input: this.runInput,
        takeOver: false,
      },
      project: {
        pause: false,
        resume: false,
        archive: false,
      },
    };
  }

  getOperation(operationId: string, principalId: string): CommandReceipt | null {
    const receipt = this.operations.get(operationId);
    if (!receipt || receipt.scope.principalId !== principalId) {
      return null;
    }
    return receipt;
  }

  rememberOperation(receipt: CommandReceipt): void {
    this.operations.set(receipt.operationId, receipt);
  }

  async close(): Promise<void> {
    return;
  }

  listTeams(_query: ListQuery): PageDto<TeamDto> {
    void _query;
    return pageOf([SOFTWARE_TEAM]);
  }

  getTeam(id: string): TeamDto | null {
    return id === TEAM_ID ? SOFTWARE_TEAM : null;
  }

  listWorkflows(_query: ListQuery): PageDto<WorkflowDto> {
    void _query;
    return pageOf(publishedWorkflows());
  }

  getWorkflow(id: string): WorkflowDto | null {
    return findPublishedWorkflow(id);
  }

  getWorkflowVersion(id: string, versionId: string): WorkflowVersionDto | null {
    return findPublishedWorkflowVersion(id, versionId);
  }

  listNodes(_query: ListQuery): PageDto<NodeDto> {
    void _query;
    return pageOf([LOCAL_NODE]);
  }

  getNode(id: string): NodeDto | null {
    return id === LOCAL_NODE_ID ? LOCAL_NODE : null;
  }

  listRuntimes(_query: ListQuery): PageDto<RuntimeDto> {
    void _query;
    return pageOf([MOCK_RUNTIME]);
  }

  getRuntime(id: string): RuntimeDto | null {
    return id === MOCK_RUNTIME_ID ? MOCK_RUNTIME : null;
  }

  getRuntimeCapabilities(id: string): RuntimeCapabilitiesDto | null {
    return id === MOCK_RUNTIME_ID ? MOCK_RUNTIME_CAPABILITIES : null;
  }

  getProjectBudget(id: string): ProjectBudgetDto | null {
    if (!this.projects.has(id)) {
      return null;
    }
    return unknownProjectBudget(id);
  }

  createProjectWorkspace(
    ctx: CommandContext,
    id: string,
    input: CreateWorkspaceInput,
  ): CommandResult<WorkspaceDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    const ts = this.timestamp();
    const authorizationRef =
      input.authorizationRef.startsWith("/") ||
      /^[a-zA-Z]:[\\/]/.test(input.authorizationRef) ||
      input.authorizationRef.startsWith("\\\\")
        ? `ref_${sha256Hex(input.authorizationRef).slice(0, 16)}`
        : input.authorizationRef;
    const dto: WorkspaceDto = {
      id: this.ids(prefixes.workspace),
      projectId: record.dto.id,
      status: "bound",
      kind: "local",
      authorizationRef,
      createdAt: ts,
    };
    return { status: 201, body: dto, revision: record.dto.stateRevision };
  }

  listProjects(query: ListQuery): PageDto<ProjectDto> {
    return paginate(
      this.filter(
        [...this.projects.values()].map((record) => record.dto),
        query,
      ),
      query.cursor,
      query.limit,
    );
  }

  getProject(id: string): ProjectDto | null {
    return this.projects.get(id)?.dto ?? null;
  }

  createProject(ctx: CommandContext, input: CreateProjectInput): CommandResult<ProjectDto> {
    const ts = this.timestamp();
    const dto: ProjectDto = {
      id: this.ids(prefixes.project),
      organizationId: ORGANIZATION_ID,
      name: input.name,
      objective: input.objective,
      status: "draft",
      stateRevision: 1,
      protocolVersion: PROTOCOL_VERSION,
      cancelRequested: false,
      createdAt: ts,
      updatedAt: ts,
    };
    this.projects.set(dto.id, { dto });
    this.appendEvent("project.created", "project", dto.id, dto.id, {
      correlationId: ctx.operationId,
      data: { status: dto.status },
    });
    return { status: 201, body: dto, revision: dto.stateRevision };
  }

  patchProject(
    ctx: CommandContext,
    id: string,
    input: PatchProjectInput,
  ): CommandResult<ProjectDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (record.dto.status !== "draft" && record.dto.status !== "planning") {
      throw new AppError(
        "invalid_transition",
        "Project definition can only be patched in draft or planning",
      );
    }
    const next: ProjectDto = {
      ...record.dto,
      name: input.name ?? record.dto.name,
      objective: input.objective ?? record.dto.objective,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("project.updated", "project", next.id, next.id, {
      correlationId: ctx.operationId,
      data: { name: next.name },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  startPlanning(ctx: CommandContext, id: string): CommandResult<ProjectDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    const status = this.transitionProject(record.dto.status, "start-planning");
    const plan = this.createPlanArtifact(record.dto, ctx);
    const next: ProjectDto = {
      ...record.dto,
      status,
      planArtifactVersionId: plan.versionId,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("project.status_changed", "project", next.id, next.id, {
      correlationId: ctx.operationId,
      data: { from: "draft", to: status },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  confirmPlan(ctx: CommandContext, id: string, input: ConfirmPlanInput): CommandResult<ProjectDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (record.dto.planArtifactVersionId !== input.planArtifactVersionId) {
      throw new AppError("conflict", "planArtifactVersionId does not match the current plan");
    }
    const status = this.transitionProject(record.dto.status, "confirm-plan");
    this.consumePlanApproval(record.dto.id);
    const next: ProjectDto = {
      ...record.dto,
      status,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("project.status_changed", "project", next.id, next.id, {
      correlationId: ctx.operationId,
      data: { from: "planning", to: status },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  exportProject(ctx: CommandContext, id: string): CommandResult<ExportBundleDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (record.dto.status === "draft" || record.dto.status === "planning") {
      throw new AppError("invalid_transition", "Export requires a consumed artifact approval");
    }
    void ctx;
    return {
      status: 200,
      body: {
        projectId: id,
        digest: "sha256:fake-export",
        artifactVersionId: "arv_fake_export",
        status: "exported",
        report: {
          projectId: id,
          projectStatus: record.dto.status,
          artifacts: [],
        },
      },
      revision: record.dto.stateRevision,
    };
  }

  startProject(
    ctx: CommandContext,
    id: string,
    input: StartProjectInput,
  ): CommandResult<ProjectDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (input.budgetHardLimitMinor !== undefined) {
      throw new AppError(
        "unknown_cost_not_enforceable",
        "Mock run cost is unknown and cannot enforce a hard currency limit",
      );
    }
    const status = this.transitionProject(record.dto.status, "start");
    const next: ProjectDto = {
      ...record.dto,
      status,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.spawnExecution(next, ctx);
    this.appendEvent("project.status_changed", "project", next.id, next.id, {
      correlationId: ctx.operationId,
      data: { from: "ready", to: status },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  cancelProject(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): CommandResult<CommandAcceptedDto | ProjectDto> {
    const record = this.requireProject(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (record.dto.status === "running" || record.dto.status === "paused") {
      const next: ProjectDto = {
        ...record.dto,
        cancelRequested: true,
        stateRevision: record.dto.stateRevision + 1,
        updatedAt: this.timestamp(),
      };
      record.dto = next;
      this.appendEvent("project.cancel_requested", "project", next.id, next.id, {
        correlationId: ctx.operationId,
        data: { reason: input.reason ?? null, mode: input.mode ?? null },
      });
      return {
        status: 202,
        body: {
          operationId: ctx.operationId,
          acceptedAt: this.timestamp(),
          resource: { type: "project", id: next.id },
        },
        revision: next.stateRevision,
      };
    }
    const status = this.transitionProject(record.dto.status, "cancel");
    const next: ProjectDto = {
      ...record.dto,
      status,
      cancelRequested: false,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("project.status_changed", "project", next.id, next.id, {
      correlationId: ctx.operationId,
      data: { to: status },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  listTasks(query: ListQuery): PageDto<TaskDto> {
    return paginate(
      this.filter(
        [...this.tasks.values()].map((record) => record.dto),
        query,
        { projectId: (dto) => dto.projectId },
      ),
      query.cursor,
      query.limit,
    );
  }

  getTask(id: string): TaskDto | null {
    return this.tasks.get(id)?.dto ?? null;
  }

  retryTask(ctx: CommandContext, id: string): CommandResult<{ task: TaskDto; run: RunDto }> {
    const record = this.requireTask(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (record.dto.status !== "failed") {
      throw new AppError("invalid_transition", "Only a failed task can be retried");
    }
    const ts = this.timestamp();
    const task: TaskDto = {
      ...record.dto,
      status: "running",
      attempt: record.dto.attempt + 1,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: ts,
    };
    record.dto = task;
    const run = this.insertRun(task, ctx, "waiting_input");
    this.appendEvent("task.retried", "task", task.id, task.projectId, {
      correlationId: ctx.operationId,
      taskId: task.id,
      runId: run.id,
      data: { attempt: task.attempt },
    });
    return { status: 200, body: { task, run }, revision: task.stateRevision };
  }

  cancelTask(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): CommandResult<CommandAcceptedDto | TaskDto> {
    const record = this.requireTask(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (record.dto.status === "running") {
      const next: TaskDto = {
        ...record.dto,
        cancelRequested: true,
        stateRevision: record.dto.stateRevision + 1,
        updatedAt: this.timestamp(),
      };
      record.dto = next;
      this.appendEvent("task.cancel_requested", "task", next.id, next.projectId, {
        correlationId: ctx.operationId,
        taskId: next.id,
        data: { reason: input.reason ?? null },
      });
      return {
        status: 202,
        body: {
          operationId: ctx.operationId,
          acceptedAt: this.timestamp(),
          resource: { type: "task", id: next.id },
        },
        revision: next.stateRevision,
      };
    }
    const status = this.transitionTask(record.dto.status, "cancel");
    const next: TaskDto = {
      ...record.dto,
      status,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("task.status_changed", "task", next.id, next.projectId, {
      correlationId: ctx.operationId,
      taskId: next.id,
      data: { to: status },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  listRuns(query: ListQuery): PageDto<RunDto> {
    return paginate(
      this.filter(
        [...this.runs.values()].map((record) => record.dto),
        query,
        {
          projectId: (dto) => dto.projectId,
          taskId: (dto) => dto.taskId,
        },
      ),
      query.cursor,
      query.limit,
    );
  }

  getRun(id: string): RunDto | null {
    return this.runs.get(id)?.dto ?? null;
  }

  cancelRun(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): CommandResult<CommandAcceptedDto> {
    const record = this.requireRun(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (
      record.dto.status === "succeeded" ||
      record.dto.status === "failed" ||
      record.dto.status === "timed_out" ||
      record.dto.status === "cancelled"
    ) {
      throw new AppError("invalid_transition", "A terminal run cannot be cancelled");
    }
    const next: RunDto = {
      ...record.dto,
      cancelRequested: true,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("run.cancel_requested", "run", next.id, next.projectId, {
      correlationId: ctx.operationId,
      taskId: next.taskId,
      runId: next.id,
      data: { reason: input.reason ?? null, mode: input.mode ?? null },
    });
    return {
      status: 202,
      body: {
        operationId: ctx.operationId,
        acceptedAt: this.timestamp(),
        resource: { type: "run", id: next.id },
      },
      revision: next.stateRevision,
    };
  }

  pauseRun(_ctx: CommandContext, id: string): CommandResult<CommandAcceptedDto | RunDto> {
    this.requireRun(id);
    throw new AppError("unsupported_capability", "lifecycle.pause is unsupported");
  }

  sendRunInput(ctx: CommandContext, id: string, input: RunInputBody): CommandResult<RunDto> {
    if (!this.runInput) {
      throw new AppError("unsupported_capability", "Runtime does not support input");
    }
    const record = this.requireRun(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    const status = this.transitionRun(record.dto.status, "input");
    const next: RunDto = {
      ...record.dto,
      status,
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    this.appendEvent("run.status_changed", "run", next.id, next.projectId, {
      correlationId: ctx.operationId,
      taskId: next.taskId,
      runId: next.id,
      data: { from: "waiting_input", to: status, text: input.text ?? null },
    });
    return { status: 200, body: next, revision: next.stateRevision };
  }

  listRunEvents(runId: string, query: EventListQuery): PageDto<WorkforceEvent> {
    this.requireRun(runId);
    return this.listEvents({ ...query, runId, stream: `run:${runId}` });
  }

  listApprovals(query: ListQuery): PageDto<ApprovalDto> {
    return paginate(
      this.filter(
        [...this.approvals.values()].map((record) => record.dto),
        query,
        { projectId: (dto) => dto.projectId },
      ),
      query.cursor,
      query.limit,
    );
  }

  getApproval(id: string): ApprovalDto | null {
    return this.approvals.get(id)?.dto ?? null;
  }

  approve(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): CommandResult<ApprovalDto> {
    return this.decideApproval(ctx, id, input, "approve");
  }

  reject(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): CommandResult<ApprovalDto> {
    return this.decideApproval(ctx, id, input, "reject");
  }

  requestChanges(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): CommandResult<ApprovalDto> {
    return this.decideApproval(ctx, id, input, "request-changes");
  }

  listArtifacts(query: ListQuery): PageDto<ArtifactDto> {
    return paginate(
      this.filter(
        [...this.artifacts.values()].map((record) => record.dto),
        query,
        { projectId: (dto) => dto.projectId },
      ),
      query.cursor,
      query.limit,
    );
  }

  getArtifact(id: string): ArtifactDto | null {
    return this.artifacts.get(id)?.dto ?? null;
  }

  getArtifactVersion(id: string, versionId: string): ArtifactVersionDto | null {
    const version = this.artifacts.get(id)?.versions.get(versionId);
    if (!version) {
      return null;
    }
    return {
      id: version.id,
      artifactId: version.artifactId,
      version: version.version,
      status: version.status,
      hash: version.hash,
      size: version.size,
      mediaType: version.mediaType,
      createdAt: version.createdAt,
    };
  }

  readArtifactContent(id: string, versionId: string): ArtifactContentDto | null {
    const version = this.artifacts.get(id)?.versions.get(versionId);
    if (!version) {
      return null;
    }
    return { mediaType: version.mediaType, body: version.content };
  }

  getArtifactLineage(id: string, versionId: string): ArtifactLineageDto | null {
    const version = this.artifacts.get(id)?.versions.get(versionId);
    if (!version) {
      return null;
    }
    return {
      artifactVersionId: version.id,
      parents: [...version.parents],
      children: [...version.children],
    };
  }

  listEvents(query: EventListQuery): PageDto<WorkforceEvent> {
    const matched = this.events.filter((event) => {
      if ((event.ingestionPosition ?? 0) <= query.afterIngestionPosition) {
        return false;
      }
      if ((event.ingestionPosition ?? 0) <= this.horizon) {
        return false;
      }
      if (query.projectId !== undefined && event.projectId !== query.projectId) {
        return false;
      }
      if (query.runId !== undefined && event.runId !== query.runId) {
        return false;
      }
      if (query.stream !== undefined && event.stream !== query.stream) {
        return false;
      }
      if (
        query.types !== undefined &&
        query.types.length > 0 &&
        !query.types.includes(event.type)
      ) {
        return false;
      }
      return true;
    });
    const slice = matched.slice(0, query.limit);
    const last = slice[slice.length - 1];
    const hasMore = slice.length < matched.length;
    return {
      items: slice,
      page: {
        nextCursor: hasMore && last?.id !== undefined ? last.id : null,
        hasMore,
      },
    };
  }

  highWaterMark(): number {
    const last = this.events[this.events.length - 1];
    return last?.ingestionPosition ?? 0;
  }

  trimHorizon(): number {
    return this.horizon;
  }

  /** Test helper: mark a task failed so retry can be exercised over HTTP. */
  failTask(id: string): TaskDto {
    const record = this.requireTask(id);
    const next: TaskDto = {
      ...record.dto,
      status: "failed",
      stateRevision: record.dto.stateRevision + 1,
      updatedAt: this.timestamp(),
    };
    record.dto = next;
    return next;
  }

  private decideApproval(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
    command: "approve" | "reject" | "request-changes",
  ): CommandResult<ApprovalDto> {
    const record = this.requireApproval(id);
    this.assertMatch(record.dto.stateRevision, ctx.ifMatch);
    if (input.digest !== undefined && input.digest !== record.dto.actionDigest) {
      throw new AppError("conflict", "Approval digest does not match the canonical action");
    }
    if (
      input.artifactVersionId !== undefined &&
      record.dto.artifactVersionId !== undefined &&
      input.artifactVersionId !== record.dto.artifactVersionId
    ) {
      throw new AppError("conflict", "Approval artifact version does not match");
    }
    const status = this.transitionApproval(record.dto.status, command);
    let next: ApprovalDto = {
      ...record.dto,
      status,
      decisionReason: input.decisionReason,
      stateRevision: record.dto.stateRevision + 1,
    };
    if (command === "approve") {
      next = {
        ...next,
        status: this.transitionApproval(status, "consume"),
        stateRevision: next.stateRevision + 1,
      };
      if (next.gate === "plan") {
        const project = this.requireProject(next.projectId);
        if (project.dto.status === "planning") {
          project.dto = {
            ...project.dto,
            status: this.transitionProject(project.dto.status, "confirm-plan"),
            stateRevision: project.dto.stateRevision + 1,
            updatedAt: this.timestamp(),
          };
        }
      }
      if (next.gate === "artifact" && next.taskId) {
        const task = this.tasks.get(next.taskId);
        if (task && task.dto.status === "waiting_review") {
          task.dto = {
            ...task.dto,
            status: this.transitionTask(task.dto.status, "approve"),
            stateRevision: task.dto.stateRevision + 1,
            updatedAt: this.timestamp(),
          };
        }
      }
    }
    if (command === "request-changes" && next.taskId) {
      const task = this.tasks.get(next.taskId);
      if (task && task.dto.status === "waiting_review") {
        task.dto = {
          ...task.dto,
          status: this.transitionTask(task.dto.status, "request-changes"),
          generation: task.dto.generation + 1,
          stateRevision: task.dto.stateRevision + 1,
          updatedAt: this.timestamp(),
        };
      }
    }
    if (command === "reject" && next.taskId) {
      const task = this.tasks.get(next.taskId);
      if (task && task.dto.status === "waiting_review") {
        task.dto = {
          ...task.dto,
          status: this.transitionTask(task.dto.status, "reject"),
          stateRevision: task.dto.stateRevision + 1,
          updatedAt: this.timestamp(),
        };
      }
    }
    record.dto = next;
    const decided: {
      correlationId: string;
      data: Record<string, unknown>;
      taskId?: string;
    } = {
      correlationId: ctx.operationId,
      data: { command, status: next.status, requestedChanges: input.requestedChanges ?? null },
    };
    if (next.taskId !== undefined) {
      decided.taskId = next.taskId;
    }
    this.appendEvent("approval.decided", "approval", next.id, next.projectId, decided);
    return { status: 200, body: next, revision: next.stateRevision };
  }

  private spawnExecution(project: ProjectDto, ctx: CommandContext): void {
    const ts = this.timestamp();
    const task: TaskDto = {
      id: this.ids(prefixes.task),
      projectId: project.id,
      title: "Implement plan",
      objective: project.objective,
      status: "running",
      stateRevision: 1,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      protocolVersion: PROTOCOL_VERSION,
      cancelRequested: false,
      createdAt: ts,
      updatedAt: ts,
      dependsOn: [],
    };
    this.tasks.set(task.id, { dto: task });
    this.insertRun(task, ctx, "waiting_input");
    this.appendEvent("task.created", "task", task.id, project.id, {
      correlationId: ctx.operationId,
      taskId: task.id,
      data: { status: task.status },
    });
  }

  private insertRun(task: TaskDto, ctx: CommandContext, status: RunStatus): RunDto {
    const ts = this.timestamp();
    const dto: RunDto = {
      id: this.ids(prefixes.run),
      taskId: task.id,
      projectId: task.projectId,
      status,
      stateRevision: 1,
      definitionRevision: task.definitionRevision,
      generation: task.generation,
      attempt: task.attempt,
      protocolVersion: PROTOCOL_VERSION,
      cancelRequested: false,
      usage: { costMinor: 0, currency: "USD", kind: "unknown" },
      createdAt: ts,
      updatedAt: ts,
    };
    this.runs.set(dto.id, { dto });
    this.appendEvent("run.status_changed", "run", dto.id, dto.projectId, {
      correlationId: ctx.operationId,
      taskId: dto.taskId,
      runId: dto.id,
      stream: `run:${dto.id}`,
      data: { to: dto.status },
    });
    return dto;
  }

  private createPlanArtifact(
    project: ProjectDto,
    ctx: CommandContext,
  ): { artifactId: string; versionId: string } {
    const ts = this.timestamp();
    const artifactId = this.ids(prefixes.artifact);
    const versionId = this.ids(prefixes.artifactVersion);
    const content = new TextEncoder().encode(`# Plan\n\n${project.objective}\n`);
    const hash = sha256Hex(Buffer.from(content).toString("hex"));
    const version: ArtifactVersionDto = {
      id: versionId,
      artifactId,
      version: 1,
      status: "available",
      hash,
      size: content.byteLength,
      mediaType: "text/markdown",
      createdAt: ts,
    };
    const dto: ArtifactDto = {
      id: artifactId,
      projectId: project.id,
      logicalName: "plan",
      kind: "plan",
      createdAt: ts,
      versions: [
        {
          id: version.id,
          version: version.version,
          status: version.status,
          hash: version.hash,
          size: version.size,
          createdAt: version.createdAt,
        },
      ],
    };
    this.artifacts.set(artifactId, {
      dto,
      versions: new Map([[versionId, { ...version, content, parents: [], children: [] }]]),
    });
    const approval: ApprovalDto = {
      id: this.ids(prefixes.approval),
      projectId: project.id,
      gate: "plan",
      status: "pending",
      stateRevision: 1,
      actionDigest: hash,
      resource: versionId,
      artifactVersionId: versionId,
      requestedAt: ts,
    };
    this.approvals.set(approval.id, { dto: approval });
    this.appendEvent("artifact.available", "artifact", artifactId, project.id, {
      correlationId: ctx.operationId,
      data: { versionId, hash },
    });
    this.appendEvent("approval.requested", "approval", approval.id, project.id, {
      correlationId: ctx.operationId,
      data: { gate: "plan", artifactVersionId: versionId },
    });
    return { artifactId, versionId };
  }

  private consumePlanApproval(projectId: string): void {
    for (const record of this.approvals.values()) {
      if (
        record.dto.projectId === projectId &&
        record.dto.gate === "plan" &&
        record.dto.status === "pending"
      ) {
        const approved = this.transitionApproval(record.dto.status, "approve");
        record.dto = {
          ...record.dto,
          status: this.transitionApproval(approved, "consume"),
          stateRevision: record.dto.stateRevision + 2,
        };
      }
    }
  }

  private filter<D extends { id: string; status?: string; projectId?: string; taskId?: string }>(
    items: D[],
    query: ListQuery,
    extras: {
      projectId?: (item: D) => string;
      taskId?: (item: D) => string;
    } = {},
  ): D[] {
    const out: D[] = [];
    for (const item of items) {
      if (query.status !== undefined && item.status !== query.status) {
        continue;
      }
      if (
        query.projectId !== undefined &&
        extras.projectId &&
        extras.projectId(item) !== query.projectId
      ) {
        continue;
      }
      if (query.taskId !== undefined && extras.taskId && extras.taskId(item) !== query.taskId) {
        continue;
      }
      out.push(item);
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }

  private requireProject(id: string): ProjectRecord {
    const record = this.projects.get(id);
    if (!record) {
      throw new AppError("not_found", `Project ${id} not found`);
    }
    return record;
  }

  private requireTask(id: string): TaskRecord {
    const record = this.tasks.get(id);
    if (!record) {
      throw new AppError("not_found", `Task ${id} not found`);
    }
    return record;
  }

  private requireRun(id: string): RunRecord {
    const record = this.runs.get(id);
    if (!record) {
      throw new AppError("not_found", `Run ${id} not found`);
    }
    return record;
  }

  private requireApproval(id: string): ApprovalRecord {
    const record = this.approvals.get(id);
    if (!record) {
      throw new AppError("not_found", `Approval ${id} not found`);
    }
    return record;
  }

  private assertMatch(current: number, ifMatch: number | undefined): void {
    if (ifMatch === undefined) {
      throw new AppError("validation_failed", "If-Match is required");
    }
    if (ifMatch !== current) {
      throw new AppError("revision_conflict", "If-Match does not match stateRevision", {
        currentRevision: current,
      });
    }
  }

  private transitionProject(from: string, command: string): ProjectStatus {
    try {
      return nextProjectStatus(asProjectStatus(from), command);
    } catch (error) {
      throw this.wrapTransition(error);
    }
  }

  private transitionTask(from: string, command: string): TaskStatus {
    try {
      return nextTaskStatus(asTaskStatus(from), command);
    } catch (error) {
      throw this.wrapTransition(error);
    }
  }

  private transitionRun(from: string, command: string): RunStatus {
    try {
      return nextRunStatus(asRunStatus(from), command);
    } catch (error) {
      throw this.wrapTransition(error);
    }
  }

  private transitionApproval(from: string, command: string): ApprovalStatus {
    try {
      return nextApprovalStatus(asApprovalStatus(from), command);
    } catch (error) {
      throw this.wrapTransition(error);
    }
  }

  private wrapTransition(error: unknown): AppError {
    if (error instanceof InvalidTransitionError) {
      return new AppError("invalid_transition", error.message);
    }
    throw error;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private appendEvent(
    type: string,
    subjectType: string,
    subjectId: string,
    projectId: string,
    extra: {
      correlationId: string;
      data: Record<string, unknown>;
      taskId?: string;
      runId?: string;
      stream?: string;
    },
  ): void {
    const ts = this.timestamp();
    const ingestionPosition = this.events.length + 1;
    const event: WorkforceEvent = {
      specVersion: "0.1",
      id: this.ids(prefixes.event),
      type,
      source: "workforce.daemon",
      subject: { type: subjectType, id: subjectId },
      time: ts,
      recordedAt: ts,
      organizationId: ORGANIZATION_ID,
      projectId,
      actor: { type: "user", id: "usr_local" },
      sequence: ingestionPosition,
      stream: extra.stream ?? `project:${projectId}`,
      ingestionPosition,
      correlationId: extra.correlationId,
      dataContentType: "application/json",
      dataSchema: `urn:workforce:event:${type}:0.1`,
      data: extra.data,
      sensitivity: "internal",
    };
    if (extra.taskId !== undefined) {
      event.taskId = extra.taskId;
    }
    if (extra.runId !== undefined) {
      event.runId = extra.runId;
    }
    this.events.push(event);
  }
}
