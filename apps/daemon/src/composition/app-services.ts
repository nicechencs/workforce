import fs from "node:fs";
import path from "node:path";

import {
  CatalogService,
  HostCapabilityError,
  MOCK_PLAN_DOCUMENT,
  UseCaseError,
  WorkforceApp,
  createWorkforceApp,
  integratePatches,
  mapPublishedTaskDependsOn,
  settleRunCancel,
  type ApprovalRecord,
  type ProjectRecord,
  type RunRecord,
  type TaskRecord,
} from "@workforce/application";
import {
  KIND_MEDIA_TYPES,
  LocalArtifactStore,
  collectBytes,
  type LineageSource,
  type RegistrableKind,
  type StoredArtifactVersion,
} from "@workforce/artifacts";
import { WorkforceSqlite } from "@workforce/database";
import type { CanonicalAction, InMemoryPolicyEngine } from "@workforce/policy";
import {
  DEFAULT_ORCHESTRATION_MODE,
  type CommandReceipt,
  type WorkforceEvent,
} from "@workforce/protocol";
import { InvalidTransitionError } from "@workforce/workflow-engine";

import { loadOrCreateClientId, loadOrCreatePrincipalId } from "../bootstrap/state-file.js";
import { canonicalJson, sha256Hex } from "../modules/digest.js";
import type {
  ApprovalDecisionInput,
  ApprovalDto,
  ArtifactContentDto,
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
  ArtifactVersionSummaryDto,
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
} from "../modules/dto.js";
import { AppError } from "../modules/errors.js";
import { assertStartOrchestrationAllowed } from "../modules/orchestration.js";
import type { AppServices, CommandResult } from "../modules/index.js";
import { paginate } from "../modules/paginate.js";
import {
  DEFAULT_BUDGET_ID,
  estimatedProjectBudget,
  LOCAL_NODE,
  LOCAL_NODE_ID,
  MOCK_RUNTIME,
  MOCK_RUNTIME_CAPABILITIES,
  MOCK_RUNTIME_ID,
  MOCK_RUNTIME_INSTALLATION_ID,
  ORGANIZATION_ID,
  PROTOCOL_VERSION,
  TEAM_VERSION_ID,
  mockPlanGraph,
  pageOf,
  unknownProjectBudget,
} from "./catalog.js";
import { captureMockPatch, gitDiffArtifactFromCapture, isGitDiffSlot } from "./delivery-bind.js";
import { createEnginePort } from "./engine.js";
import { ComposedMockHost, type RunTerminalEvent } from "./mock-host.js";
import {
  dualWriteSqlite,
  dumpWorld,
  hydrateWorld,
  JsonRuntimeHostStore,
  loadComposition,
  persistRuntimeHandle,
  persistSnapshot,
  sqlitePath,
  type ArtifactContentRecord,
} from "./persist.js";
import { MemoryIntegrationStore } from "./integration-store.js";
import { CompositionPolicy, createCompositionPolicy } from "./policy.js";
import { bindWorktreesToHost, CompositionWorktreeHost } from "./worktree-host.js";
import {
  assertBindableTeamVersionId,
  createAuthoringCatalog,
  listedDraftTeams,
  listedTeams,
  listedWorkflows,
  resolveTeam,
  resolveTeamVersion,
  resolveWorkflow,
  resolveWorkflowVersion,
} from "../modules/authoring-catalog.js";
import { validateWorkflowGraph } from "@workforce/workflow-engine";

const encoder = new TextEncoder();
type SqliteWriter = typeof dualWriteSqlite;
const sqliteWriterOption = Symbol("sqliteWriter");

export interface ComposedAppServicesOptions {
  stateDir: string;
  principalId?: string;
  clientId?: string;
  completeAfterMs?: number;
  policyEngine?: InMemoryPolicyEngine;
}

type InternalComposedAppServicesOptions = ComposedAppServicesOptions & {
  [sqliteWriterOption]?: SqliteWriter;
};

export class ComposedAppServices implements AppServices {
  readonly app: WorkforceApp;
  readonly host: ComposedMockHost;
  readonly sqlite: WorkforceSqlite;
  readonly artifacts: LocalArtifactStore;
  readonly worktrees: CompositionWorktreeHost;
  readonly policy: CompositionPolicy;
  readonly authoring: CatalogService;
  readonly stateDir: string;
  private readonly hostStore: JsonRuntimeHostStore;
  private readonly sqliteWriter: SqliteWriter;
  private readonly operations = new Map<string, CommandReceipt>();
  private readonly artifactContents = new Map<string, ArtifactContentRecord>();
  private readonly workspaces = new Map<string, WorkspaceDto>();
  private readonly decisionReasons = new Map<string, string>();
  private readonly synced = { eventIds: new Set<string>(), operationIds: new Set<string>() };
  private readonly integrations = new MemoryIntegrationStore();
  private writeChain: Promise<void> = Promise.resolve();
  private sqliteWrite: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(input: {
    stateDir: string;
    app: WorkforceApp;
    host: ComposedMockHost;
    hostStore: JsonRuntimeHostStore;
    sqlite: WorkforceSqlite;
    artifacts: LocalArtifactStore;
    worktrees: CompositionWorktreeHost;
    policy: CompositionPolicy;
    sqliteWriter: SqliteWriter;
    authoring: CatalogService;
  }) {
    this.stateDir = input.stateDir;
    this.app = input.app;
    this.host = input.host;
    this.hostStore = input.hostStore;
    this.sqlite = input.sqlite;
    this.artifacts = input.artifacts;
    this.worktrees = input.worktrees;
    this.policy = input.policy;
    this.sqliteWriter = input.sqliteWriter;
    this.authoring = input.authoring;
  }

  static async open(options: ComposedAppServicesOptions): Promise<ComposedAppServices> {
    fs.mkdirSync(options.stateDir, { recursive: true });
    const principalId = options.principalId ?? loadOrCreatePrincipalId(options.stateDir);
    const clientId = options.clientId ?? loadOrCreateClientId(options.stateDir);
    const sqlite = WorkforceSqlite.open(sqlitePath(options.stateDir));
    const snapshot = await loadComposition(options.stateDir, sqlite);
    const hostStore = new JsonRuntimeHostStore(async (handle) => {
      await persistRuntimeHandle(sqlite, handle);
    });
    if (snapshot?.host) {
      hostStore.load(snapshot.host);
    }
    const artifacts = await LocalArtifactStore.open({
      root: path.join(options.stateDir, "artifacts"),
    });

    const engine = createEnginePort();
    const policy = options.policyEngine
      ? new CompositionPolicy(options.policyEngine)
      : createCompositionPolicy({ principalId, grants: sqlite.grants });
    const composed: { services?: ComposedAppServices } = {};
    const worktrees = await CompositionWorktreeHost.open({ stateDir: options.stateDir });
    const host = new ComposedMockHost({
      store: hostStore,
      completeAfterMs: options.completeAfterMs ?? 10,
      nodeId: LOCAL_NODE_ID,
      onTerminal: async (event) => {
        if (!composed.services) {
          return;
        }
        await composed.services.handleTerminal(event);
      },
    });
    const app = createWorkforceApp({
      engine,
      host: bindWorktreesToHost({
        inner: host,
        worktrees,
        resolveTask: (taskId) => composed.services?.app.world.tasks.get(taskId),
      }),
      principalId,
      clientId,
    });
    const authoring = createAuthoringCatalog({
      ids: { ulid: (prefix) => app.world.ids.ulid(prefix) },
      now: () => app.world.nowIso(),
      validateWorkflowGraph,
    }).service;
    hydrateCatalog(sqlite, authoring);
    const services = new ComposedAppServices({
      stateDir: options.stateDir,
      app,
      host,
      hostStore,
      sqlite,
      artifacts,
      worktrees,
      policy,
      authoring,
      sqliteWriter:
        (options as InternalComposedAppServicesOptions)[sqliteWriterOption] ?? dualWriteSqlite,
    });
    composed.services = services;

    if (snapshot?.world) {
      const restored = await hydrateWorld(app.world, snapshot.world);
      for (const receipt of restored.operations) {
        services.operations.set(receipt.operationId, receipt);
      }
      for (const record of restored.artifactContents) {
        services.artifactContents.set(record.versionId, record);
      }
      for (const workspace of restored.workspaces) {
        services.workspaces.set(workspace.id, workspace);
      }
      const clock = app.world.clock as unknown as { current: Date };
      clock.current = new Date();
      for (const workspace of services.workspaces.values()) {
        await services.worktrees.bindProject(workspace.projectId);
      }
    }
    await services.restoreArtifactAuthority();

    try {
      await host.recover();
    } catch {
      // Mock adapter does not keep live processes across process restarts.
    }
    for (const run of app.world.runs.values()) {
      if (isTerminalRun(run)) {
        continue;
      }
      const handleId =
        run.handleId ??
        snapshot?.host.operations.find((operation) => operation.operationId === run.operationId)
          ?.handleId ??
        snapshot?.host.handles.find((handle) => handle.request.operationId === run.operationId)
          ?.handle.handleId;
      if (!handleId) {
        app.markRunUnknown(run.id);
        continue;
      }
      run.handleId = handleId;
      try {
        const observed = await host.inspect(handleId);
        if (observed.status === "unknown" || observed.status === "orphaned") {
          app.markRunUnknown(run.id);
        }
      } catch {
        app.markRunUnknown(run.id);
      }
    }
    for (const project of app.world.projects.values()) {
      await app.reconcile(project.id);
    }
    services.persist();
    return services;
  }

  capabilities(): CapabilitiesDto {
    return {
      protocolVersion: PROTOCOL_VERSION,
      apiVersion: "v1",
      run: {
        pause: false,
        resume: false,
        input: true,
        takeOver: false,
      },
      project: {
        pause: false,
        resume: false,
        archive: false,
      },
      orchestration: {
        workflowBound: true,
        direct: false,
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
    this.persist();
  }

  listTeams(query: ListQuery): PageDto<TeamDto> {
    if (query.status === "draft") {
      return pageOf(listedDraftTeams(this.authoring));
    }
    return pageOf(listedTeams(this.authoring));
  }

  getTeam(id: string): TeamDto | null {
    return resolveTeam(this.authoring, id);
  }

  getTeamVersion(id: string, versionId: string): TeamVersionDto | null {
    return resolveTeamVersion(this.authoring, id, versionId);
  }

  createTeam(ctx: CommandContext, input: CreateTeamInput): Promise<CommandResult<TeamDto>> {
    return this.exclusive(async () => {
      void ctx;
      const team = this.authoring.createTeam(input);
      await this.persistCatalogTeam(team.id);
      return {
        status: 201,
        body: resolveTeam(this.authoring, team.id)!,
        revision: team.stateRevision,
      };
    });
  }

  patchTeam(
    ctx: CommandContext,
    id: string,
    input: PatchTeamInput,
  ): Promise<CommandResult<TeamDto>> {
    return this.exclusive(async () => {
      const team = this.authoring.patchTeam(id, input, ctx.ifMatch);
      await this.persistCatalogTeam(id);
      return {
        status: 200,
        body: resolveTeam(this.authoring, id)!,
        revision: team.stateRevision,
      };
    });
  }

  createTeamVersion(
    ctx: CommandContext,
    id: string,
    input: CreateTeamVersionInput,
  ): Promise<CommandResult<TeamVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.createTeamVersion(id, input, ctx.ifMatch);
      await this.persistCatalogTeam(id);
      return {
        status: 201,
        body: resolveTeamVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
  }

  patchTeamVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
    input: PatchTeamVersionInput,
  ): Promise<CommandResult<TeamVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.patchTeamVersion(id, versionId, input, ctx.ifMatch);
      await this.persistCatalogTeam(id);
      return {
        status: 200,
        body: resolveTeamVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
  }

  publishTeamVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): Promise<CommandResult<TeamVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.publishTeamVersion(id, versionId, ctx.ifMatch);
      await this.persistCatalogTeam(id);
      return {
        status: 200,
        body: resolveTeamVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
  }

  listWorkflows(_query: ListQuery): PageDto<WorkflowDto> {
    void _query;
    return pageOf(listedWorkflows(this.authoring));
  }

  getWorkflow(id: string): WorkflowDto | null {
    return resolveWorkflow(this.authoring, id);
  }

  getWorkflowVersion(id: string, versionId: string): WorkflowVersionDto | null {
    return resolveWorkflowVersion(this.authoring, id, versionId);
  }

  createWorkflow(
    ctx: CommandContext,
    input: CreateWorkflowInput,
  ): Promise<CommandResult<WorkflowDto>> {
    return this.exclusive(async () => {
      void ctx;
      const workflow = this.authoring.createWorkflow(input);
      await this.persistCatalogWorkflow(workflow.id);
      return {
        status: 201,
        body: resolveWorkflow(this.authoring, workflow.id)!,
        revision: workflow.stateRevision,
      };
    });
  }

  patchWorkflow(
    ctx: CommandContext,
    id: string,
    input: PatchWorkflowInput,
  ): Promise<CommandResult<WorkflowDto>> {
    return this.exclusive(async () => {
      const workflow = this.authoring.patchWorkflow(id, input, ctx.ifMatch);
      await this.persistCatalogWorkflow(id);
      return {
        status: 200,
        body: resolveWorkflow(this.authoring, id)!,
        revision: workflow.stateRevision,
      };
    });
  }

  createWorkflowVersion(
    ctx: CommandContext,
    id: string,
    input: CreateWorkflowVersionInput,
  ): Promise<CommandResult<WorkflowVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.createWorkflowVersion(id, input, ctx.ifMatch);
      await this.persistCatalogWorkflow(id);
      return {
        status: 201,
        body: resolveWorkflowVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
  }

  patchWorkflowVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
    input: PatchWorkflowVersionInput,
  ): Promise<CommandResult<WorkflowVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.patchWorkflowVersion(id, versionId, input, ctx.ifMatch);
      await this.persistCatalogWorkflow(id);
      return {
        status: 200,
        body: resolveWorkflowVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
  }

  publishWorkflowVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): Promise<CommandResult<WorkflowVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.publishWorkflowVersion(id, versionId, ctx.ifMatch);
      await this.persistCatalogWorkflow(id);
      return {
        status: 200,
        body: resolveWorkflowVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
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
    const project = this.app.world.projects.get(id);
    if (!project) {
      return null;
    }
    const budget = project.budgetId ? this.app.world.budgets.get(project.budgetId) : undefined;
    if (!budget) {
      return unknownProjectBudget(id);
    }
    return estimatedProjectBudget(id, {
      estimatedLimitMinor: budget.limitMinor,
      reservedMinor: budget.reservedMinor,
      settledMinor: budget.settledMinor,
      authorizationVersion: budget.authorizationVersion,
      currency: budget.currency,
    });
  }

  createProjectWorkspace(
    ctx: CommandContext,
    id: string,
    input: CreateWorkspaceInput,
  ): Promise<CommandResult<WorkspaceDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      const now = this.app.world.nowIso();
      const workspace: WorkspaceDto = {
        id: this.app.world.ids.ulid("wsp_"),
        projectId: project.id,
        status: "bound",
        kind: "local",
        authorizationRef: publicAuthorizationRef(input.authorizationRef),
        createdAt: now,
      };
      this.workspaces.set(workspace.id, workspace);
      project.workspaceId = workspace.id;
      project.workspaceInstanceId = this.app.world.ids.ulid("wsi_");
      project.stateRevision += 1;
      project.updatedAt = now;
      await this.worktrees.bindProject(project.id);
      this.persist();
      return { status: 201, body: workspace, revision: project.stateRevision };
    });
  }

  listProjects(query: ListQuery): PageDto<ProjectDto> {
    return paginate(
      this.filter(
        [...this.app.world.projects.values()].map((record) => this.projectDto(record)),
        query,
      ),
      query.cursor,
      query.limit,
    );
  }

  getProject(id: string): ProjectDto | null {
    const project = this.app.world.projects.get(id);
    return project ? this.projectDto(project) : null;
  }

  createProject(
    ctx: CommandContext,
    input: CreateProjectInput,
  ): Promise<CommandResult<ProjectDto>> {
    return this.exclusive(async () => {
      const created = await this.app.createProject({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        organizationId: ORGANIZATION_ID,
        name: input.name,
        objective: input.objective,
      });
      this.persist();
      return {
        status: created.reused ? 200 : 201,
        body: this.projectDto(created.project),
        revision: created.project.stateRevision,
      };
    });
  }

  patchProject(
    ctx: CommandContext,
    id: string,
    input: PatchProjectInput,
  ): Promise<CommandResult<ProjectDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      if (project.status !== "draft" && project.status !== "planning") {
        throw new AppError(
          "invalid_transition",
          "Project definition can only be patched in draft or planning",
        );
      }
      if (input.name !== undefined) {
        project.name = input.name;
      }
      if (input.objective !== undefined) {
        project.objective = input.objective;
      }
      if (input.teamVersionId !== undefined) {
        assertBindableTeamVersionId(this.authoring, input.teamVersionId);
        project.teamVersionId = input.teamVersionId;
      }
      project.stateRevision += 1;
      project.updatedAt = this.app.world.nowIso();
      this.persist();
      return { status: 200, body: this.projectDto(project), revision: project.stateRevision };
    });
  }

  startPlanning(ctx: CommandContext, id: string): Promise<CommandResult<ProjectDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      const teamVersionId = project.teamVersionId ?? TEAM_VERSION_ID;
      assertBindableTeamVersionId(this.authoring, teamVersionId);
      const workspace = await this.workspaceFor(project);
      const planDigest = sha256Hex(canonicalJson(MOCK_PLAN_DOCUMENT));
      const started = await this.app.startPlanning({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId: project.id,
        workspaceId: workspace.id,
        teamVersionId,
        runtimeId: MOCK_RUNTIME_ID,
        budgetId: project.budgetId ?? DEFAULT_BUDGET_ID,
        executionNodeId: LOCAL_NODE_ID,
        runtimeInstallationId: MOCK_RUNTIME_INSTALLATION_ID,
        workspaceInstanceId: project.workspaceInstanceId ?? this.app.world.ids.ulid("wsi_"),
        planDigest,
        ...optionalRevision(ctx.ifMatch),
      });
      const live = this.requireProject(id);
      if (live.planArtifactVersionId) {
        const body = encoder.encode(`${JSON.stringify(MOCK_PLAN_DOCUMENT, null, 2)}\n`);
        await this.commitArtifact({
          artifactId: live.planArtifactVersionId,
          aliasVersionId: live.planArtifactVersionId,
          slotId: "plan",
          logicalName: "plan",
          kind: "plan",
          mediaType: KIND_MEDIA_TYPES.plan,
          body,
          projectId: live.id,
        });
      }
      this.bindPlanApprovalDigest(id);
      this.persist();
      return {
        status: 200,
        body: this.projectDto(started.project),
        revision: started.project.stateRevision,
      };
    });
  }

  confirmPlan(
    ctx: CommandContext,
    id: string,
    input: ConfirmPlanInput,
  ): Promise<CommandResult<ProjectDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      if (
        project.planArtifactVersionId &&
        project.planArtifactVersionId !== input.planArtifactVersionId
      ) {
        throw new AppError("conflict", "planArtifactVersionId does not match the current plan");
      }
      const approval = this.planApprovalFor(project.id);
      if (!approval) {
        throw new AppError("not_found", "Plan approval not found");
      }
      const action = this.planCanonicalAction(approval);
      this.policy.assertDigestMatch(approval.actionDigest, action.digest);
      if (approval.status === "pending") {
        await this.policy.consumeGrant({
          action,
          gate: "plan",
          ...(approval.expiresAt !== undefined ? { expiresAt: approval.expiresAt } : {}),
        });
      }
      const confirmed = await this.app.confirmPlan({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId: project.id,
        approvalId: approval.id,
        graph: mockPlanGraph(),
        ...optionalRevision(ctx.ifMatch),
      });
      this.persist();
      return {
        status: 200,
        body: this.projectDto(confirmed.project),
        revision: confirmed.project.stateRevision,
      };
    });
  }

  startProject(
    ctx: CommandContext,
    id: string,
    input: StartProjectInput,
  ): Promise<CommandResult<ProjectDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      const orchestrationMode = input.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
      assertStartOrchestrationAllowed(orchestrationMode, this.capabilities());
      await this.policy.assertStartAllowed({
        runtime: project.runtimeId ?? MOCK_RUNTIME_ID,
        resource: `project:${project.id}`,
        ...(input.budgetHardLimitMinor !== undefined
          ? { budgetHardLimitMinor: input.budgetHardLimitMinor }
          : {}),
      });
      if (project.workflowVersionId) {
        const catalogVersion = this.authoring.catalog.findWorkflowVersion(
          project.workflowVersionId,
        );
        if (catalogVersion) {
          this.authoring.assertExecutableWorkflowVersion(
            catalogVersion.workflowId,
            catalogVersion.id,
          );
        }
      }
      const started = await this.app.start({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId: project.id,
        orchestrationMode,
        ...optionalRevision(ctx.ifMatch),
      });
      await this.dispatchReadyTasks(project.id);
      this.persist();
      return {
        status: 200,
        body: this.projectDto(started.project),
        revision: started.project.stateRevision,
      };
    });
  }

  cancelProject(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): Promise<CommandResult<CommandAcceptedDto | ProjectDto>> {
    void input;
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      const cancelled = await this.app.cancelProject({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId: project.id,
        ...optionalRevision(ctx.ifMatch),
      });
      this.persist();
      if (cancelled.cancelRequestedAt && cancelled.status !== "cancelled") {
        return {
          status: 202,
          body: {
            operationId: ctx.operationId,
            acceptedAt: cancelled.cancelRequestedAt,
            resource: { type: "project", id },
          },
          revision: this.requireProject(id).stateRevision,
        };
      }
      return {
        status: 200,
        body: this.projectDto(this.requireProject(id)),
        revision: this.requireProject(id).stateRevision,
      };
    });
  }

  exportProject(ctx: CommandContext, id: string): Promise<CommandResult<ExportBundleDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(id);
      this.assertMatch(project.stateRevision, ctx.ifMatch);
      const approved = [...this.app.world.approvals.values()].find(
        (approval) =>
          approval.projectId === id &&
          approval.gate === "artifact" &&
          (approval.status === "consumed" || approval.status === "approved"),
      );
      if (!approved) {
        throw new AppError("invalid_transition", "Export requires a consumed artifact approval");
      }
      const integrated = this.integrations.latest(id);
      const digest =
        (integrated?.outcome.status === "integrated"
          ? integrated.outcome.contentDigest
          : undefined) ?? approved.actionDigest;
      const report = {
        projectId: project.id,
        projectStatus: project.status,
        ...(integrated?.outcome.status === "integrated"
          ? { integratedDigest: integrated.outcome.contentDigest }
          : {}),
        approvedDigest: approved.actionDigest,
        artifacts: [...this.artifactContents.values()]
          .filter((item) => item.projectId === id)
          .map((item) => ({
            versionId: item.versionId,
            hash: item.hash,
            ...(item.slotId ? { slotId: item.slotId } : {}),
          })),
      };
      const body = encoder.encode(
        `${JSON.stringify({ verdict: "exported", summary: digest, digest, ...report }, null, 2)}\n`,
      );
      const record = await this.commitArtifact({
        slotId: "report",
        logicalName: "report",
        kind: "evaluation",
        mediaType: KIND_MEDIA_TYPES.evaluation,
        body,
        projectId: id,
        parents: approved.artifactVersionId ? [approved.artifactVersionId] : [],
      });
      this.persist();
      return {
        status: 200,
        body: {
          projectId: id,
          digest: record.hash,
          artifactVersionId: record.versionId,
          status: "exported",
          report,
        },
        revision: project.stateRevision,
      };
    });
  }

  listTasks(query: ListQuery): PageDto<TaskDto> {
    return paginate(
      this.filter(
        [...this.app.world.tasks.values()].map((record) => this.taskDto(record)),
        query,
        { projectId: (dto) => dto.projectId },
      ),
      query.cursor,
      query.limit,
    );
  }

  getTask(id: string): TaskDto | null {
    const task = this.app.world.tasks.get(id);
    return task ? this.taskDto(task) : null;
  }

  retryTask(
    ctx: CommandContext,
    id: string,
  ): Promise<CommandResult<{ task: TaskDto; run: RunDto }>> {
    return this.exclusive(async () => {
      const task = this.requireTask(id);
      this.assertMatch(task.stateRevision, ctx.ifMatch);
      await this.app.retryTask({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        taskId: id,
      });
      const live = this.requireTask(id);
      if (live.status === "ready") {
        const retryProject = this.requireProject(live.projectId);
        await this.assertRuntimeStartAllowed(retryProject);
        await this.app.startRun({
          operationId: runOperationId(live),
          idempotencyKey: runOperationId(live),
          taskId: live.id,
          snapshotRef: "mock:success",
          ...(retryProject.orchestrationMode !== undefined
            ? { orchestrationMode: retryProject.orchestrationMode }
            : {}),
        });
      }
      const run = this.app.world.activeRunForTask(id) ?? latestRun(this.app.world.runs, id);
      if (!run) {
        throw new AppError("conflict", "Retry did not produce a run");
      }
      this.persist();
      return {
        status: 200,
        body: { task: this.taskDto(this.requireTask(id)), run: this.runDto(run) },
        revision: this.requireTask(id).stateRevision,
      };
    });
  }

  cancelTask(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): Promise<CommandResult<CommandAcceptedDto | TaskDto>> {
    void input;
    return this.exclusive(async () => {
      const task = this.requireTask(id);
      this.assertMatch(task.stateRevision, ctx.ifMatch);
      const result = await this.app.cancelTask({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        taskId: id,
      });
      this.persist();
      if (result.status === "running" || this.app.world.activeRunForTask(id)) {
        return {
          status: 202,
          body: {
            operationId: ctx.operationId,
            acceptedAt: this.app.world.nowIso(),
            resource: { type: "task", id },
          },
          revision: this.requireTask(id).stateRevision,
        };
      }
      return {
        status: 200,
        body: this.taskDto(this.requireTask(id)),
        revision: this.requireTask(id).stateRevision,
      };
    });
  }

  listRuns(query: ListQuery): PageDto<RunDto> {
    return paginate(
      this.filter(
        [...this.app.world.runs.values()].map((record) => this.runDto(record)),
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
    const run = this.app.world.runs.get(id);
    return run ? this.runDto(run) : null;
  }

  cancelRun(
    ctx: CommandContext,
    id: string,
    input: CancelInput,
  ): Promise<CommandResult<CommandAcceptedDto>> {
    void input;
    return this.exclusive(async () => {
      const run = this.requireRun(id);
      this.assertMatch(run.stateRevision, ctx.ifMatch);
      const cancelled = await this.app.cancelRun({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        runId: id,
      });
      await this.persistDurably();
      return {
        status: 202,
        body: {
          operationId: ctx.operationId,
          acceptedAt: cancelled.cancelRequestedAt,
          resource: { type: "run", id },
        },
        revision: this.requireRun(id).stateRevision,
      };
    });
  }

  pauseRun(_ctx: CommandContext, id: string): Promise<CommandResult<CommandAcceptedDto | RunDto>> {
    return this.exclusive(async () => {
      const run = this.requireRun(id);
      const project = this.requireProject(run.projectId);
      await this.policy.assertPauseAllowed(project.runtimeId ?? MOCK_RUNTIME_ID);
      await this.app.pauseRun(id);
      throw new AppError("unsupported_capability", "lifecycle.pause is unsupported");
    });
  }

  sendRunInput(
    ctx: CommandContext,
    id: string,
    input: RunInputBody,
  ): Promise<CommandResult<RunDto>> {
    return this.exclusive(async () => {
      const run = this.requireRun(id);
      this.assertMatch(run.stateRevision, ctx.ifMatch);
      if (run.handleId) {
        await this.host.sendInput(run.handleId, {
          operationId: ctx.operationId,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        });
      }
      if (run.status === "waiting_input") {
        run.status = this.app.ctx.engine.nextRunStatus(run.status, "input");
        run.stateRevision += 1;
        run.updatedAt = this.app.world.nowIso();
      }
      this.persist();
      return { status: 200, body: this.runDto(run), revision: run.stateRevision };
    });
  }

  listRunEvents(runId: string, query: EventListQuery): PageDto<WorkforceEvent> {
    this.requireRun(runId);
    return this.listEvents({ ...query, runId, stream: `run:${runId}` });
  }

  listApprovals(query: ListQuery): PageDto<ApprovalDto> {
    return paginate(
      this.filter(
        [...this.app.world.approvals.values()].map((record) => this.approvalDto(record)),
        query,
        { projectId: (dto) => dto.projectId },
      ),
      query.cursor,
      query.limit,
    );
  }

  getApproval(id: string): ApprovalDto | null {
    const approval = this.app.world.approvals.get(id);
    return approval ? this.approvalDto(approval) : null;
  }

  approve(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): Promise<CommandResult<ApprovalDto>> {
    return this.decide(ctx, id, input, "approve");
  }

  reject(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): Promise<CommandResult<ApprovalDto>> {
    return this.decide(ctx, id, input, "reject");
  }

  requestChanges(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
  ): Promise<CommandResult<ApprovalDto>> {
    return this.decide(ctx, id, input, "request-changes");
  }

  listArtifacts(query: ListQuery): PageDto<ArtifactDto> {
    return paginate(
      this.filter(this.artifactDtos(), query, { projectId: (dto) => dto.projectId }),
      query.cursor,
      query.limit,
    );
  }

  getArtifact(id: string): ArtifactDto | null {
    return this.artifactDtos().find((dto) => dto.id === id) ?? null;
  }

  getArtifactVersion(id: string, versionId: string): ArtifactVersionDto | null {
    const record = this.findContent(id, versionId);
    return record ? toVersionDto(record) : null;
  }

  readArtifactContent(id: string, versionId: string): ArtifactContentDto | null {
    const record = this.findContent(id, versionId);
    if (!record?.body) {
      return null;
    }
    return {
      mediaType: record.mediaType,
      body: record.body,
    };
  }

  getArtifactLineage(id: string, versionId: string): ArtifactLineageDto | null {
    const record = this.findContent(id, versionId);
    if (!record) {
      return null;
    }
    return {
      artifactVersionId: record.versionId,
      parents: [...record.parents],
      children: [...record.children],
    };
  }

  listEvents(query: EventListQuery): PageDto<WorkforceEvent> {
    const matched = this.app.world.events.events.filter((event) => {
      if ((event.ingestionPosition ?? 0) <= query.afterIngestionPosition) {
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
    return {
      items: slice,
      page: {
        nextCursor: slice.length < matched.length && last?.id !== undefined ? last.id : null,
        hasMore: slice.length < matched.length,
      },
    };
  }

  highWaterMark(): number {
    const last = this.app.world.events.events[this.app.world.events.events.length - 1];
    return last?.ingestionPosition ?? 0;
  }

  trimHorizon(): number {
    return 0;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.host.dispose();
    } finally {
      await this.worktrees.dispose();
      this.persist();
      await this.sqliteWrite.catch(() => undefined);
      this.sqlite.close();
    }
  }

  private async handleTerminal(event: RunTerminalEvent): Promise<void> {
    if (this.closed) {
      return;
    }
    await this.exclusive(async () => {
      const run = [...this.app.world.runs.values()].find(
        (item) => item.handleId === event.handleId,
      );
      if (!run) {
        return;
      }
      if (
        run.status === "succeeded" ||
        run.status === "failed" ||
        run.status === "cancelled" ||
        run.status === "timed_out"
      ) {
        return;
      }
      if (event.status === "succeeded") {
        this.app.recordRunSucceeded(run.id);
        await this.bindRequiredOutputs(run);
        await this.maybeIntegrate(run.projectId);
        await this.maybeCreateArtifactApproval(run.projectId);
        await this.dispatchReadyTasks(run.projectId);
      } else if (event.status === "failed") {
        this.app.recordRunFailed(run.id);
      } else if (event.status === "cancelled") {
        settleRunCancel(this.app.ctx, run.id);
      }
      this.persist();
    });
  }

  private async dispatchReadyTasks(projectId: string): Promise<void> {
    const tasks = this.app.world.tasksForProject(projectId);
    for (const task of tasks) {
      if (task.status !== "ready") {
        continue;
      }
      if (hasAttemptRun(this.app.world.runs, task)) {
        continue;
      }
      const liveProject = this.requireProject(projectId);
      await this.assertRuntimeStartAllowed(liveProject);
      await this.app.startRun({
        operationId: runOperationId(task),
        idempotencyKey: runOperationId(task),
        taskId: task.id,
        snapshotRef: "mock:success",
        ...(liveProject.orchestrationMode !== undefined
          ? { orchestrationMode: liveProject.orchestrationMode }
          : {}),
      });
    }
  }

  private async bindRequiredOutputs(run: RunRecord): Promise<void> {
    const task = this.app.world.tasks.get(run.taskId);
    if (!task) {
      return;
    }
    for (const output of task.expectedOutputs.filter((item) => item.required)) {
      if (task.outputBindings[output.id]) {
        continue;
      }
      const created = await this.createOutputArtifact(task, run, output.id);
      this.app.bindTaskOutput({
        taskId: task.id,
        slotId: output.id,
        artifactVersionId: created.versionId,
        digest: created.hash,
      });
    }
  }

  private async createOutputArtifact(
    task: TaskRecord,
    run: RunRecord,
    slotId: string,
  ): Promise<ArtifactContentRecord> {
    const nodeId = task.workflowNodeId ?? task.title;
    const produced = await this.produceOutput(task, run, slotId, nodeId);
    return this.commitArtifact({
      slotId,
      logicalName: slotId,
      kind: produced.kind,
      mediaType: produced.mediaType,
      body: produced.body,
      projectId: task.projectId,
      taskId: task.id,
      runId: run.id,
      ...(produced.metadata ? { metadata: produced.metadata } : {}),
    });
  }

  private async maybeIntegrate(projectId: string): Promise<void> {
    if (this.integrations.latest(projectId)?.outcome.status === "integrated") {
      return;
    }
    const developers = this.app.world
      .tasksForProject(projectId)
      .filter((task) => task.role === "developer");
    if (developers.length === 0) {
      return;
    }
    const contributions = [];
    for (const task of developers) {
      const slot = task.expectedOutputs.find((output) => isGitDiffSlot(output.id));
      const versionId = slot ? task.outputBindings[slot.id] : undefined;
      const content = versionId ? this.findContent(undefined, versionId) : undefined;
      if (!slot || !versionId || !content?.body) {
        return;
      }
      contributions.push({
        nodeId: task.workflowNodeId ?? task.id,
        runId:
          [...this.app.world.runs.values()].find((run) => run.taskId === task.id)?.id ?? task.id,
        artifactVersionId: versionId,
        patch: new TextDecoder().decode(content.body),
        changedPaths: [],
        baseSha: this.worktrees.baseSha,
      });
    }
    const project = this.requireProject(projectId);
    await this.workspaceFor(project);
    const { gitWorkspaceId } = await this.worktrees.bindProject(projectId);
    const review = this.app.world
      .tasksForProject(projectId)
      .find((task) => task.role === "reviewer");
    const result = await integratePatches(
      {
        operationId: `op_integrate_${projectId}`,
        projectId,
        workspaceId: gitWorkspaceId,
        integrationTaskId: review?.id ?? `integrate_${projectId}`,
        baseSha: this.worktrees.baseSha,
        workflowVersionId: project.workflowVersionId ?? "wfv_software",
        contributions,
      },
      { workspace: this.worktrees.git, store: this.integrations },
      { bindToNodeIds: ["review_integration", "approve_delivery"] },
    );
    if (!result.ok || result.outcome.status !== "integrated") {
      return;
    }
    const patchBody = encoder.encode(
      result.outcome.patch.endsWith("\n") ? result.outcome.patch : `${result.outcome.patch}\n`,
    );
    const record = await this.commitArtifact({
      slotId: "integrated",
      logicalName: "integrated",
      kind: "git_diff",
      mediaType: KIND_MEDIA_TYPES.git_diff,
      body: patchBody,
      projectId,
      parents: contributions.map((item) => item.artifactVersionId),
      metadata: {
        type: "git_diff",
        baseSha: this.worktrees.baseSha,
        baseRef: "immutable-base",
      },
    });
    this.app.world.artifacts.set(record.versionId, {
      artifactVersionId: record.versionId,
      projectId,
      slotId: "integrated",
      digest: record.hash,
      status: "available",
    });
  }

  private async maybeCreateArtifactApproval(projectId: string): Promise<void> {
    const reviewers = this.app.world
      .tasksForProject(projectId)
      .filter((task) => task.role === "reviewer" && task.status === "waiting_review");
    for (const review of reviewers) {
      const existing = [...this.app.world.approvals.values()].some(
        (approval) =>
          approval.projectId === projectId &&
          approval.gate === "artifact" &&
          approval.taskId === review.id &&
          (approval.status === "pending" ||
            approval.status === "approved" ||
            approval.status === "consumed"),
      );
      if (existing) {
        continue;
      }
      const versionId =
        Object.values(review.outputBindings)[0] ?? review.inputArtifactVersionIds[0];
      if (!versionId) {
        continue;
      }
      const content = this.findContent(undefined, versionId);
      const action = this.policy.artifactPublishAction({
        resource: `artifactVersion:${versionId}`,
        version: versionId,
        hash: content?.hash ?? versionId,
        ...(content?.slotId !== undefined ? { slotId: content.slotId } : {}),
      });
      await this.app.createApproval({
        projectId,
        gate: "artifact",
        actionDigest: action.digest,
        resource: action.resource,
        artifactVersionId: versionId,
        taskId: review.id,
      });
    }
  }

  private decide(
    ctx: CommandContext,
    id: string,
    input: ApprovalDecisionInput,
    decision: "approve" | "reject" | "request-changes",
  ): Promise<CommandResult<ApprovalDto>> {
    return this.exclusive(async () => {
      const approval = this.app.world.approvals.get(id);
      if (!approval) {
        throw new AppError("not_found", `Approval ${id} not found`);
      }
      this.assertMatch(approval.stateRevision, ctx.ifMatch);
      const action = this.canonicalActionFor(approval);
      if (input.digest !== undefined) {
        this.policy.assertDigestMatch(input.digest, action.digest);
      }
      this.policy.assertDigestMatch(approval.actionDigest, action.digest);
      if (
        input.artifactVersionId !== undefined &&
        approval.artifactVersionId !== undefined &&
        input.artifactVersionId !== approval.artifactVersionId
      ) {
        throw new AppError("conflict", "Approval artifact version does not match");
      }
      if (decision === "approve" && approval.status === "pending") {
        await this.policy.consumeGrant({
          action,
          gate: approval.gate,
          ...(approval.expiresAt !== undefined ? { expiresAt: approval.expiresAt } : {}),
        });
      }
      const decided = await this.app.decideApproval({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        approvalId: id,
        decision,
        actionDigest: input.digest ?? approval.actionDigest,
        ...optionalRevision(ctx.ifMatch),
      });
      this.decisionReasons.set(id, input.decisionReason);
      this.persist();
      return {
        status: 200,
        body: this.approvalDto(decided.approval),
        revision: decided.approval.stateRevision,
      };
    });
  }

  private async produceOutput(
    task: TaskRecord,
    _run: RunRecord,
    slotId: string,
    nodeId: string,
  ): Promise<{
    mediaType: string;
    kind: RegistrableKind;
    body: Uint8Array;
    metadata?: Record<string, unknown>;
  }> {
    void _run;
    if (isGitDiffSlot(slotId)) {
      const provisioned = this.worktrees.getForTask(task.id, task.attempt);
      if (!provisioned) {
        throw new Error(
          `missing isolated worktree for ${task.workflowNodeId ?? task.id} attempt ${task.attempt}`,
        );
      }
      const captured = await captureMockPatch({
        git: this.worktrees.git,
        instanceId: provisioned.workspaceInstanceId,
        worktreePath: provisioned.worktreePath,
        nodeId: provisioned.nodeId,
      });
      return gitDiffArtifactFromCapture(captured, provisioned.nodeId);
    }
    return syntheticOutput(slotId, nodeId);
  }

  private async workspaceFor(project: ProjectRecord): Promise<WorkspaceDto> {
    if (project.workspaceId) {
      const existing = this.workspaces.get(project.workspaceId);
      if (existing) {
        await this.worktrees.bindProject(project.id);
        return existing;
      }
    }
    const bound = [...this.workspaces.values()].find((item) => item.projectId === project.id);
    if (bound) {
      project.workspaceId = bound.id;
      await this.worktrees.bindProject(project.id);
      return bound;
    }
    const workspace: WorkspaceDto = {
      id: this.app.world.ids.ulid("wsp_"),
      projectId: project.id,
      status: "bound",
      kind: "local",
      authorizationRef: "local-temp",
      createdAt: this.app.world.nowIso(),
    };
    this.workspaces.set(workspace.id, workspace);
    project.workspaceId = workspace.id;
    await this.worktrees.bindProject(project.id);
    return workspace;
  }

  private planApprovalFor(projectId: string): ApprovalRecord | undefined {
    return [...this.app.world.approvals.values()].find(
      (approval) => approval.projectId === projectId && approval.gate === "plan",
    );
  }

  private bindPlanApprovalDigest(projectId: string): void {
    const approval = this.planApprovalFor(projectId);
    if (!approval) {
      return;
    }
    approval.actionDigest = this.planCanonicalAction(approval).digest;
  }

  private planCanonicalAction(approval: ApprovalRecord): CanonicalAction {
    return this.policy.planApplyAction({
      resource: approval.resource,
      plan: this.planDocumentFor(approval),
      ...(approval.artifactVersionId !== undefined ? { version: approval.artifactVersionId } : {}),
    });
  }

  private planDocumentFor(approval: ApprovalRecord): unknown {
    const content = approval.artifactVersionId
      ? this.findContent(undefined, approval.artifactVersionId)
      : undefined;
    if (content?.body) {
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(content.body));
        if (isCanonicalMockPlan(parsed)) {
          return MOCK_PLAN_DOCUMENT;
        }
        return parsed;
      } catch {
        return { hash: content.hash };
      }
    }
    return MOCK_PLAN_DOCUMENT;
  }

  private canonicalActionFor(approval: ApprovalRecord): CanonicalAction {
    if (approval.gate === "plan") {
      return this.planCanonicalAction(approval);
    }
    const versionId =
      approval.artifactVersionId ?? approval.resource.replace(/^artifactVersion:/u, "");
    const content = this.findContent(undefined, versionId);
    return this.policy.artifactPublishAction({
      resource: approval.resource,
      version: versionId,
      hash: content?.hash ?? versionId,
      ...(content?.slotId !== undefined ? { slotId: content.slotId } : {}),
    });
  }

  private async assertRuntimeStartAllowed(project: ProjectRecord): Promise<void> {
    await this.policy.assertStartAllowed({
      runtime: project.runtimeId ?? MOCK_RUNTIME_ID,
      resource: `runtime:${project.runtimeId ?? MOCK_RUNTIME_ID}`,
    });
  }

  private async persistCatalogWorkflow(id: string): Promise<void> {
    const workflow = this.authoring.catalog.workflows.get(id);
    if (!workflow) {
      return;
    }
    await this.sqlite.uow.withTransaction(async (tx) => {
      this.sqlite.catalogWorkflows.upsert(tx, workflow);
      for (const version of this.authoring.catalog.listWorkflowVersions(id)) {
        this.sqlite.catalogWorkflows.upsertVersion(tx, version);
      }
    });
  }

  private async persistCatalogTeam(id: string): Promise<void> {
    const team = this.authoring.catalog.teams.get(id);
    if (!team) {
      return;
    }
    await this.sqlite.uow.withTransaction(async (tx) => {
      this.sqlite.catalogTeams.upsert(tx, team);
      for (const version of this.authoring.catalog.listTeamVersions(id)) {
        this.sqlite.catalogTeams.upsertVersion(tx, version);
      }
    });
  }

  private persist(): void {
    if (this.closed) {
      try {
        void this.writeSnapshot().catch(() => undefined);
      } catch {
        return;
      }
      return;
    }
    void this.writeSnapshot().catch(() => undefined);
  }

  private persistDurably(): Promise<void> {
    return this.writeSnapshot();
  }

  private writeSnapshot(): Promise<void> {
    const world = dumpWorld({
      world: this.app.world,
      operations: [...this.operations.values()],
      artifactContents: [...this.artifactContents.values()],
      workspaces: [...this.workspaces.values()],
    });
    const host = this.hostStore.dump();
    persistSnapshot(this.stateDir, { world, host });
    const committed = this.sqliteWrite.then(() =>
      this.sqliteWriter(this.sqlite, world, this.synced, host.handles),
    );
    this.sqliteWrite = committed.catch(() => undefined);
    return committed;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(
      () => this.guard(fn),
      () => this.guard(fn),
    );
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw wrapError(error);
    }
  }

  private putContent(record: ArtifactContentRecord): void {
    this.artifactContents.set(record.versionId, record);
    if (record.aliasVersionId !== undefined && record.aliasVersionId !== record.versionId) {
      this.artifactContents.set(record.aliasVersionId, record);
    }
  }

  private findContent(
    artifactId: string | undefined,
    versionId: string,
  ): ArtifactContentRecord | undefined {
    const direct = this.artifactContents.get(versionId);
    if (
      direct &&
      (artifactId === undefined ||
        direct.artifactId === artifactId ||
        direct.versionId === artifactId)
    ) {
      return direct;
    }
    return [...this.artifactContents.values()].find((item) => {
      const versionMatch = item.versionId === versionId || item.aliasVersionId === versionId;
      if (versionMatch) {
        return (
          artifactId === undefined ||
          item.artifactId === artifactId ||
          item.versionId === artifactId
        );
      }
      return (
        artifactId !== undefined && item.artifactId === artifactId && item.versionId === versionId
      );
    });
  }

  private async restoreArtifactAuthority(): Promise<void> {
    const leftover = [...this.artifactContents.values()];
    this.artifactContents.clear();
    for (const stored of await this.artifacts.listAvailable()) {
      const body = await collectBytes(this.artifacts.read(stored.artifactVersionId));
      const lineage = await this.artifacts.lineageOf(stored.artifactVersionId);
      this.putContent(
        this.recordFromStored(
          stored,
          storedRecordExtras(
            projectIdFromStored(stored, leftover, this.app.world.tasks),
            logicalNameFromStored(stored),
            lineage.map((source) => source.artifactVersionId),
            body,
            aliasFromStored(stored),
          ),
        ),
      );
    }
    for (const record of leftover) {
      if (this.findContent(record.artifactId, record.versionId)) {
        continue;
      }
      const body =
        record.body ?? (record.bodyBase64 ? Buffer.from(record.bodyBase64, "base64") : undefined);
      if (!body) {
        continue;
      }
      const kind = asRegistrableKind(
        record.kind,
        record.slotId ?? record.logicalName,
        record.mediaType,
      );
      try {
        await this.commitArtifact({
          artifactId: record.artifactId,
          aliasVersionId: record.aliasVersionId ?? record.versionId,
          slotId: record.slotId ?? record.logicalName,
          logicalName: record.logicalName,
          kind,
          mediaType: mediaTypeForKind(kind, record.mediaType),
          body,
          projectId: record.projectId,
          ...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
          parents: record.parents,
        });
      } catch {
        // Sidecar leftovers that fail kind verify stay non-authoritative.
      }
    }
  }

  private async commitArtifact(input: {
    slotId: string;
    logicalName: string;
    kind: RegistrableKind;
    mediaType: string;
    body: Uint8Array;
    projectId: string;
    taskId?: string;
    runId?: string;
    artifactId?: string;
    aliasVersionId?: string;
    parents?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<ArtifactContentRecord> {
    const sources: LineageSource[] = (input.parents ?? []).map((artifactVersionId) => ({
      artifactVersionId,
      relation: "combined_from",
    }));
    const stored = await this.artifacts.register({
      slotId: input.slotId,
      mediaType: input.mediaType,
      kind: input.kind,
      body: input.body,
      name: input.logicalName,
      metadata: {
        ...input.metadata,
        projectId: input.projectId,
        logicalName: input.logicalName,
        ...(input.aliasVersionId !== undefined ? { aliasVersionId: input.aliasVersionId } : {}),
      },
      ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(sources.length > 0 ? { sources } : {}),
    });
    const record = this.recordFromStored(
      stored,
      storedRecordExtras(
        input.projectId,
        input.logicalName,
        input.parents ?? [],
        input.body,
        input.aliasVersionId,
      ),
    );
    this.putContent(record);
    return record;
  }

  private recordFromStored(
    stored: StoredArtifactVersion,
    extras: {
      projectId: string;
      logicalName: string;
      parents: string[];
      aliasVersionId?: string;
      body: Uint8Array;
    },
  ): ArtifactContentRecord {
    const record: ArtifactContentRecord = {
      artifactId: stored.artifactId,
      versionId: stored.artifactVersionId,
      logicalName: extras.logicalName,
      kind: stored.kind,
      mediaType: stored.mediaType,
      hash: stored.hash,
      size: stored.size,
      createdAt: stored.createdAt,
      projectId: extras.projectId,
      parents: [...extras.parents],
      children: [],
      body: extras.body,
    };
    if (stored.taskId !== undefined) record.taskId = stored.taskId;
    if (stored.slotId !== undefined) record.slotId = stored.slotId;
    if (extras.aliasVersionId !== undefined) record.aliasVersionId = extras.aliasVersionId;
    return record;
  }

  private projectDto(project: ProjectRecord): ProjectDto {
    const dto: ProjectDto = {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      objective: project.objective,
      status: project.status,
      stateRevision: project.stateRevision,
      protocolVersion: PROTOCOL_VERSION,
      cancelRequested: Boolean(project.cancelRequestedAt),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    if (project.planArtifactVersionId !== undefined) {
      dto.planArtifactVersionId = project.planArtifactVersionId;
    }
    if (project.teamVersionId !== undefined) {
      dto.teamVersionId = project.teamVersionId;
    }
    if (project.orchestrationMode !== undefined) {
      dto.orchestrationMode = project.orchestrationMode;
    }
    return dto;
  }

  private taskDto(task: TaskRecord): TaskDto {
    const project = this.app.world.projects.get(task.projectId);
    const dto: TaskDto = {
      id: task.id,
      projectId: task.projectId,
      title: task.workflowNodeId ?? task.title,
      objective: project?.objective ?? task.title,
      status: task.status,
      stateRevision: task.stateRevision,
      definitionRevision: task.definitionRevision,
      generation: task.generation,
      attempt: task.attempt,
      protocolVersion: PROTOCOL_VERSION,
      cancelRequested: false,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      role: task.role,
      dependsOn: mapPublishedTaskDependsOn(task),
    };
    if (task.workflowNodeId !== undefined) {
      dto.workflowNodeId = task.workflowNodeId;
    }
    return dto;
  }

  private runDto(run: RunRecord): RunDto {
    const dto: RunDto = {
      id: run.id,
      taskId: run.taskId,
      projectId: run.projectId,
      status: run.status,
      stateRevision: run.stateRevision,
      definitionRevision: run.definitionRevision,
      generation: run.generation,
      attempt: run.attempt,
      protocolVersion: PROTOCOL_VERSION,
      cancelRequested: Boolean(run.cancelRequestedAt),
      usage: { costMinor: 0, currency: "USD", kind: "unknown" },
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
    if (run.orchestrationMode !== undefined) {
      dto.orchestrationMode = run.orchestrationMode;
    }
    return dto;
  }

  private approvalDto(approval: ApprovalRecord): ApprovalDto {
    const dto: ApprovalDto = {
      id: approval.id,
      projectId: approval.projectId,
      gate: approval.gate,
      status: approval.status,
      stateRevision: approval.stateRevision,
      actionDigest: approval.actionDigest,
      resource: approval.resource,
      requestedAt: approval.createdAt,
    };
    if (approval.taskId !== undefined) {
      dto.taskId = approval.taskId;
    }
    if (approval.artifactVersionId !== undefined) {
      dto.artifactVersionId = approval.artifactVersionId;
    }
    const reason = this.decisionReasons.get(approval.id);
    if (reason !== undefined) {
      dto.decisionReason = reason;
    }
    return dto;
  }

  private artifactDtos(): ArtifactDto[] {
    const grouped = new Map<string, ArtifactDto>();
    for (const record of this.artifactContents.values()) {
      const summary: ArtifactVersionSummaryDto = {
        id: record.versionId,
        version: 1,
        status: "available",
        hash: record.hash,
        size: record.size,
        createdAt: record.createdAt,
      };
      const existing = grouped.get(record.artifactId);
      if (existing) {
        existing.versions.push(summary);
        continue;
      }
      grouped.set(record.artifactId, {
        id: record.artifactId,
        projectId: record.projectId,
        logicalName: record.logicalName,
        kind: record.kind,
        createdAt: record.createdAt,
        versions: [summary],
      });
    }
    return [...grouped.values()];
  }

  private filter<D extends { id: string; status?: string }>(
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
    const project = this.app.world.projects.get(id);
    if (!project) {
      throw new AppError("not_found", `Project ${id} not found`);
    }
    return project;
  }

  private requireTask(id: string): TaskRecord {
    const task = this.app.world.tasks.get(id);
    if (!task) {
      throw new AppError("not_found", `Task ${id} not found`);
    }
    return task;
  }

  private requireRun(id: string): RunRecord {
    const run = this.app.world.runs.get(id);
    if (!run) {
      throw new AppError("not_found", `Run ${id} not found`);
    }
    return run;
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
}

export async function createComposedAppServices(
  options: ComposedAppServicesOptions,
): Promise<ComposedAppServices> {
  return ComposedAppServices.open(options);
}

/** Internal test seam; intentionally not re-exported from composition/index.ts or the package root. */
export async function createComposedAppServicesForTest(
  options: ComposedAppServicesOptions,
  sqliteWriter: SqliteWriter,
): Promise<ComposedAppServices> {
  const internalOptions: InternalComposedAppServicesOptions = {
    ...options,
    [sqliteWriterOption]: sqliteWriter,
  };
  return ComposedAppServices.open(internalOptions);
}

function hydrateCatalog(sqlite: WorkforceSqlite, authoring: CatalogService): void {
  for (const workflow of sqlite.catalogWorkflows.listAll()) {
    authoring.catalog.workflows.set(workflow.id, workflow);
  }
  for (const version of sqlite.catalogWorkflows.listVersions()) {
    authoring.catalog.workflowVersions.set(version.id, version);
  }
  for (const team of sqlite.catalogTeams.listAll()) {
    authoring.catalog.teams.set(team.id, team);
  }
  for (const version of sqlite.catalogTeams.listVersions()) {
    authoring.catalog.teamVersions.set(version.id, version);
  }
}

function optionalRevision(expectedStateRevision: number | undefined): {
  expectedStateRevision?: number;
} {
  return expectedStateRevision === undefined ? {} : { expectedStateRevision };
}

function runOperationId(task: TaskRecord): string {
  return `op_run:${task.id}:d${task.definitionRevision}:g${task.generation}:a${task.attempt}`;
}

function hasAttemptRun(runs: Map<string, RunRecord>, task: TaskRecord): boolean {
  return [...runs.values()].some(
    (run) =>
      run.taskId === task.id &&
      run.attempt === task.attempt &&
      run.generation === task.generation &&
      run.definitionRevision === task.definitionRevision,
  );
}

function latestRun(runs: Map<string, RunRecord>, taskId: string): RunRecord | undefined {
  return [...runs.values()].filter((run) => run.taskId === taskId).at(-1);
}

function isTerminalRun(run: RunRecord): boolean {
  return (
    run.status === "succeeded" ||
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "timed_out"
  );
}

function publicAuthorizationRef(value: string): string {
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
    return `ref_${sha256Hex(value).slice(0, 16)}`;
  }
  return value;
}

function storedRecordExtras(
  projectId: string,
  logicalName: string,
  parents: string[],
  body: Uint8Array,
  aliasVersionId?: string,
): {
  projectId: string;
  logicalName: string;
  parents: string[];
  body: Uint8Array;
  aliasVersionId?: string;
} {
  const extras: {
    projectId: string;
    logicalName: string;
    parents: string[];
    body: Uint8Array;
    aliasVersionId?: string;
  } = { projectId, logicalName, parents, body };
  if (aliasVersionId !== undefined) {
    extras.aliasVersionId = aliasVersionId;
  }
  return extras;
}

function projectIdFromStored(
  stored: StoredArtifactVersion,
  leftover: ArtifactContentRecord[],
  tasks: Map<string, TaskRecord>,
): string {
  const meta = stored.metadata?.projectId;
  if (typeof meta === "string" && meta.length > 0) {
    return meta;
  }
  if (stored.taskId !== undefined) {
    const task = tasks.get(stored.taskId);
    if (task) {
      return task.projectId;
    }
  }
  const match = leftover.find(
    (item) => item.versionId === stored.artifactVersionId || item.artifactId === stored.artifactId,
  );
  return match?.projectId ?? "";
}

function logicalNameFromStored(stored: StoredArtifactVersion): string {
  const meta = stored.metadata?.logicalName;
  if (typeof meta === "string" && meta.length > 0) {
    return meta;
  }
  return stored.name ?? stored.slotId;
}

function aliasFromStored(stored: StoredArtifactVersion): string | undefined {
  const alias = stored.metadata?.aliasVersionId;
  return typeof alias === "string" && alias.length > 0 ? alias : undefined;
}

function asRegistrableKind(kind: string, slotId: string, mediaType: string): RegistrableKind {
  if (kind === "plan" || kind === "git_diff" || kind === "test_result" || kind === "evaluation") {
    return kind;
  }
  const slot = slotId.toLowerCase();
  if (slot.includes("plan") || kind === "document") {
    return "plan";
  }
  if (
    slot.includes("diff") ||
    slot.includes("code") ||
    slot.includes("patch") ||
    slot.includes("change")
  ) {
    return "git_diff";
  }
  if (slot.includes("test") || mediaType.includes("test-result")) {
    return "test_result";
  }
  return "evaluation";
}

function mediaTypeForKind(kind: RegistrableKind, fallback: string): string {
  return KIND_MEDIA_TYPES[kind] ?? fallback;
}

function isCanonicalMockPlan(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.protocol === MOCK_PLAN_DOCUMENT.protocol &&
    record.protocolVersion === MOCK_PLAN_DOCUMENT.protocolVersion &&
    record.workflowId === MOCK_PLAN_DOCUMENT.workflowId &&
    record.templateId === MOCK_PLAN_DOCUMENT.templateId
  );
}

function toVersionDto(record: ArtifactContentRecord): ArtifactVersionDto {
  return {
    id: record.versionId,
    artifactId: record.artifactId,
    version: 1,
    status: "available",
    hash: record.hash,
    size: record.size,
    mediaType: record.mediaType,
    createdAt: record.createdAt,
  };
}

function syntheticOutput(
  slotId: string,
  nodeId: string,
): {
  mediaType: string;
  kind: "git_diff" | "test_result" | "evaluation";
  body: Uint8Array;
  metadata?: Record<string, unknown>;
} {
  const slot = slotId.toLowerCase();
  if (slot.includes("code") || slot.includes("change") || slot.includes("patch")) {
    const patch = [
      `diff --git a/${nodeId}.ts b/${nodeId}.ts`,
      `--- a/${nodeId}.ts`,
      `+++ b/${nodeId}.ts`,
      "@@ -0,0 +1,2 @@",
      `+export const ${nodeId.replaceAll(/[^A-Za-z0-9_]/g, "_")} = true;`,
      "",
    ].join("\n");
    return {
      mediaType: "text/x-diff",
      kind: "git_diff",
      body: encoder.encode(patch),
      metadata: { type: "git_diff", baseRef: "immutable-base" },
    };
  }
  if (slot.includes("test")) {
    return {
      mediaType: "application/vnd.workforce.test-result+json",
      kind: "test_result",
      body: encoder.encode(JSON.stringify({ passed: true, summary: `mock ${nodeId} tests` })),
    };
  }
  return {
    mediaType: KIND_MEDIA_TYPES.evaluation,
    kind: "evaluation",
    body: encoder.encode(JSON.stringify({ verdict: "pass", summary: `mock ${nodeId} review` })),
  };
}

function wrapError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof UseCaseError) {
    const currentRevision =
      typeof error.details?.actual === "number" ? error.details.actual : undefined;
    return new AppError(error.code, error.message, {
      ...(currentRevision !== undefined ? { currentRevision } : {}),
    });
  }
  if (error instanceof InvalidTransitionError) {
    return new AppError("invalid_transition", error.message);
  }
  if (error instanceof HostCapabilityError) {
    return new AppError("unsupported_capability", error.message);
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (code === "unsupported_capability") {
      return new AppError(
        "unsupported_capability",
        error instanceof Error ? error.message : "unsupported capability",
      );
    }
    if (code === "unknown_cost_not_enforceable") {
      return new AppError(
        "unknown_cost_not_enforceable",
        error instanceof Error ? error.message : "unknown cost is not enforceable",
      );
    }
  }
  return error;
}
