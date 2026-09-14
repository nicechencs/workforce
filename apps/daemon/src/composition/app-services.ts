import fs from "node:fs";
import path from "node:path";

import {
  CatalogService,
  adaptTeamDraftRepository,
  confirmAuthoringChatProposal,
  failAuthoringTurn,
  HostCapabilityError,
  isExecutableWorkflowVersion,
  retryAuthoringTurn,
  storeAuthoringSessionBody,
  toEngineGraph,
  UseCaseError,
  WorkforceApp,
  createWorkforceApp,
  integratePatches,
  mapPublishedTaskDependsOn,
  parseAuthoringTaskPatch,
  recordEvaluationEvidence,
  settleRunCancel,
  workerCardFieldsFrom,
  type ApprovalRecord,
  type AuthoringChatTurn,
  type AuthoringTaskPatch,
  type AuthoringTurnLifecycleDeps,
  type ProjectRecord,
  type RunRecord,
  type TaskRecord,
  type ConfirmChatProposalDeps,
  type WorkflowGraph,
  type WorkflowVersionRecord,
} from "@workforce/application";
import {
  ArtifactEvaluator,
  KIND_MEDIA_TYPES,
  LocalArtifactStore,
  collectBytes,
  type LineageSource,
  type RegistrableKind,
  type StoredArtifactVersion,
} from "@workforce/artifacts";
import { WorkforceSqlite, PersistenceError, sqliteDbOf } from "@workforce/database";
import { SqliteSubscriptionReader, type EventReadQuery } from "@workforce/events/subscriptions";
import type { CanonicalAction, InMemoryPolicyEngine } from "@workforce/policy";
import {
  DEFAULT_ORCHESTRATION_MODE,
  isSelectableWorkerVersion,
  parseTeamDraft,
  parseTeamVersionWrite,
  parseWorkerDraftWrite,
  parseWorkflowDraft,
  type AuthoringChangeSetDto,
  type AuthoringProposalDto,
  type AuthoringSessionPageDto,
  type AuthoringSessionViewDto,
  type AuthoringTurnDto,
  type AuthoringChatProposalDto,
  type AuthoringCommandAcceptedDto,
  type AuthoringTurnActionName,
  type AuthoringTurnActionAcceptedDto,
  type CommandReceipt,
  type TeamMemberDto,
  type WorkerDraftWrite,
  type WorkforceEvent,
} from "@workforce/protocol";
import { interpretMockAuthoringIntent } from "@workforce/runtime-mock";
import { WorkspaceError } from "@workforce/workspace";
import { InvalidTransitionError, validateWorkflowGraph } from "@workforce/workflow-engine";
import { RuntimeSdkError } from "@workforce/runtime-sdk";
import { CODEX_ADAPTER_ID } from "@workforce/runtime-codex";

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
  CreateWorkerInput,
  ChatClassifyInput,
  ChatClassifyResultDto,
  ContinueAuthoringChangeSetInput,
  ForkWorkerVersionAcceptedDto,
  ListWorkersInput,
  PatchTeamInput,
  PatchTeamVersionInput,
  PatchWorkflowInput,
  PatchWorkflowVersionInput,
  PatchWorkerInput,
  ProjectProgressProjectionDto,
  WorkerDraftDto,
  WorkerDto,
  WorkerPageDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
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
  CODEX_RUNTIME,
  CODEX_RUNTIME_CAPABILITIES,
  CODEX_RUNTIME_ID,
  CODEX_RUNTIME_INSTALLATION_ID,
  ORGANIZATION_ID,
  PROTOCOL_VERSION,
  SOFTWARE_TEAM_VERSION,
  TEAM_VERSION_ID,
  isPresetPublishedTeamVersion,
  pageOf,
  seedPresetWorkerLibrary,
  unknownProjectBudget,
} from "./catalog.js";
import { captureLivePatch, captureMockPatch, gitDiffArtifactFromCapture, isGitDiffSlot } from "./delivery-bind.js";
import { createEnginePort } from "./engine.js";
import {
  createComposedCodexRuntime,
  describeCodexHostBlocker,
  resolveComposedCodexStart,
} from "./codex.js";
import {
  ComposedMockHost,
  type RunAuthoringProposalEvent,
  type RunTerminalEvent,
} from "./mock-host.js";
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
  classifyChatIntent,
  createAuthoringCatalog,
  listedDraftTeams,
  listedTeams,
  listedWorkers,
  listedWorkflows,
  resolveTeam,
  resolveTeamVersion,
  resolveWorker,
  resolveWorkerDraft,
  resolveWorkerVersion,
  resolveWorkerVersionReferences,
  resolveWorkflow,
  resolveWorkflowVersion,
} from "../modules/authoring-catalog.js";

const encoder = new TextEncoder();
const AUTHORING_PROPOSAL_CONSUMER = "daemon.authoring-proposal";
type SqliteWriter = typeof dualWriteSqlite;
const sqliteWriterOption = Symbol("sqliteWriter");

export interface ComposedAppServicesOptions {
  stateDir: string;
  principalId?: string;
  clientId?: string;
  /**
   * Test-only Mock Host opt-in. Production omits this and uses Codex.
   * Never treat a missing value as 10ms Mock success.
   */
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
  readonly evaluator: ArtifactEvaluator;
  readonly worktrees: CompositionWorktreeHost;
  readonly policy: CompositionPolicy;
  readonly authoring: CatalogService;
  readonly stateDir: string;
  /** True when production Codex Host is composed. False is test-only Mock. */
  readonly liveRuntime: boolean;
  private readonly hostStore: JsonRuntimeHostStore;
  private readonly sqliteWriter: SqliteWriter;
  private readonly eventSubscriptions: SqliteSubscriptionReader;
  private readonly operations = new Map<string, CommandReceipt>();
  private readonly artifactContents = new Map<string, ArtifactContentRecord>();
  private readonly workspaces = new Map<string, WorkspaceDto>();
  private readonly decisionReasons = new Map<string, string>();
  private readonly synced = { eventIds: new Set<string>(), operationIds: new Set<string>() };
  private readonly integrations = new MemoryIntegrationStore();
  /** Raw user content is process-bound only; SQLite stores its opaque ref/hash. */
  private readonly authoringContent = new Map<string, string>();
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
    liveRuntime: boolean;
  }) {
    this.stateDir = input.stateDir;
    this.app = input.app;
    this.host = input.host;
    this.hostStore = input.hostStore;
    this.sqlite = input.sqlite;
    this.artifacts = input.artifacts;
    this.evaluator = new ArtifactEvaluator({
      store: input.artifacts,
      ids: { ulid: (prefix) => input.app.world.ids.ulid(prefix) },
      clock: { now: () => input.app.world.clock.now() },
    });
    this.worktrees = input.worktrees;
    this.policy = input.policy;
    this.sqliteWriter = input.sqliteWriter;
    this.authoring = input.authoring;
    this.liveRuntime = input.liveRuntime;
    this.eventSubscriptions = new SqliteSubscriptionReader(input.sqlite.connection);
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
    const liveRuntime = options.completeAfterMs === undefined;
    const hostTerminal = {
      onTerminal: async (event: RunTerminalEvent) => {
        if (!composed.services) {
          return;
        }
        await composed.services.handleTerminal(event);
      },
      onAuthoringProposal: async (event: RunAuthoringProposalEvent) => {
        if (!composed.services) {
          return false;
        }
        return composed.services.handleAuthoringProposal(event);
      },
    };
    const host = liveRuntime
      ? new ComposedMockHost({
          store: hostStore,
          nodeId: LOCAL_NODE_ID,
          defaultAdapterId: CODEX_ADAPTER_ID,
          defaultSnapshotRef: "codex:exec",
          adapter: createComposedCodexRuntime({
            resolveStart: (request) => {
              const task = composed.services?.app.world.tasks.get(request.taskId);
              const project = task
                ? composed.services?.app.world.projects.get(task.projectId)
                : undefined;
              return resolveComposedCodexStart({
                request,
                worktrees,
                ...(task ? { task } : {}),
                ...(project?.objective ? { objective: project.objective } : {}),
              });
            },
          }),
          ...hostTerminal,
        })
      : new ComposedMockHost({
          store: hostStore,
          completeAfterMs: options.completeAfterMs,
          nodeId: LOCAL_NODE_ID,
          ...hostTerminal,
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
      teamVersions: {
        findTeamVersion: (versionId) => {
          if (isPresetPublishedTeamVersion(versionId)) {
            return SOFTWARE_TEAM_VERSION;
          }
          return composed.services?.authoring.catalog.findTeamVersion(versionId);
        },
        findWorkerVersion: (id) => composed.services?.authoring.catalog.findWorkerVersion(id),
      },
    });
    const authoring = createAuthoringCatalog({
      ids: { ulid: (prefix) => app.world.ids.ulid(prefix) },
      now: () => app.world.nowIso(),
      validateWorkflowGraph,
    }).service;
    await hydrateCatalog(sqlite, authoring);
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
      liveRuntime,
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
      for (const event of snapshot.world.events) {
        services.synced.eventIds.add(event.id);
      }
      for (const receipt of snapshot.world.receipts) {
        services.synced.operationIds.add(receipt.operationId);
      }
      const clock = app.world.clock as unknown as { current: Date };
      clock.current = new Date();
      for (const workspace of services.workspaces.values()) {
        await services.worktrees.bindProject(workspace.projectId, workspace.authorizationRef);
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
        input: this.liveRuntime ? false : true,
        takeOver: false,
      },
      project: {
        pause: false,
        resume: false,
        archive: false,
      },
      orchestration: {
        workflowBound: true,
        /** Live Codex Host can start direct Runs; missing CLI/auth fail-closed. */
        direct: true,
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
      const graph = engineGraphFromCatalog(version);
      if (graph) {
        this.app.world.workflowVersions.set(graph.id, graph);
      }
      await this.persistCatalogWorkflow(id);
      this.persist();
      return {
        status: 200,
        body: resolveWorkflowVersion(this.authoring, id, version.id)!,
        revision: version.stateRevision,
      };
    });
  }

  listWorkers(query: ListWorkersInput): WorkerPageDto {
    return listedWorkers(this.authoring, query);
  }

  getWorker(id: string): WorkerDto | null {
    return resolveWorker(this.authoring, id);
  }

  getWorkerVersion(id: string, versionId: string): WorkerVersionDto | null {
    return resolveWorkerVersion(this.authoring, id, versionId);
  }

  getWorkerDraft(id: string, draftId: string): WorkerDraftDto | null {
    return resolveWorkerDraft(this.authoring, id, draftId);
  }

  listWorkerVersionReferences(id: string, versionId: string): WorkerVersionReferencesDto | null {
    return resolveWorkerVersionReferences(this.authoring, id, versionId);
  }

  createWorker(ctx: CommandContext, input: CreateWorkerInput): Promise<CommandResult<WorkerDto>> {
    return this.exclusive(async () => {
      void ctx;
      const created = this.authoring.createWorker(input);
      await this.persistNewWorker(created.worker, created.draft);
      return {
        status: 201,
        body: resolveWorker(this.authoring, created.worker.id)!,
        revision: created.worker.stateRevision ?? 1,
      };
    });
  }

  patchWorker(
    ctx: CommandContext,
    id: string,
    input: PatchWorkerInput,
  ): Promise<CommandResult<WorkerDto>> {
    return this.exclusive(async () => {
      const worker = this.authoring.patchWorker(id, input, ctx.ifMatch);
      await this.persistWorkerIdentity(worker);
      return {
        status: 200,
        body: resolveWorker(this.authoring, id)!,
        revision: worker.stateRevision ?? 1,
      };
    });
  }

  createWorkerDraft(
    ctx: CommandContext,
    id: string,
    input: WorkerDraftWrite,
  ): Promise<CommandResult<WorkerDraftDto>> {
    return this.exclusive(async () => {
      void ctx;
      const draft = this.authoring.createWorkerDraft(id, input);
      await this.sqlite.uow.withTransaction(async (tx) => {
        await this.sqlite.workers.saveDraft(tx, draft, 0);
      });
      return { status: 201, body: draft, revision: draft.revision };
    });
  }

  patchWorkerDraft(
    ctx: CommandContext,
    id: string,
    draftId: string,
    input: WorkerDraftWrite,
  ): Promise<CommandResult<WorkerDraftDto>> {
    return this.exclusive(async () => {
      const draft = this.authoring.patchWorkerDraft(id, draftId, input, ctx.ifMatch);
      const expectedRevision = ctx.ifMatch;
      if (expectedRevision === undefined) {
        throw new AppError("validation_failed", "If-Match is required");
      }
      await this.sqlite.uow.withTransaction(async (tx) => {
        await this.sqlite.workers.saveDraft(tx, draft, expectedRevision);
      });
      return { status: 200, body: draft, revision: draft.revision };
    });
  }

  publishWorkerDraft(
    ctx: CommandContext,
    id: string,
    draftId: string,
  ): Promise<CommandResult<WorkerVersionDto>> {
    return this.exclusive(async () => {
      const version = this.authoring.publishWorkerDraft(id, draftId, ctx.ifMatch);
      await this.sqlite.uow.withTransaction(async (tx) => {
        await this.sqlite.workers.publishVersion(tx, version);
        this.sqlite.connection.prepare("DELETE FROM worker_drafts WHERE worker_id = ?").run(id);
      });
      return { status: 200, body: version, revision: version.stateRevision ?? 1 };
    });
  }

  archiveWorkerVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): Promise<CommandResult<WorkerVersionDto>> {
    return this.exclusive(async () => {
      void ctx;
      const version = this.authoring.archiveWorkerVersion(id, versionId);
      await this.sqlite.uow.withTransaction(async (tx) => {
        await this.sqlite.workers.archiveVersion(tx, version.id);
      });
      return { status: 200, body: version, revision: version.stateRevision ?? 1 };
    });
  }

  forkWorkerVersion(
    ctx: CommandContext,
    id: string,
    versionId: string,
  ): Promise<CommandResult<ForkWorkerVersionAcceptedDto>> {
    return this.exclusive(async () => {
      void ctx;
      const accepted = this.authoring.forkWorkerVersion(id, versionId);
      const worker = this.authoring.getWorker(accepted.workerId);
      const draft = this.authoring.getWorkerDraft(accepted.workerId, accepted.workerDraftId);
      if (!worker || !draft) {
        throw new AppError("conflict", "fork did not produce a worker draft");
      }
      await this.sqlite.uow.withTransaction(async (tx) => {
        await this.sqlite.workers.forkToDraft(tx, versionId, { worker, draft });
      });
      return { status: 201, body: accepted };
    });
  }

  classifyChatIntent(input: ChatClassifyInput): ChatClassifyResultDto {
    return classifyChatIntent(input, this.chatClassifyContext());
  }

  async queryProjectProgress(projectId: string): Promise<ProjectProgressProjectionDto> {
    this.requireProject(projectId);
    try {
      return await this.app.queryProjectProgress(projectId);
    } catch (error) {
      throw wrapError(error);
    }
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
    return pageOf([this.liveRuntime ? CODEX_RUNTIME : MOCK_RUNTIME]);
  }

  getRuntime(id: string): RuntimeDto | null {
    if (this.liveRuntime) {
      return id === CODEX_RUNTIME_ID ? CODEX_RUNTIME : null;
    }
    return id === MOCK_RUNTIME_ID ? MOCK_RUNTIME : null;
  }

  getRuntimeCapabilities(id: string): RuntimeCapabilitiesDto | null {
    if (this.liveRuntime) {
      if (id !== CODEX_RUNTIME_ID) {
        return null;
      }
      const blocker = describeCodexHostBlocker();
      return {
        ...CODEX_RUNTIME_CAPABILITIES,
        capabilities: CODEX_RUNTIME_CAPABILITIES.capabilities.map((item) =>
          item.name === "coding"
            ? { ...item, available: blocker === undefined }
            : item,
        ),
      };
    }
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
      const publicRef = publicAuthorizationRef(input.authorizationRef);
      try {
        await this.worktrees.bindProject(project.id, input.authorizationRef);
      } catch (error) {
        if (error instanceof WorkspaceError && error.message === "unknown authorizationRef") {
          throw new AppError("forbidden", "Workspace authorization is unknown");
        }
        throw error;
      }
      const workspace: WorkspaceDto = {
        id: this.app.world.ids.ulid("wsp_"),
        projectId: project.id,
        status: "bound",
        kind: "local",
        authorizationRef: publicRef,
        createdAt: now,
      };
      this.workspaces.set(workspace.id, workspace);
      project.workspaceId = workspace.id;
      project.workspaceInstanceId = this.app.world.ids.ulid("wsi_");
      project.stateRevision += 1;
      project.updatedAt = now;
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
      const workspace = await this.workspaceFor(project);
      const teamVersionId = project.teamVersionId ?? TEAM_VERSION_ID;
      assertBindableTeamVersionId(this.authoring, teamVersionId);
      const started = await this.app.startPlanning({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId: project.id,
        workspaceId: workspace.id,
        teamVersionId,
        runtimeId: this.liveRuntime ? CODEX_RUNTIME_ID : MOCK_RUNTIME_ID,
        budgetId: project.budgetId ?? DEFAULT_BUDGET_ID,
        executionNodeId: LOCAL_NODE_ID,
        runtimeInstallationId: this.liveRuntime
          ? CODEX_RUNTIME_INSTALLATION_ID
          : MOCK_RUNTIME_INSTALLATION_ID,
        workspaceInstanceId: project.workspaceInstanceId ?? this.app.world.ids.ulid("wsi_"),
        ...optionalRevision(ctx.ifMatch),
      });
      const live = this.requireProject(id);
      if (live.planArtifactVersionId) {
        const body = encoder.encode(`${JSON.stringify(started.plan, null, 2)}\n`);
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
      const graph = this.publishedExecutionGraph(project);
      const confirmed = await this.app.confirmPlan({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId: project.id,
        approvalId: approval.id,
        ...(graph !== undefined ? { graph } : {}),
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
      await this.assertRuntimeStartAllowed(project);
      await this.policy.assertStartAllowed({
        runtime: project.runtimeId ?? (this.liveRuntime ? CODEX_RUNTIME_ID : MOCK_RUNTIME_ID),
        resource: `project:${project.id}`,
        ...(input.budgetHardLimitMinor !== undefined
          ? { budgetHardLimitMinor: input.budgetHardLimitMinor }
          : {}),
      });
      const orchestrationMode = input.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
      assertStartOrchestrationAllowed(orchestrationMode, this.capabilities());
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

  createAdHocTask(
    ctx: CommandContext,
    projectId: string,
    input: { title?: string; expectedStateRevision?: number },
  ): Promise<CommandResult<TaskDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(projectId);
      const expectedStateRevision = input.expectedStateRevision ?? ctx.ifMatch;
      this.assertMatch(project.stateRevision, expectedStateRevision);
      const created = await this.app.createAdHocTask({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        projectId,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(expectedStateRevision !== undefined ? { expectedStateRevision } : {}),
      });
      this.persist();
      return {
        status: created.reused ? 200 : 201,
        body: this.taskDto(created.task),
        revision: created.task.stateRevision,
      };
    });
  }

  startTaskRun(
    ctx: CommandContext,
    id: string,
    input: {
      operationId: string;
      orchestrationMode?: "workflow_bound" | "direct";
      placementIntent?: import("@workforce/protocol").PlacementIntent;
    },
  ): Promise<CommandResult<RunDto>> {
    return this.exclusive(async () => {
      const task = this.requireTask(id);
      this.assertMatch(task.stateRevision, ctx.ifMatch);
      const orchestrationMode = input.orchestrationMode ?? DEFAULT_ORCHESTRATION_MODE;
      assertStartOrchestrationAllowed(orchestrationMode, this.capabilities());
      await this.assertRuntimeStartAllowed(this.requireProject(task.projectId));
      const started =
        orchestrationMode === "direct"
          ? await this.app.startDirectWork({
              operationId: ctx.operationId,
              idempotencyKey: ctx.operationId,
              projectId: task.projectId,
              taskId: id,
              ...(ctx.ifMatch !== undefined ? { expectedTaskStateRevision: ctx.ifMatch } : {}),
              ...(input.placementIntent ? { placementIntent: input.placementIntent } : {}),
            })
          : await this.app.startTaskRun({
              operationId: ctx.operationId,
              idempotencyKey: ctx.operationId,
              taskId: id,
              orchestrationMode,
              snapshotRef: this.host.defaultSnapshotRef,
              requireWorkflowBinding: true,
              ...optionalRevision(ctx.ifMatch),
              ...(input.placementIntent ? { placementIntent: input.placementIntent } : {}),
            });
      this.persist();
      return {
        status: started.reused ? 200 : 201,
        body: this.runDto(started.run),
        revision: this.requireTask(id).stateRevision,
      };
    });
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
        await this.assertRuntimeStartAllowed(this.requireProject(live.projectId));
        await this.app.startRun({
          operationId: runOperationId(live),
          idempotencyKey: runOperationId(live),
          taskId: live.id,
          snapshotRef: this.host.defaultSnapshotRef,
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
      await this.policy.assertPauseAllowed(
        project.runtimeId ?? (this.liveRuntime ? CODEX_RUNTIME_ID : MOCK_RUNTIME_ID),
      );
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

  listRunEvents(runId: string, query: EventListQuery): Promise<PageDto<WorkforceEvent>> {
    this.requireRun(runId);
    return this.listEvents({ ...query, runId, stream: `run:${runId}` });
  }

  async createAuthoringSession(
    _ctx: CommandContext,
    projectId: string,
  ): Promise<CommandResult<AuthoringSessionViewDto>> {
    return this.exclusive(async () => {
      const project = this.requireProject(projectId);
      await this.persistDurably();
      const now = this.app.world.nowIso();
      const id = this.app.world.ids.ulid("cas_");
      await this.sqlite.uow.withTransaction(async (tx) => {
        this.sqlite.authoringSessions.create(tx, {
          id,
          organizationId: project.organizationId,
          projectId,
          protocolVersion: PROTOCOL_VERSION,
          createdAt: now,
          updatedAt: now,
        });
      });
      return { status: 201, body: this.authoringSessionView(id)! };
    });
  }

  listAuthoringSessions(projectId: string, query: ListQuery): AuthoringSessionPageDto {
    this.requireProject(projectId);
    const rows = this.sqlite.connection
      .prepare(
        `SELECT id, project_id, protocol_version, status, state_revision, created_at, updated_at
           FROM authoring_sessions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(projectId, query.limit) as Record<string, unknown>[];
    const items = rows.map((row) => ({
      id: String(row.id),
      projectId: String(row.project_id),
      protocolVersion: "0.1" as const,
      status: String(row.status) as "open" | "failed" | "closed",
      stateRevision: Number(row.state_revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
    return { items, page: { nextCursor: null, hasMore: false } };
  }

  getAuthoringSession(sessionId: string): AuthoringSessionViewDto | null {
    return this.authoringSessionView(sessionId);
  }

  getAuthoringTurn(sessionId: string, turnId: string): AuthoringTurnDto | null {
    const view = this.authoringSessionView(sessionId);
    return view?.turns.find((turn) => turn.id === turnId) ?? null;
  }

  getAuthoringProposal(sessionId: string, proposalId: string): AuthoringChatProposalDto | null {
    const proposal = this.sqlite.authoringProposals.get(proposalId);
    if (!proposal || proposal.sessionId !== sessionId) return null;
    return {
      id: proposal.id,
      projectId: proposal.projectId,
      sessionId: proposal.sessionId,
      turnId: proposal.turnId,
      sourceRunId: proposal.sourceRunId,
      summary: proposal.redactedPreview ?? "Workflow proposal ready",
      targets: proposal.targets.map((target) =>
        target.operation === "create"
          ? {
              targetType: target.targetType,
              operation: "create" as const,
              patchRef: target.patchRef,
            }
          : {
              targetType: target.targetType,
              operation: "update" as const,
              targetId: target.targetId!,
              expectedRevision: target.expectedRevision!,
              patchRef: target.patchRef,
            },
      ),
    };
  }

  async sendAuthoringMessage(
    ctx: CommandContext,
    sessionId: string,
    content: string,
  ): Promise<CommandResult<AuthoringCommandAcceptedDto & { turnId: string }>> {
    return this.exclusive(async () => {
      const session = this.sqlite.authoringSessions.get(sessionId);
      if (!session) throw new AppError("not_found", "Authoring session not found");
      const project = this.requireProject(session.projectId);
      if (session.status !== "open") {
        throw new AppError("invalid_transition", "Authoring session is not open");
      }
      this.assertMatch(session.stateRevision, ctx.ifMatch);
      if (!content.trim()) throw new AppError("validation_failed", "content is required");

      const authoringOperationId = `${ctx.operationId}:authoring`;
      // startAuthoring derives the governed Runtime operation as `:run`.
      // Queue the transient handoff against that concrete Host operation so
      // LocalNodeHost can deliver it during startWithInitialInput.
      this.host.setInitialInput(`${authoringOperationId}:run`, {
        operationId: `${ctx.operationId}:input`,
        text: content,
      });
      const started = await this.app.startAuthoring({
        operationId: authoringOperationId,
        idempotencyKey: authoringOperationId,
        projectId: project.id,
        intent: content,
      });
      await this.persistDurably();
      const run = this.app.world.runs.get(started.runId);
      if (!run?.handleId) throw new AppError("conflict", "Authoring run has no Host handle");

      const now = this.app.world.nowIso();
      const messageId = this.app.world.ids.ulid("cam_");
      const turnId = this.app.world.ids.ulid("cat_");
      const stored = storeAuthoringSessionBody(this.app.world, {
        sessionId,
        messageId,
        content,
      });
      this.authoringContent.set(stored.contentRef, content);
      await this.sqlite.uow.withTransaction(async (tx) => {
        this.sqlite.authoringMessages.create(tx, {
          id: messageId,
          sessionId,
          role: "user",
          contentRef: stored.contentRef,
          contentHash: stored.contentHash,
          redactedPreview: stored.redactedPreview,
          createdAt: now,
        });
        this.sqlite.authoringTurns.create(tx, {
          id: turnId,
          sessionId,
          organizationId: project.organizationId,
          projectId: project.id,
          sourceRunId: started.runId,
          protocolVersion: PROTOCOL_VERSION,
          status: "running",
          taskId: started.taskId,
          runId: started.runId,
          createdAt: now,
          updatedAt: now,
        });
        this.sqlite.connection
          .prepare(
            `UPDATE authoring_sessions SET state_revision = state_revision + 1, updated_at = ? WHERE id = ?`,
          )
          .run(now, sessionId);
      });
      await this.host.sendInput(run.handleId, {
        operationId: `${ctx.operationId}:input`,
        text: content,
      });
      const current = this.sqlite.authoringSessions.get(sessionId);
      return {
        status: 202,
        body: {
          operationId: ctx.operationId,
          acceptedAt: now,
          sessionId,
          turnId,
          revision: current?.stateRevision ?? session.stateRevision + 1,
        },
        revision: current?.stateRevision ?? session.stateRevision + 1,
      };
    });
  }

  async confirmAuthoringTurn(
    ctx: CommandContext,
    sessionId: string,
    turnId: string,
  ): Promise<CommandResult<AuthoringTurnActionAcceptedDto>> {
    return this.exclusive(async () => {
      const turn = this.sqlite.authoringTurns.get(turnId);
      if (!turn || turn.sessionId !== sessionId) {
        throw new AppError("not_found", "Authoring turn not found");
      }
      if (ctx.ifMatch === undefined)
        throw new AppError("validation_failed", "If-Match is required");
      const confirmed = await confirmAuthoringChatProposal(
        {
          action: "confirm",
          operationId: ctx.operationId,
          idempotencyKey: ctx.operationId,
          sessionId,
          turnId,
          expectedRevision: ctx.ifMatch,
        },
        this.confirmChatDeps(),
      );
      for (const ref of confirmed.workerDrafts) {
        await this.syncWorkerIntoCatalog(ref.workerId, ref.workerDraftId);
      }
      for (const ref of confirmed.teamDrafts) {
        this.syncTeamDraftIntoCatalog(ref.teamId);
      }
      await this.persistDurably();
      const current = this.sqlite.authoringTurns.get(turnId);
      return {
        status: 200,
        body: {
          operationId: ctx.operationId,
          acceptedAt: this.app.world.nowIso(),
          sessionId,
          turnId,
          action: "confirm",
          revision: current?.stateRevision ?? turn.stateRevision + 1,
        },
        revision: current?.stateRevision ?? turn.stateRevision + 1,
      };
    });
  }

  async authoringTurnAction(
    ctx: CommandContext,
    sessionId: string,
    turnId: string,
    action: Exclude<AuthoringTurnActionName, "confirm">,
  ): Promise<CommandResult<AuthoringTurnActionAcceptedDto>> {
    return this.exclusive(async () => {
      if (action === "retry") {
        return this.retryAuthoringTurnAction(ctx, sessionId, turnId);
      }
      const turn = this.sqlite.authoringTurns.get(turnId);
      if (!turn || turn.sessionId !== sessionId) {
        throw new AppError("not_found", "Authoring turn not found");
      }
      this.assertMatch(turn.stateRevision, ctx.ifMatch);
      const expectedRevision = ctx.ifMatch;
      if (expectedRevision === undefined)
        throw new AppError("validation_failed", "If-Match is required");
      if (action === "cancel" && turn.runId) {
        const run = this.app.world.runs.get(turn.runId);
        if (run?.handleId) {
          await this.host.cancel(run.handleId, "authoring turn cancelled");
        }
      }
      const nextStatus = action === "cancel" ? "cancelled" : "closed";
      const now = this.app.world.nowIso();
      await this.sqlite.uow.withTransaction(async () => {
        const changed = this.sqlite.connection
          .prepare(
            `UPDATE authoring_turns SET status = ?, state_revision = state_revision + 1, updated_at = ?
              WHERE id = ? AND session_id = ? AND state_revision = ?`,
          )
          .run(nextStatus, now, turnId, sessionId, expectedRevision);
        if (Number(changed.changes) === 0) {
          const currentRevision = this.sqlite.authoringTurns.get(turnId)?.stateRevision;
          throw new AppError(
            "revision_conflict",
            "Authoring turn revision changed",
            currentRevision === undefined ? {} : { currentRevision },
          );
        }
      });
      const current = this.sqlite.authoringTurns.get(turnId)!;
      return {
        status: 200,
        body: {
          operationId: ctx.operationId,
          acceptedAt: now,
          sessionId,
          turnId,
          action,
          revision: current.stateRevision,
        },
        revision: current.stateRevision,
      };
    });
  }

  async continueAuthoringChangeSet(
    ctx: CommandContext,
    sessionId: string,
    changeSetId: string,
    input: ContinueAuthoringChangeSetInput,
  ): Promise<CommandResult<AuthoringChangeSetDto>> {
    return this.exclusive(async () => {
      const { session } = this.requireSessionChangeSet(sessionId, changeSetId);
      this.assertMatch(session.stateRevision, ctx.ifMatch);
      const workflowDrafts = this.parseContinueDrafts(
        input.workflowDrafts,
        parseWorkflowDraft,
        "workflowDrafts",
      );
      const teamDrafts = this.parseContinueDrafts(input.teamDrafts, parseTeamDraft, "teamDrafts");
      const taskPatches = this.parseContinueTaskPatches(input.taskPatches);
      const continued = await this.app.continueAuthoringChangeSet({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        changeSetId,
        ...(workflowDrafts !== undefined ? { workflowDrafts } : {}),
        ...(teamDrafts !== undefined ? { teamDrafts } : {}),
        ...(taskPatches !== undefined ? { taskPatches } : {}),
      });
      for (const step of continued.changeSet.steps) {
        if (step.status === "applied" && step.targetType === "team") {
          this.syncTeamDraftIntoCatalog(step.targetId);
        }
      }
      return this.finishSessionChangeSet(sessionId, session.stateRevision, continued.changeSet);
    });
  }

  async retryAuthoringChangeSet(
    ctx: CommandContext,
    sessionId: string,
    changeSetId: string,
  ): Promise<CommandResult<AuthoringChangeSetDto>> {
    return this.exclusive(async () => {
      const { session } = this.requireSessionChangeSet(sessionId, changeSetId);
      this.assertMatch(session.stateRevision, ctx.ifMatch);
      const retried = await this.app.retryAuthoringChangeSet({
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        changeSetId,
      });
      return this.finishSessionChangeSet(sessionId, session.stateRevision, retried.changeSet);
    });
  }

  private async retryAuthoringTurnAction(
    ctx: CommandContext,
    sessionId: string,
    turnId: string,
  ): Promise<CommandResult<AuthoringTurnActionAcceptedDto>> {
    const turn = this.sqlite.authoringTurns.get(turnId);
    if (!turn || turn.sessionId !== sessionId) {
      throw new AppError("not_found", "Authoring turn not found");
    }
    if (ctx.ifMatch === undefined) {
      throw new AppError("validation_failed", "If-Match is required");
    }
    this.assertMatch(turn.stateRevision, ctx.ifMatch);
    const contentRef = this.ensureAuthoringTurnBody(sessionId, turnId);
    const retried = await retryAuthoringTurn(
      {
        operationId: ctx.operationId,
        idempotencyKey: ctx.operationId,
        sessionId,
        turnId,
        expectedRevision: ctx.ifMatch,
        contentRef,
        projectId: turn.projectId,
      },
      this.authoringTurnLifecycleDeps(),
    );
    await this.persistDurably();
    const current = this.sqlite.authoringTurns.get(turnId);
    const revision = current?.stateRevision ?? turn.stateRevision + 1;
    return {
      status: 200,
      body: {
        operationId: ctx.operationId,
        acceptedAt: this.app.world.nowIso(),
        sessionId: retried.sessionId,
        turnId: retried.turnId,
        action: "retry",
        revision,
      },
      revision,
    };
  }

  private async failAuthoringTurnForRun(runId: string): Promise<void> {
    const chatTurn = this.chatTurnForRun(runId);
    if (!chatTurn) {
      return;
    }
    const turn = this.sqlite.authoringTurns.get(chatTurn.id);
    if (!turn || turn.status === "failed" || turn.status === "completed" || turn.status === "closed" || turn.status === "cancelled") {
      return;
    }
    await failAuthoringTurn(
      {
        operationId: `authoring-fail:${runId}`,
        idempotencyKey: `authoring-fail:${runId}`,
        sessionId: chatTurn.sessionId,
        turnId: turn.id,
        expectedRevision: turn.stateRevision,
        failure: { code: "conflict", message: "authoring run failed" },
      },
      this.authoringTurnLifecycleDeps(),
    );
  }

  private ensureAuthoringTurnBody(sessionId: string, turnId: string): string {
    const view = this.authoringSessionView(sessionId);
    const turnIndex = view?.turns.findIndex((item) => item.id === turnId) ?? -1;
    const message = turnIndex >= 0 ? view?.turns[turnIndex]?.userMessage : undefined;
    const messageRows = this.sqlite.connection
      .prepare(
        `SELECT id, content_ref FROM authoring_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as Array<{ id: string; content_ref: string | null }>;
    const row = turnIndex >= 0 ? messageRows[turnIndex] : undefined;
    const contentRef = row?.content_ref ?? undefined;
    if (!contentRef) {
      throw new AppError("validation_failed", "authoring intent is not recoverable after restart");
    }
    const existing = this.app.world.authoringProtectedBodies.get(contentRef);
    if (existing && existing.body.trim().length > 0) {
      return contentRef;
    }
    const body = this.authoringContent.get(contentRef) ?? message?.content;
    if (!body || (body.startsWith("[") && body.endsWith("]"))) {
      throw new AppError("validation_failed", "authoring intent is not recoverable after restart");
    }
    this.app.world.authoringProtectedBodies.set(contentRef, {
      contentRef,
      contentHash: sha256Hex(body),
      redactedPreview: `[user message retained in process memory]`,
      body,
      kind: "session_message",
      createdAt: this.app.world.nowIso(),
      sessionId,
      ...(row?.id ? { messageId: row.id } : {}),
    });
    return contentRef;
  }

  private publishedExecutionGraph(project: ProjectRecord): WorkflowGraph | undefined {
    const bound = this.graphFromVersionId(project.workflowVersionId);
    if (bound) {
      return bound;
    }
    for (const scope of this.sqlite.workflowAuthoringScopes.listAll()) {
      if (scope.projectId !== project.id) {
        continue;
      }
      const workflow = this.authoring.catalog.workflows.get(scope.workflowId);
      const fromActive = this.graphFromVersionId(workflow?.activeVersionId);
      if (fromActive) {
        return fromActive;
      }
      const published = this.authoring.catalog
        .listWorkflowVersions(scope.workflowId)
        .filter((version) => isExecutableWorkflowVersion(version) && version.nodes.length > 0)
        .sort(
          (left, right) =>
            (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") ||
            right.id.localeCompare(left.id),
        )[0];
      const graph = published ? engineGraphFromCatalog(published) : undefined;
      if (graph) {
        this.app.world.workflowVersions.set(graph.id, graph);
        return graph;
      }
    }
    return undefined;
  }

  private graphFromVersionId(versionId: string | undefined): WorkflowGraph | undefined {
    if (!versionId) {
      return undefined;
    }
    const live = this.app.world.workflowVersions.get(versionId);
    if (live) {
      return JSON.parse(JSON.stringify(live)) as WorkflowGraph;
    }
    const catalog = this.authoring.catalog.findWorkflowVersion(versionId);
    const graph = catalog ? engineGraphFromCatalog(catalog) : undefined;
    if (graph) {
      this.app.world.workflowVersions.set(graph.id, graph);
    }
    return graph;
  }

  private authoringTurnLifecycleDeps(): AuthoringTurnLifecycleDeps {
    const services = this;
    return {
      clock: this.app.world.clock,
      ids: this.app.world.ids,
      uow: this.sqlite.uow,
      events: this.sqlite.events,
      receipts: this.sqlite.receipts,
      sessions: this.sqlite.authoringSessions,
      turns: {
        getInTransaction: (tx, id) => {
          const stored = this.sqlite.authoringTurns.getInTransaction(tx, id);
          return stored ? toAuthoringChatTurn(stored) : null;
        },
        transitionInTransaction: (tx, input) => {
          const db = sqliteDbOf(tx);
          const changed = db
            .prepare(
              `UPDATE authoring_turns
                  SET status = ?,
                      state_revision = state_revision + 1,
                      task_id = COALESCE(?, task_id),
                      run_id = COALESCE(?, run_id),
                      source_run_id = COALESCE(?, source_run_id),
                      updated_at = ?
                WHERE id = ? AND state_revision = ?`,
            )
            .run(
              input.status,
              input.taskId ?? null,
              input.runId ?? null,
              input.sourceRunId ?? null,
              input.at,
              input.turnId,
              input.expectedStateRevision,
            );
          if (Number(changed.changes) === 0) {
            const current = this.sqlite.authoringTurns.getInTransaction(tx, input.turnId);
            throw new UseCaseError("revision_conflict", "Authoring turn revision changed", {
              details: {
                expected: input.expectedStateRevision,
                actual: current?.stateRevision,
              },
            });
          }
          const next = this.sqlite.authoringTurns.getInTransaction(tx, input.turnId);
          if (!next) {
            throw new AppError("not_found", "Authoring turn not found");
          }
          return toAuthoringChatTurn(next);
        },
      },
      protectedBodies: this.app.world,
      principalId: this.app.ctx.principalId,
      clientId: this.app.ctx.clientId,
      startAuthoring: async (input) => {
        services.host.setInitialInput(`${input.operationId}:run`, {
          operationId: `${input.operationId}:input`,
          text: input.intent,
        });
        const started = await services.app.startAuthoring(input);
        await services.persistDurably();
        const run = services.app.world.runs.get(started.runId);
        if (run?.handleId) {
          await services.host.sendInput(run.handleId, {
            operationId: `${input.operationId}:input`,
            text: input.intent,
          });
        }
        return started;
      },
      cancelAuthoringRun: async (runId) => {
        const run = services.app.world.runs.get(runId);
        if (run?.handleId) {
          await services.host.cancel(run.handleId, "authoring turn cancelled");
        }
      },
    };
  }

  private authoringSessionView(sessionId: string): AuthoringSessionViewDto | null {
    const session = this.sqlite.authoringSessions.get(sessionId);
    if (!session) return null;
    const messageRows = this.sqlite.connection
      .prepare(
        `SELECT id, role, content_ref, redacted_preview, created_at
           FROM authoring_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as Record<string, unknown>[];
    const messages = messageRows.map((row) => {
      const ref = row.content_ref === null ? undefined : String(row.content_ref);
      return {
        id: String(row.id),
        role: "user" as const,
        content: (ref && this.authoringContent.get(ref)) ?? "[message unavailable after restart]",
        createdAt: String(row.created_at),
      };
    });
    const turnRows = this.sqlite.connection
      .prepare(
        `SELECT id, session_id, protocol_version, status, state_revision,
                task_id, run_id, change_set_id, workflow_draft_id, created_at, updated_at
           FROM authoring_turns WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as Record<string, unknown>[];
    const turns: AuthoringTurnDto[] = turnRows.map((row, index) => {
      const refs: AuthoringTurnDto["refs"] = {};
      if (row.task_id !== null) refs.taskId = String(row.task_id);
      if (row.run_id !== null) refs.runId = String(row.run_id);
      if (row.change_set_id !== null) refs.changeSetId = String(row.change_set_id);
      if (row.workflow_draft_id !== null) refs.workflowDraftId = String(row.workflow_draft_id);
      const message = messages[index] ?? {
        id: `cam_missing_${String(row.id)}`,
        role: "user" as const,
        content: "[message unavailable after restart]",
        createdAt: String(row.created_at),
      };
      return {
        id: String(row.id),
        sessionId,
        protocolVersion: "0.1" as const,
        status: String(row.status) as AuthoringTurnDto["status"],
        userMessage: message,
        refs,
        revision: Number(row.state_revision),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      };
    });
    const lastTurn = turns.at(-1);
    const draft = lastTurn?.refs.workflowDraftId
      ? (() => {
          const stored = this.sqlite.workflowDrafts.get(lastTurn.refs.workflowDraftId!);
          return stored
            ? {
                kind: "landed" as const,
                unpublished: true as const,
                workflowDraftId: stored.id,
                workflowId: stored.workflowId,
                revision: stored.revision,
              }
            : undefined;
        })()
      : lastTurn?.status === "awaiting_confirmation"
        ? { kind: "proposal" as const, unpublished: true as const, workflow: {} }
        : undefined;
    return {
      id: session.id,
      projectId: session.projectId,
      protocolVersion: "0.1",
      status: session.status,
      messages,
      ...(draft ? { draft } : {}),
      stateRevision: session.stateRevision,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turns,
    };
  }

  private confirmChatDeps(): ConfirmChatProposalDeps {
    return {
      clock: this.app.world.clock,
      ids: this.app.world.ids,
      uow: this.sqlite.uow,
      events: this.sqlite.events,
      receipts: this.sqlite.receipts,
      projects: this.sqlite.projects,
      sourceRuns: this.sqlite.authoringSourceRuns,
      sessions: this.sqlite.authoringSessions,
      turns: this.sqlite.authoringTurns,
      patches: this.sqlite.authoringPatches,
      workflowIdentities: this.sqlite.catalogWorkflows,
      workflowAuthorities: this.sqlite.workflowAuthoringScopes,
      workflowDrafts: this.sqlite.workflowDrafts,
      proposals: {
        getInTransaction: (tx, proposalId) => {
          const stored = this.sqlite.authoringProposals.getInTransaction(tx, proposalId);
          if (!stored) return null;
          return {
            ...stored,
            targets: stored.targets.map((target, ordinal) =>
              target.operation === "create"
                ? {
                    ordinal,
                    targetType: target.targetType,
                    operation: "create" as const,
                    patchRef: target.patchRef,
                  }
                : {
                    ordinal,
                    targetType: target.targetType,
                    operation: "update" as const,
                    targetId: target.targetId!,
                    expectedRevision: target.expectedRevision!,
                    patchRef: target.patchRef,
                  },
            ),
          };
        },
      },
      teamIdentities: {
        create: (tx, team) => {
          this.sqlite.catalogTeams.upsert(tx, team);
        },
      },
      teamDrafts: adaptTeamDraftRepository(this.sqlite.teamDrafts),
      tasks: this.sqlite.tasks,
      resolver: {
        resolveWorkflowGraph: ({
          proposalId,
          projectId,
          sourceRunId,
          operation,
          patchRef,
          workflowId,
          expectedRevision,
        }) => {
          const proposal = this.sqlite.authoringProposals.get(proposalId);
          if (!proposal) {
            throw new AppError("not_found", "Authoring proposal not found");
          }
          return {
            graph: workflowGraphFromUtterance(
              this.authoringUtteranceForTurn(proposal.sessionId, proposal.turnId),
            ),
            binding: {
              organizationId: ORGANIZATION_ID,
              projectId,
              sessionId: proposal.sessionId,
              turnId: proposal.turnId,
              sourceRunId,
              patchRef,
              ...(operation === "update" && workflowId !== undefined ? { workflowId } : {}),
              ...(operation === "update" && expectedRevision !== undefined
                ? { expectedRevision }
                : {}),
            },
          };
        },
        resolveTeamDraft: ({
          proposalId,
          projectId,
          sourceRunId,
          operation,
          patchRef,
          teamId,
          expectedRevision,
        }) => {
          const proposal = this.sqlite.authoringProposals.get(proposalId);
          if (!proposal) {
            throw new AppError("not_found", "Authoring proposal not found");
          }
          const members = this.publishedTeamMembersFromUtterance(
            this.authoringUtteranceForTurn(proposal.sessionId, proposal.turnId),
          );
          return {
            members,
            binding: {
              organizationId: ORGANIZATION_ID,
              projectId,
              sessionId: proposal.sessionId,
              turnId: proposal.turnId,
              sourceRunId,
              patchRef,
              ...(operation === "update" && teamId !== undefined ? { teamId } : {}),
              ...(operation === "update" && expectedRevision !== undefined
                ? { expectedRevision }
                : {}),
            },
          };
        },
        resolveTaskPatch: ({
          proposalId,
          projectId,
          sourceRunId,
          operation,
          patchRef,
          taskId,
          expectedRevision,
        }) => {
          const proposal = this.sqlite.authoringProposals.get(proposalId);
          if (!proposal) {
            throw new AppError("not_found", "Authoring proposal not found");
          }
          const patch = this.taskPatchFromUtterance(
            this.authoringUtteranceForTurn(proposal.sessionId, proposal.turnId),
            taskId,
          );
          return {
            patch,
            binding: {
              organizationId: ORGANIZATION_ID,
              projectId,
              sessionId: proposal.sessionId,
              turnId: proposal.turnId,
              sourceRunId,
              patchRef,
              ...(operation === "update" && taskId !== undefined ? { taskId } : {}),
              ...(operation === "update" && expectedRevision !== undefined
                ? { expectedRevision }
                : {}),
            },
          };
        },
        resolveWorkerDraft: ({
          proposalId,
          projectId,
          sourceRunId,
          operation,
          patchRef,
          workerId,
          expectedRevision,
        }) => {
          const proposal = this.sqlite.authoringProposals.get(proposalId);
          if (!proposal) {
            throw new AppError("not_found", "Authoring proposal not found");
          }
          return {
            write: workerDraftWriteFromProposal(proposal.redactedPreview),
            binding: {
              organizationId: ORGANIZATION_ID,
              projectId,
              sessionId: proposal.sessionId,
              turnId: proposal.turnId,
              sourceRunId,
              patchRef,
              ...(operation === "update" && workerId !== undefined ? { workerId } : {}),
              ...(operation === "update" && expectedRevision !== undefined
                ? { expectedRevision }
                : {}),
            },
          };
        },
      },
      workerLibrary: this.sqlite.workers,
      principalId: this.app.ctx.principalId,
      clientId: this.app.ctx.clientId,
    };
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
      this.filter(this.artifactDtos(), query, {
        projectId: (dto) => dto.projectId,
        taskId: (dto) => this.artifactTaskId(dto.id),
      }),
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

  async listEvents(query: EventListQuery): Promise<PageDto<WorkforceEvent>> {
    await this.sqliteWrite;
    const horizon = this.eventSubscriptions.trimHorizon();
    if (query.afterIngestionPosition > 0 && query.afterIngestionPosition < horizon) {
      throw new AppError("event_cursor_expired", "Event cursor is older than retained events");
    }
    const matched = await this.eventSubscriptions.read(
      this.toEventReadQuery(query, query.limit + 1),
    );
    const slice = matched.slice(0, query.limit);
    const last = slice[slice.length - 1];
    const hasMore = matched.length > query.limit;
    return {
      items: slice,
      page: {
        nextCursor: hasMore && last?.id !== undefined ? last.id : null,
        hasMore,
      },
    };
  }

  highWaterMark(): number {
    return this.eventSubscriptions.highWaterMark();
  }

  trimHorizon(): number {
    return this.eventSubscriptions.trimHorizon();
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
        try {
          await this.bindRequiredOutputs(run);
          await this.recordBoundOutputEvaluations(run);
          this.app.recordRunSucceeded(run.id);
          await this.maybeIntegrate(run.projectId);
          await this.maybeCreateArtifactApproval(run.projectId);
          await this.dispatchReadyTasks(run.projectId);
        } catch (error) {
          if (!this.liveRuntime) {
            throw error;
          }
          this.app.recordRunFailed(run.id);
          await this.failAuthoringTurnForRun(run.id);
        }
      } else if (event.status === "failed") {
        this.app.recordRunFailed(run.id);
        await this.failAuthoringTurnForRun(run.id);
      } else if (event.status === "cancelled") {
        settleRunCancel(this.app.ctx, run.id);
      }
      this.persist();
    });
  }

  /**
   * The Runtime proposal is scoped to a Host handle, not trusted for its project/run IDs.
   * We derive those IDs from the durable application Run bound to the handle before
   * passing the already-sanitized structured fields to the Application use case.
   */
  private async handleAuthoringProposal(event: RunAuthoringProposalEvent): Promise<boolean> {
    if (this.closed) {
      return false;
    }
    const messageId = `${event.handleId}:${event.sourceCursor}`;
    if (this.sqlite.inbox.seen(AUTHORING_PROPOSAL_CONSUMER, messageId)) {
      return true;
    }
    return this.exclusive(async () => {
      if (this.sqlite.inbox.seen(AUTHORING_PROPOSAL_CONSUMER, messageId)) {
        return true;
      }
      const run = [...this.app.world.runs.values()].find(
        (item) => item.handleId === event.handleId,
      );
      if (!run) {
        return false;
      }
      const chatTurn = this.chatTurnForRun(run.id);
      if (chatTurn) {
        return this.handleChatAuthoringProposal(event, run.id, chatTurn.id, messageId);
      }
      const operationId = `runtime.authoring.proposal:${event.handleId}:${event.sourceCursor}`;
      const priorProjection = this.app.world.events.events.find(
        (record) =>
          record.type === "workflow.authoring.proposed" && record.correlationId === operationId,
      );
      const alreadyProjected =
        priorProjection?.subject.type === "authoring_change_set" &&
        this.app.world.authoringChangeSets.has(priorProjection.subject.id);
      if (!alreadyProjected) {
        await this.app.recordAuthoringProposal({
          operationId,
          idempotencyKey: operationId,
          proposal: {
            ...event.proposal,
            projectId: run.projectId,
            sourceRunId: run.id,
          },
        });
      }
      // The consumer ACK is written only after the ChangeSet/Event projection commits.
      // A crash before this point replays safely; a crash after it has a durable projection.
      await this.persistDurably();
      await this.sqlite.uow.withTransaction(async (tx) => {
        this.sqlite.inbox.record(
          tx,
          AUTHORING_PROPOSAL_CONSUMER,
          messageId,
          this.app.world.nowIso(),
        );
      });
      return true;
    });
  }

  private chatTurnForRun(runId: string): { id: string; sessionId: string } | null {
    const row = this.sqlite.connection
      .prepare(
        "SELECT id, session_id FROM authoring_turns WHERE run_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(runId) as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), sessionId: String(row.session_id) } : null;
  }

  private async handleChatAuthoringProposal(
    event: RunAuthoringProposalEvent,
    sourceRunId: string,
    turnId: string,
    messageId: string,
  ): Promise<boolean> {
    const existing = this.sqlite.authoringTurns.get(turnId);
    if (!existing) return false;
    const proposalId = event.proposal.id;
    const targets = chatProposalCreateTargets(event.proposal);
    if (targets.length === 0) return false;
    const now = this.app.world.nowIso();
    const project = this.requireProject(existing.projectId);
    await this.sqlite.uow.withTransaction(async (tx) => {
      if (!this.sqlite.authoringProposals.getInTransaction(tx, proposalId)) {
        this.sqlite.authoringProposals.create(tx, {
          id: proposalId,
          sessionId: existing.sessionId,
          turnId,
          organizationId: project.organizationId,
          projectId: existing.projectId,
          sourceRunId,
          proposalRef: proposalId,
          proposalHash: sha256Hex(
            canonicalJson({
              id: proposalId,
              targets: targets.map((target) => ({
                targetType: target.targetType,
                patchRef: target.patchRef,
              })),
            }),
          ),
          redactedPreview: event.proposal.summary,
          targets,
          createdAt: now,
          updatedAt: now,
        });
      }
      this.sqlite.connection
        .prepare(
          `UPDATE authoring_turns
              SET status = 'awaiting_confirmation', state_revision = state_revision + 1,
                  proposal_id = ?, patch_refs_json = ?, updated_at = ?
            WHERE id = ? AND status IN ('accepted', 'running', 'awaiting_confirmation')`,
        )
        .run(proposalId, JSON.stringify(targets.map((target) => target.patchRef)), now, turnId);
      const eventRecord: WorkforceEvent = {
        specVersion: "0.1",
        id: this.app.world.ids.ulid("evt_"),
        type: "workflow.authoring.chat.proposed",
        source: "workforce.daemon.authoring-chat",
        subject: { type: "authoring_chat_proposal", id: proposalId },
        time: now,
        recordedAt: now,
        organizationId: project.organizationId,
        projectId: project.id,
        runId: sourceRunId,
        actor: { type: "service", id: "daemon" },
        stream: `authoring_session:${existing.sessionId}`,
        correlationId: messageId,
        dataContentType: "application/json",
        dataSchema: "urn:workforce:event:workflow.authoring.chat.proposed:0.1",
        data: {
          sessionId: existing.sessionId,
          turnId,
          proposalId,
          sourceRunId,
          targets: targets.map((target) => ({
            targetType: target.targetType,
            operation: "create",
            patchRef: target.patchRef,
          })),
        },
        sensitivity: "internal",
      };
      await this.sqlite.events.append(tx, eventRecord);
      await this.app.world.events.append({ kind: "tx" }, eventRecord);
    });
    await this.persistDurably();
    await this.sqlite.uow.withTransaction(async (tx) => {
      this.sqlite.inbox.record(tx, AUTHORING_PROPOSAL_CONSUMER, messageId, now);
    });
    return true;
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
      await this.assertRuntimeStartAllowed(this.requireProject(projectId));
      await this.app.startRun({
        operationId: runOperationId(task),
        idempotencyKey: runOperationId(task),
        taskId: task.id,
        snapshotRef: this.host.defaultSnapshotRef,
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

  private async recordBoundOutputEvaluations(run: RunRecord): Promise<void> {
    const task = this.app.world.tasks.get(run.taskId);
    if (!task) {
      return;
    }
    for (const versionId of Object.values(task.outputBindings)) {
      if (this.app.world.evaluationsForArtifact(versionId).length > 0) {
        continue;
      }
      const evaluation = await this.evaluator.evaluate({
        artifactVersionId: versionId,
        criterion: { id: `schema:${versionId}`, type: "schema" },
      });
      recordEvaluationEvidence(this.app.ctx, {
        artifactVersionId: versionId,
        verdict: evaluation.verdict,
        id: evaluation.id,
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
        baseSha: this.worktrees.baseShaFor(projectId),
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
        baseSha: this.worktrees.baseShaFor(projectId),
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
        baseSha: this.worktrees.baseShaFor(projectId),
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
      if (this.liveRuntime) {
        const captured = await captureLivePatch({
          git: this.worktrees.git,
          instanceId: provisioned.workspaceInstanceId,
          nodeId: provisioned.nodeId,
        });
        return gitDiffArtifactFromCapture(captured, provisioned.nodeId);
      }
      const captured = await captureMockPatch({
        git: this.worktrees.git,
        instanceId: provisioned.workspaceInstanceId,
        worktreePath: provisioned.worktreePath,
        nodeId: provisioned.nodeId,
      });
      return gitDiffArtifactFromCapture(captured, provisioned.nodeId);
    }
    if (this.liveRuntime) {
      throw new Error(
        `Codex did not produce a Workforce ${slotId} artifact; refusing to fabricate Mock ${slotId}`,
      );
    }
    return syntheticOutput(slotId, nodeId);
  }

  private async workspaceFor(project: ProjectRecord): Promise<WorkspaceDto> {
    if (project.workspaceId) {
      const existing = this.workspaces.get(project.workspaceId);
      if (existing) {
        await this.worktrees.bindProject(project.id, existing.authorizationRef);
        return existing;
      }
    }
    const bound = [...this.workspaces.values()].find((item) => item.projectId === project.id);
    if (bound) {
      project.workspaceId = bound.id;
      await this.worktrees.bindProject(project.id, bound.authorizationRef);
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
    const fromWorld = approval.artifactVersionId
      ? this.app.world.artifacts.get(approval.artifactVersionId)?.body
      : undefined;
    if (fromWorld !== undefined) {
      return fromWorld;
    }
    const content = approval.artifactVersionId
      ? this.findContent(undefined, approval.artifactVersionId)
      : undefined;
    if (content?.body) {
      try {
        return JSON.parse(new TextDecoder().decode(content.body)) as unknown;
      } catch {
        return { hash: content.hash };
      }
    }
    throw new AppError("validation_failed", "plan artifact is not available");
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
    if (this.liveRuntime) {
      const blocker = describeCodexHostBlocker();
      if (blocker) {
        throw new AppError("validation_failed", blocker);
      }
    }
    const runtimeId = project.runtimeId ?? (this.liveRuntime ? CODEX_RUNTIME_ID : MOCK_RUNTIME_ID);
    await this.policy.assertStartAllowed({
      runtime: runtimeId,
      resource: `runtime:${runtimeId}`,
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

  private async persistNewWorker(worker: WorkerDto, draft: WorkerDraftDto): Promise<void> {
    await this.sqlite.uow.withTransaction(async (tx) => {
      await this.sqlite.workers.insertIdentity(tx, worker, draft);
    });
  }

  private async persistWorkerIdentity(worker: WorkerDto): Promise<void> {
    const now = this.app.world.nowIso();
    await this.sqlite.uow.withTransaction(async () => {
      this.sqlite.connection
        .prepare(
          `UPDATE catalog_workers
              SET name = ?, description = ?, state_revision = ?, definition_revision = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          worker.name,
          worker.description ?? "",
          worker.stateRevision ?? 1,
          worker.definitionRevision ?? 1,
          now,
          worker.id,
        );
    });
  }

  private async syncWorkerIntoCatalog(workerId: string, draftId?: string): Promise<void> {
    const worker = await this.sqlite.workers.getWorker(workerId);
    if (!worker) {
      return;
    }
    const identity: WorkerDto = {
      id: worker.id,
      name: worker.name,
      protocolVersion: worker.protocolVersion,
      status: worker.status,
      ...(worker.description !== undefined ? { description: worker.description } : {}),
      ...(worker.activeVersionId !== undefined ? { activeVersionId: worker.activeVersionId } : {}),
      ...(worker.stateRevision !== undefined ? { stateRevision: worker.stateRevision } : {}),
      ...(worker.definitionRevision !== undefined
        ? { definitionRevision: worker.definitionRevision }
        : {}),
    };
    this.authoring.catalog.workers.set(worker.id, identity);
    for (const version of worker.versions ?? []) {
      this.authoring.catalog.workerVersions.set(version.id, version);
    }
    if (draftId !== undefined) {
      const draft = await this.sqlite.workers.getDraft(draftId);
      if (draft) {
        this.authoring.catalog.workerDrafts.set(draft.id, draft);
      }
    }
  }

  private chatClassifyContext(): {
    workers: WorkerDto[];
    projects: ProjectDto[];
    runs: RunDto[];
  } {
    return {
      workers: listedWorkers(this.authoring, { limit: 100 }).items,
      projects: [...this.app.world.projects.values()].map((record) => this.projectDto(record)),
      runs: [...this.app.world.runs.values()].map((record) => this.runDto(record)),
    };
  }

  private authoringUtteranceForTurn(sessionId: string, turnId: string): string | undefined {
    const view = this.authoringSessionView(sessionId);
    const content = view?.turns.find((turn) => turn.id === turnId)?.userMessage.content.trim();
    if (content === undefined || content.length === 0) {
      return undefined;
    }
    if (content.startsWith("[") && content.endsWith("]")) {
      return undefined;
    }
    return content;
  }

  private publishedTeamMembersFromUtterance(text: string | undefined): TeamMemberDto[] {
    if (text === undefined) {
      throw new AppError(
        "validation_failed",
        "authoring chat team confirmation requires the original utterance",
      );
    }
    const interpreted = interpretMockAuthoringIntent(text);
    if (interpreted.team === undefined || interpreted.team.members.length === 0) {
      throw new AppError(
        "validation_failed",
        "authoring chat team confirmation has no published workerVersionId members",
      );
    }
    const members = parseTeamVersionWrite({
      members: interpreted.team.members.map((member) => ({
        id: member.id,
        role: member.role,
        workerVersionId: member.workerVersionId,
        quantity: member.quantity,
      })),
    }).members;
    const unpublished = members.find((member) => {
      const version = this.authoring.catalog.findWorkerVersion(member.workerVersionId ?? "");
      return version === undefined || !isSelectableWorkerVersion(version);
    });
    if (unpublished !== undefined) {
      throw new AppError(
        "validation_failed",
        "authoring chat team confirmation requires published workerVersionId members",
      );
    }
    return members;
  }

  private taskPatchFromUtterance(
    text: string | undefined,
    taskId: string | undefined,
  ): AuthoringTaskPatch {
    if (text === undefined) {
      throw new AppError(
        "validation_failed",
        "authoring chat task confirmation requires the original utterance",
      );
    }
    const interpreted = interpretMockAuthoringIntent(text);
    const raw = mockTaskPatchFromInterpretation(interpreted);
    if (raw === undefined) {
      throw new AppError("validation_failed", "authoring chat task confirmation has no task patch");
    }
    const resolvedTaskId =
      taskId ?? (typeof raw.taskId === "string" && raw.taskId.length > 0 ? raw.taskId : undefined);
    if (resolvedTaskId === undefined) {
      throw new AppError(
        "validation_failed",
        "authoring chat task confirmation has no task identity",
      );
    }
    return parseAuthoringTaskPatch({ ...raw, taskId: resolvedTaskId });
  }

  private syncTeamDraftIntoCatalog(teamId: string): void {
    const identity = this.sqlite.catalogTeams.listAll().find((item) => item.id === teamId);
    if (identity) {
      this.authoring.catalog.teams.set(identity.id, identity);
    }
  }

  /** Catch-up query against the durable Event Store. Does not replay side effects. */
  private toEventReadQuery(query: EventListQuery, limit: number): EventReadQuery {
    const readQuery: EventReadQuery = {
      limit,
      afterIngestionPosition: query.afterIngestionPosition,
    };
    if (query.stream !== undefined) {
      readQuery.stream = query.stream;
    }
    if (query.projectId !== undefined) {
      readQuery.projectId = query.projectId;
    }
    if (query.runId !== undefined) {
      readQuery.runId = query.runId;
    }
    if (query.types !== undefined) {
      readQuery.types = query.types;
    }
    return readQuery;
  }

  private parseContinueDrafts<T>(
    items: readonly Record<string, unknown>[] | undefined,
    parse: (input: unknown) => T,
    field: string,
  ): T[] | undefined {
    if (items === undefined) {
      return undefined;
    }
    try {
      return items.map((item) => parse(item));
    } catch (error) {
      const message = error instanceof Error ? error.message : `${field} is malformed`;
      throw new AppError("validation_failed", message);
    }
  }

  private parseContinueTaskPatches(
    items: readonly Record<string, unknown>[] | undefined,
  ): AuthoringTaskPatch[] | undefined {
    if (items === undefined) {
      return undefined;
    }
    try {
      return items.map((item) => parseAuthoringTaskPatch(item as unknown as AuthoringTaskPatch));
    } catch (error) {
      if (error instanceof UseCaseError) {
        throw new AppError(error.code, error.message);
      }
      const message = error instanceof Error ? error.message : "taskPatches is malformed";
      throw new AppError("validation_failed", message);
    }
  }

  private requireSessionChangeSet(
    sessionId: string,
    changeSetId: string,
  ): { session: { id: string; projectId: string; stateRevision: number } } {
    const session = this.sqlite.authoringSessions.get(sessionId);
    if (!session) throw new AppError("not_found", "Authoring session not found");
    const owned = this.sqlite.connection
      .prepare(
        `SELECT id FROM authoring_turns WHERE session_id = ? AND change_set_id = ? LIMIT 1`,
      )
      .get(sessionId, changeSetId) as { id: string } | undefined;
    if (!owned) {
      throw new AppError("not_found", "Authoring change set not found in this session");
    }
    const stored = this.app.world.authoringChangeSets.get(changeSetId);
    if (!stored) {
      throw new AppError("not_found", "Authoring change set not found");
    }
    if (stored.projectId !== session.projectId) {
      throw new AppError(
        "validation_failed",
        "authoring change set does not belong to this session",
      );
    }
    return { session };
  }

  private async finishSessionChangeSet(
    sessionId: string,
    previousRevision: number,
    changeSet: AuthoringChangeSetDto,
  ): Promise<CommandResult<AuthoringChangeSetDto>> {
    await this.persistDurably();
    const now = this.app.world.nowIso();
    this.sqlite.connection
      .prepare(
        `UPDATE authoring_sessions SET state_revision = state_revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(now, sessionId);
    const current = this.sqlite.authoringSessions.get(sessionId);
    return {
      status: 200,
      body: changeSet,
      revision: current?.stateRevision ?? previousRevision + 1,
    };
  }

  private persist(): void {
    if (this.closed) {
      try {
        void this.writeSnapshot().catch((error) => this.reportPersistFailure(error));
      } catch (error) {
        this.reportPersistFailure(error);
      }
      return;
    }
    void this.writeSnapshot().catch((error) => this.reportPersistFailure(error));
  }

  /**
   * A swallowed SQLite projection failure makes world.json silently outrun the
   * entity tables that are the restart authority (D04). Persist stays
   * fire-and-forget for the request path, but the failure must be queryable.
   */
  private reportPersistFailure(error: unknown): void {
    console.error("[workforce] persist failed; SQLite entity tables may be stale", error);
    try {
      this.sqlite.projectionReconciliation.record({
        classification: "projection_failed",
        reason:
          error !== null && typeof error === "object" && "code" in error
            ? `projection failed: ${String((error as { code: unknown }).code)}`
            : error instanceof Error
              ? `projection failed: ${error.name}`
              : "projection failed",
        source: {
          errorName: error instanceof Error ? error.name : "Error",
          ...(error !== null && typeof error === "object" && "code" in error
            ? { errorCode: String((error as { code: unknown }).code) }
            : {}),
        },
      });
    } catch (ledgerError) {
      console.error("[workforce] persist failure could not be recorded", ledgerError);
    }
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
    const committed = this.sqliteWrite.then(async () => {
      await this.sqliteWriter(this.sqlite, world, this.synced, host.handles);
      // SQLite entity tables are the restart authority. Publishing the sidecar
      // only after that transaction commits prevents a failed projection from
      // leaving world.json ahead of its authoritative state.
      persistSnapshot(this.stateDir, { world, host });
    });
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
    if (project.executionSnapshotId !== undefined) {
      dto.executionSnapshotId = project.executionSnapshotId;
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
    const project = this.app.world.projects.get(run.projectId);
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
    } else if (project?.orchestrationMode !== undefined) {
      dto.orchestrationMode = project.orchestrationMode;
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

  private artifactTaskId(artifactId: string): string {
    for (const record of this.artifactContents.values()) {
      if (record.artifactId === artifactId && record.taskId) {
        return record.taskId;
      }
    }
    return "";
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

function authoringGraphDefinition() {
  return {
    entryNodeIds: ["authoring"],
    nodes: [
      {
        id: "authoring",
        kind: "task" as const,
        title: "Authoring workflow",
        role: "developer" as const,
        expectedOutputIds: [],
      },
    ],
    edges: [],
    failurePolicy: { default: "fail" as const },
    concurrencyPolicy: {
      runWorktree: "isolated" as const,
      integrationWorktree: "disabled" as const,
    },
  };
}

function workflowGraphFromUtterance(text: string | undefined) {
  if (text === undefined) {
    return authoringGraphDefinition();
  }
  return interpretMockAuthoringIntent(text).workflow?.graph ?? authoringGraphDefinition();
}

function mockTaskPatchFromInterpretation(
  interpreted: ReturnType<typeof interpretMockAuthoringIntent>,
): AuthoringTaskPatch | undefined {
  if (!("task" in interpreted)) {
    return undefined;
  }
  const value = (interpreted as { task?: unknown }).task;
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as AuthoringTaskPatch;
}

function chatProposalCreateTargets(proposal: AuthoringProposalDto): Array<{
  ordinal: number;
  targetType: "team" | "task" | "workflow";
  operation: "create";
  patchRef: string;
}> {
  const targets: Array<{
    ordinal: number;
    targetType: "team" | "task" | "workflow";
    operation: "create";
    patchRef: string;
  }> = [];
  for (const target of proposal.targets) {
    if (
      target.targetType !== "team" &&
      target.targetType !== "task" &&
      target.targetType !== "workflow"
    ) {
      continue;
    }
    targets.push({
      ordinal: targets.length + 1,
      targetType: target.targetType,
      operation: "create",
      patchRef: target.patchRef,
    });
  }
  return targets;
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

function engineGraphFromCatalog(version: WorkflowVersionRecord): WorkflowGraph | undefined {
  if (!isExecutableWorkflowVersion(version) || version.nodes.length === 0) {
    return undefined;
  }
  const graphInput: Parameters<typeof toEngineGraph>[0] = {
    id: version.id,
    workflowId: version.workflowId,
    versionLabel: version.version,
    nodes: version.nodes,
    edges: version.edges,
  };
  if (version.entry !== undefined) {
    graphInput.entry = version.entry;
  }
  return toEngineGraph(graphInput);
}

function toAuthoringChatTurn(record: {
  id: string;
  sessionId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  status: string;
  stateRevision: number;
  proposalId: string | null;
  changeSetId: string | null;
  workflowDraftId: string | null;
  completedOperationId: string | null;
  patchRefs: readonly string[];
  taskId: string | null;
}): AuthoringChatTurn {
  const turn: AuthoringChatTurn = {
    id: record.id,
    sessionId: record.sessionId,
    organizationId: record.organizationId,
    projectId: record.projectId,
    sourceRunId: record.sourceRunId,
    status: record.status as AuthoringChatTurn["status"],
    stateRevision: record.stateRevision,
    proposalId: record.proposalId,
    changeSetId: record.changeSetId,
    workflowDraftId: record.workflowDraftId,
    completedOperationId: record.completedOperationId,
    patchRefs: record.patchRefs,
  };
  if (record.taskId) {
    turn.taskId = record.taskId;
  }
  return turn;
}

function wrapError(error: unknown): unknown {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof PersistenceError) {
    const code =
      error.code === "constraint"
        ? "conflict"
        : error.code === "idempotency_key_reused"
          ? "conflict"
          : error.code;
    return new AppError(code, error.message);
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
  if (error instanceof RuntimeSdkError) {
    if (
      error.code === "validation_failed" ||
      error.code === "unsupported_capability" ||
      error.code === "not_found" ||
      error.code === "conflict" ||
      error.code === "idempotency_key_reused"
    ) {
      return new AppError(error.code, error.message);
    }
    return new AppError("validation_failed", error.message);
  }
  if (error instanceof WorkspaceError) {
    if (error.message === "unknown authorizationRef") {
      return new AppError("forbidden", "Workspace authorization is unknown");
    }
    return new AppError("validation_failed", error.message);
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

async function hydrateCatalog(sqlite: WorkforceSqlite, authoring: CatalogService): Promise<void> {
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
  let cursor: string | undefined;
  for (;;) {
    const page = await sqlite.workers.list({
      includeArchived: true,
      limit: 100,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    for (const worker of page.items) {
      const identity: WorkerDto = {
        id: worker.id,
        name: worker.name,
        protocolVersion: worker.protocolVersion,
        status: worker.status,
        ...(worker.description !== undefined ? { description: worker.description } : {}),
        ...(worker.activeVersionId !== undefined
          ? { activeVersionId: worker.activeVersionId }
          : {}),
        ...(worker.stateRevision !== undefined ? { stateRevision: worker.stateRevision } : {}),
        ...(worker.definitionRevision !== undefined
          ? { definitionRevision: worker.definitionRevision }
          : {}),
      };
      authoring.catalog.workers.set(worker.id, identity);
      for (const version of worker.versions ?? []) {
        authoring.catalog.workerVersions.set(version.id, version);
      }
    }
    if (!page.page.hasMore || page.page.nextCursor === null) {
      break;
    }
    cursor = page.page.nextCursor;
  }
  const draftRows = sqlite.connection
    .prepare("SELECT id FROM worker_drafts ORDER BY worker_id ASC, revision ASC")
    .all() as Record<string, unknown>[];
  for (const row of draftRows) {
    const draft = await sqlite.workers.getDraft(String(row.id));
    if (draft) {
      authoring.catalog.workerDrafts.set(draft.id, draft);
    }
  }
  seedPresetWorkerLibrary(authoring.catalog);
}

function workerDraftWriteFromProposal(
  redactedPreview: string | null | undefined,
): WorkerDraftWrite {
  const preview = redactedPreview?.trim() ?? "";
  if (preview.startsWith("{")) {
    try {
      const parsed = JSON.parse(preview) as Record<string, unknown>;
      return parseWorkerDraftWrite({
        ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
        ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
        ...(typeof parsed.role === "string" ? { role: parsed.role } : {}),
        ...(typeof parsed.runtimeProfileId === "string"
          ? { runtimeProfileId: parsed.runtimeProfileId }
          : {}),
        ...workerCardFieldsFrom({
          ...(typeof parsed.who === "string" ? { who: parsed.who } : {}),
          ...(typeof parsed.how === "string" ? { how: parsed.how } : {}),
          ...(typeof parsed.skills === "string" ? { skills: parsed.skills } : {}),
        }),
      });
    } catch {
      // Fall through to the unpublished stub write.
    }
  }
  return parseWorkerDraftWrite({
    name: preview.length > 0 && preview.length <= 120 ? preview : "Untitled worker",
    role: "worker",
  });
}
