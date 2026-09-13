import { ID_PREFIX } from "@workforce/domain";
import {
  parseAuthoringTurnActionCommand,
  parseAuthoringProposal,
  parseAuthoringChangeSet,
  parseWorkflowGraphDefinition,
  parseTeamDraft,
  parseTeamVersionWrite,
  parseWorker,
  parseWorkerDraft,
  parseWorkerDraftWrite,
  parseWorkflowDraft,
  type AuthoringProposalTargetInput,
  type TeamMemberDto,
  type AuthoringTurnActionCommand,
  type AuthoringChangeSetDto,
  type AuthoringProposalDto,
  type CommandReceipt,
  type ProtocolError,
  type TeamDraftDto,
  type WorkerDraftWrite,
  type WorkflowGraphDefinitionDto,
  type WorkflowDraftDto,
} from "@workforce/protocol";

import type {
  Clock,
  EventStore,
  IdGenerator,
  Tx,
  UnitOfWork,
  WorkerLibraryRepository,
} from "../../ports/index.js";
import type { AppContext } from "../projects/context.js";
import { notFound, revisionConflict, UseCaseError, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { requireProject } from "../projects/projects.js";
import { startRun } from "../runs/runs.js";
import type { TeamDefinitionRecord, WorkflowDefinitionRecord } from "../catalog/types.js";
import type { TaskRecord } from "../projects/store.js";
import { sha256CanonicalDigest } from "./canonical-digest.js";
import { authoringProtectedEventData, storeAuthoringIntent } from "./protected-content.js";

export interface AuthoringTaskPatch {
  taskId: string;
  revision: number;
  title?: string;
  role?: TaskRecord["role"];
  requiresReview?: boolean;
  expectedOutputs?: TaskRecord["expectedOutputs"];
  dependsOn?: TaskRecord["dependsOn"];
  maxAttempts?: number;
  maxReworkCycles?: number;
  priority?: number;
}

export interface ApplyAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSet: AuthoringChangeSetDto;
  workflowDrafts?: readonly WorkflowDraftDto[];
  teamDrafts?: readonly TeamDraftDto[];
  taskPatches?: readonly AuthoringTaskPatch[];
}

export interface StartAuthoringInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  /** Used only for Runtime invocation; never copied to events, ChangeSets, or drafts. */
  intent: string;
}

export interface StartAuthoringResult {
  reused: boolean;
  taskId: string;
  runId: string;
  intentRef: string;
  intentHash: string;
  /**
   * `authoring.start` only requests a Runtime. Intent is handed off
   * transiently; this flag stays false so callers cannot treat Task/Run
   * creation as Agent receipt.
   */
  agentReceivedIntent: false;
}

export interface RecordAuthoringProposalInput {
  operationId: string;
  idempotencyKey: string;
  proposal: AuthoringProposalDto;
}

export interface ValidateAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSetId: string;
}

/** A proof returned with a canonical graph by the trusted proposal authority. */
export interface AuthoringChatBindingProof {
  organizationId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  sourceRunId: string;
  patchRef: string;
  workflowId?: string;
  teamId?: string;
  taskId?: string;
  workerId?: string;
  expectedRevision?: number;
}

/**
 * The only trusted boundary that can turn a proposal patch reference into a
 * canonical graph. Resolution is intentionally outside the database
 * transaction. The returned proof is treated as untrusted input and checked
 * again by the transactional readers below.
 */
export interface AuthoringChatProposalResolver {
  resolveWorkflowGraph(input: {
    proposalId: string;
    projectId: string;
    sourceRunId: string;
    operation: "create" | "update";
    patchRef: string;
    workflowId?: string;
    expectedRevision?: number;
  }):
    | Promise<{ graph: WorkflowGraphDefinitionDto; binding: AuthoringChatBindingProof }>
    | { graph: WorkflowGraphDefinitionDto; binding: AuthoringChatBindingProof };
  resolveTeamDraft?(input: {
    proposalId: string;
    projectId: string;
    sourceRunId: string;
    operation: "create" | "update";
    patchRef: string;
    teamId?: string;
    expectedRevision?: number;
  }):
    | Promise<{ members: readonly TeamMemberDto[]; binding: AuthoringChatBindingProof }>
    | { members: readonly TeamMemberDto[]; binding: AuthoringChatBindingProof };
  resolveTaskPatch?(input: {
    proposalId: string;
    projectId: string;
    sourceRunId: string;
    operation: "create" | "update";
    patchRef: string;
    taskId?: string;
    expectedRevision?: number;
  }):
    | Promise<{ patch: AuthoringTaskPatch; binding: AuthoringChatBindingProof }>
    | { patch: AuthoringTaskPatch; binding: AuthoringChatBindingProof };
  /**
   * Resolves unpublished worker draft content. Confirm calls the library
   * write port; this resolver must not publish or persist.
   */
  resolveWorkerDraft?(input: {
    proposalId: string;
    projectId: string;
    sourceRunId: string;
    operation: "create" | "update";
    patchRef: string;
    workerId?: string;
    expectedRevision?: number;
  }):
    | Promise<{ write: WorkerDraftWrite; binding: AuthoringChatBindingProof }>
    | { write: WorkerDraftWrite; binding: AuthoringChatBindingProof };
}

export interface AuthoringChatProject {
  id: string;
  organizationId: string;
}

export interface AuthoringChatSourceRun {
  id: string;
  projectId: string;
  organizationId: string;
}

export interface AuthoringChatSession {
  id: string;
  organizationId: string;
  projectId: string;
  status: "open" | "failed" | "closed";
  stateRevision: number;
}

export interface AuthoringChatTurn {
  id: string;
  sessionId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  status:
    | "accepted"
    | "running"
    | "awaiting_confirmation"
    | "completed"
    | "failed"
    | "cancelled"
    | "closed";
  stateRevision: number;
  proposalId: string | null;
  changeSetId: string | null;
  workflowDraftId: string | null;
  /** Unpublished worker draft landed by confirm; never a published version. */
  workerDraftId?: string | null;
  completedOperationId: string | null;
  patchRefs: readonly string[];
  taskId?: string | null;
}

export type AuthoringChatProposalStatus = "proposed" | "confirmed" | "rejected" | "failed";

export type AuthoringChatProposalTarget = AuthoringProposalTargetInput & { ordinal: number };

export interface AuthoringChatProposalRecord {
  id: string;
  sessionId: string;
  turnId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  proposalRef: string;
  proposalHash: string;
  status: AuthoringChatProposalStatus;
  stateRevision: number;
  targets: readonly AuthoringChatProposalTarget[];
}

export interface AuthoringChatPatchBinding {
  patchRef: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  sourceRunId: string;
}

/** All authority-sensitive reads must use the transaction passed by UoW. */
export interface AuthoringChatProjectRepository {
  getInTransaction(
    tx: Tx,
    projectId: string,
  ): Promise<AuthoringChatProject | null> | AuthoringChatProject | null;
}

export interface AuthoringChatSourceRunRepository {
  getInTransaction(
    tx: Tx,
    sourceRunId: string,
  ): Promise<AuthoringChatSourceRun | null> | AuthoringChatSourceRun | null;
}

export interface AuthoringChatSessionRepository {
  getInTransaction(
    tx: Tx,
    sessionId: string,
  ): Promise<AuthoringChatSession | null> | AuthoringChatSession | null;
}

export interface AuthoringChatTurnRepository {
  getInTransaction(
    tx: Tx,
    turnId: string,
  ): Promise<AuthoringChatTurn | null> | AuthoringChatTurn | null;
  completeInTransaction(
    tx: Tx,
    input: {
      turnId: string;
      expectedStateRevision: number;
      idempotencyKey: string;
      proposalId?: string;
      changeSetId?: string;
      workflowDraftId?: string;
      workerDraftId?: string;
      at: string;
    },
  ): Promise<AuthoringChatTurn> | AuthoringChatTurn;
}

export interface AuthoringChatProposalRepository {
  getInTransaction(
    tx: Tx,
    proposalId: string,
  ): Promise<AuthoringChatProposalRecord | null> | AuthoringChatProposalRecord | null;
}

export interface AuthoringChatPatchRepository {
  getInTransaction(
    tx: Tx,
    patchRef: string,
  ): Promise<AuthoringChatPatchBinding | null> | AuthoringChatPatchBinding | null;
}

/** Chat-specific alias prevents legacy idempotency helpers from changing semantics. */
export interface AuthoringChatReceiptRepository {
  get(scope: CommandReceipt["scope"]): Promise<CommandReceipt | null>;
  putPending(tx: Tx, receipt: CommandReceipt): Promise<void> | void;
  complete(tx: Tx, operationId: string, result: unknown): Promise<void> | void;
  fail(tx: Tx, operationId: string, error: ProtocolError): Promise<void> | void;
}

export interface AuthoringWorkflowIdentityRepository {
  create(tx: Tx, workflow: WorkflowDefinitionRecord): Promise<void> | void;
}

export interface AuthoringWorkflowAuthorityRepository {
  create(
    tx: Tx,
    input: {
      workflowId: string;
      organizationId: string;
      projectId: string;
      createdAt: string;
      createdBy: string;
    },
  ): Promise<void> | void;
  requireInTransaction(
    tx: Tx,
    workflowId: string,
    expected: { organizationId: string; projectId: string },
  ): Promise<unknown> | unknown;
}

/** DB009's append-only revision/CAS repository is a direct implementation. */
export interface AuthoringWorkflowDraftRepository {
  getCurrentRevision(
    tx: Tx,
    workflowId: string,
    expected: { organizationId: string; projectId: string },
  ): Promise<number> | number;
  append(
    tx: Tx,
    draft: WorkflowDraftDto,
    expectedRevision: number,
    expected: { organizationId: string; projectId: string },
  ): Promise<void> | void;
}

export interface AuthoringTeamIdentityRepository {
  create(tx: Tx, team: TeamDefinitionRecord): Promise<void> | void;
}

export interface AuthoringTeamDraftRepository {
  getCurrentRevision(tx: Tx, teamId: string): Promise<number> | number;
  append(tx: Tx, draft: TeamDraftDto, expectedRevision: number): Promise<void> | void;
}

export interface AuthoringTaskPatchTarget {
  id: string;
  projectId: string;
  definitionRevision: number;
}

export interface AuthoringTaskPatchRepository {
  getInTransaction(
    tx: Tx,
    taskId: string,
  ): Promise<AuthoringTaskPatchTarget | null> | AuthoringTaskPatchTarget | null;
  applyInTransaction(
    tx: Tx,
    input: {
      taskId: string;
      expectedRevision: number;
      patch: AuthoringTaskPatch;
      at: string;
    },
  ): Promise<AuthoringTaskPatchTarget> | AuthoringTaskPatchTarget;
}

export interface ConfirmChatProposalDeps {
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  events: EventStore;
  receipts: AuthoringChatReceiptRepository;
  projects: AuthoringChatProjectRepository;
  sourceRuns: AuthoringChatSourceRunRepository;
  sessions: AuthoringChatSessionRepository;
  turns: AuthoringChatTurnRepository;
  patches: AuthoringChatPatchRepository;
  workflowIdentities: AuthoringWorkflowIdentityRepository;
  workflowAuthorities: AuthoringWorkflowAuthorityRepository;
  workflowDrafts: AuthoringWorkflowDraftRepository;
  teamIdentities?: AuthoringTeamIdentityRepository;
  teamDrafts?: AuthoringTeamDraftRepository;
  tasks?: AuthoringTaskPatchRepository;
  /**
   * T02 WorkerLibraryRepository write entry. Confirm creates unpublished
   * drafts through insertIdentity/saveDraft and never calls publishVersion.
   */
  workerLibrary?: WorkerLibraryRepository;
  proposals: AuthoringChatProposalRepository;
  resolver: AuthoringChatProposalResolver;
  principalId: string;
  clientId: string;
}

export type ConfirmChatProposalCommand = Extract<AuthoringTurnActionCommand, { action: "confirm" }>;

/** Source-compatible name retained for callers migrating to the explicit deps API. */
export type ConfirmAuthoringChatProposalInput = ConfirmChatProposalCommand;

export interface ConfirmedAuthoringWorkflowDraftRef {
  targetType: "workflow";
  workflowId: string;
  workflowDraftId: string;
  revision: number;
}

export interface ConfirmedAuthoringTeamDraftRef {
  targetType: "team";
  teamId: string;
  teamDraftId: string;
  revision: number;
}

export interface ConfirmedAuthoringTaskPatchRef {
  targetType: "task";
  taskId: string;
  definitionRevision: number;
}

export interface ConfirmedAuthoringWorkerDraftRef {
  targetType: "worker";
  workerId: string;
  workerDraftId: string;
  revision: number;
}

export interface ConfirmAuthoringChatProposalResult {
  reused: boolean;
  proposalId: string;
  projectId: string;
  workflowDrafts: readonly ConfirmedAuthoringWorkflowDraftRef[];
  teamDrafts: readonly ConfirmedAuthoringTeamDraftRef[];
  taskPatches: readonly ConfirmedAuthoringTaskPatchRef[];
  workerDrafts: readonly ConfirmedAuthoringWorkerDraftRef[];
}

/**
 * Creates the governed Task/Run that a Runtime adapter uses for authoring.
 * The intent remains transient in process memory. Completing this command is
 * not Agent receipt: adapters must deliver the body via a short-lived
 * handoff, and restart without that body fail-closes.
 */
export async function startAuthoring(
  ctx: AppContext,
  input: StartAuthoringInput,
): Promise<StartAuthoringResult> {
  if (input.intent.trim() === "") {
    throw validationFailed("authoring intent is required");
  }
  const intentHash = sha256CanonicalDigest(input.intent);
  const taskResult = await ctx.world.uow.withTransaction(async (tx) =>
    withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ projectId: input.projectId, intentHash }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.start",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProject(ctx, input.projectId);
        const now = ctx.world.nowIso();
        const taskId = ctx.world.ids.ulid("tsk_");
        const intent = storeAuthoringIntent(ctx.world, { taskId, intent: input.intent });
        ctx.world.tasks.set(taskId, {
          id: taskId,
          projectId: project.id,
          role: "planner",
          title: "Authoring proposal",
          status: "ready",
          stateRevision: 1,
          definitionRevision: 1,
          generation: 1,
          attempt: 1,
          maxAttempts: 1,
          maxReworkCycles: 0,
          priority: 0,
          requiresReview: false,
          expectedOutputs: [],
          outputBindings: {},
          dependsOn: [],
          inputArtifactVersionIds: [],
          createdAt: now,
          updatedAt: now,
        });
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.started",
          subjectType: "task",
          subjectId: taskId,
          projectId: project.id,
          taskId,
          correlationId: input.operationId,
          data: {
            phase: "runtime_requested",
            agentReceivedIntent: false,
            ...authoringProtectedEventData(intent),
          },
        });
        return {
          taskId,
          intentRef: intent.contentRef,
          intentHash: intent.contentHash,
        };
      },
    ),
  );
  const run = await startRun(ctx, {
    operationId: `${input.operationId}:run`,
    idempotencyKey: `${input.idempotencyKey}:run`,
    taskId: taskResult.value.taskId,
    snapshotRef: "authoring:proposal",
  });
  return {
    reused: taskResult.reused && run.reused,
    taskId: taskResult.value.taskId,
    runId: run.run.id,
    intentRef: taskResult.value.intentRef,
    intentHash: taskResult.value.intentHash,
    agentReceivedIntent: false,
  };
}

/**
 * Confirms a trusted conversational proposal into unpublished drafts.
 *
 * `create_workflow` still lands only WorkflowDraft. `targetType=worker`
 * calls the library write port and returns an unpublished workerDraftId.
 * Resolver work happens before the write transaction. Completing a turn is
 * not Task/Run completion, and confirm never publishes.
 */
export async function confirmAuthoringChatProposal(
  input: ConfirmChatProposalCommand,
  deps: ConfirmChatProposalDeps,
): Promise<ConfirmAuthoringChatProposalResult> {
  const command = parseAuthoringTurnActionCommand(input);
  if (command.action !== "confirm") {
    throw validationFailed("authoring turn action must be confirm");
  }
  const proposalDigest = sha256CanonicalDigest({
    action: "confirm",
    sessionId: command.sessionId,
    turnId: command.turnId,
    expectedRevision: command.expectedRevision,
  });
  const scope = {
    principalId: deps.principalId,
    clientId: deps.clientId,
    canonicalOperation: "authoring.confirm-chat-proposal",
    resource: `authoring-turn:${command.sessionId}:${command.turnId}`,
    idempotencyKey: command.idempotencyKey,
  } as const;

  const existing = await deps.receipts.get(scope);
  const replay = readChatReceipt(existing, proposalDigest);
  if (replay) {
    const context = await loadChatConfirmationContext(deps, command, { allowCompleted: true });
    assertStoredChatResultBinding(replay, context);
    return replay;
  }

  let prepared: ChatConfirmationContext;
  try {
    prepared = await deps.uow.withTransaction((tx) =>
      loadChatConfirmationContextInTransaction(deps, tx, command, { allowCompleted: false }),
    );
    await deps.uow.withTransaction(async (tx) => {
      const inTransaction = await deps.receipts.get(scope);
      const transactionReplay = readChatReceipt(inTransaction, proposalDigest);
      if (transactionReplay) {
        throw new ReceiptReplay(transactionReplay);
      }
      await deps.receipts.putPending(tx, {
        operationId: command.operationId,
        status: "pending",
        scope,
        requestDigest: proposalDigest,
        acceptedAt: deps.clock.now().toISOString(),
      });
    });
  } catch (error) {
    if (error instanceof ReceiptReplay) return error.result;
    await persistChatFailure(deps, input, scope, proposalDigest, error);
    throw error;
  }

  let resolved: ResolvedChatTarget[];
  try {
    resolved = await resolveChatTargets(deps, prepared);
  } catch (error) {
    await persistChatFailure(deps, input, scope, proposalDigest, error);
    throw error;
  }

  try {
    return await deps.uow.withTransaction(async (tx) => {
      const inTransaction = await deps.receipts.get(scope);
      const transactionReplay = readChatReceiptForContinuation(
        inTransaction,
        proposalDigest,
        command.operationId,
      );
      if (transactionReplay) {
        const context = await loadChatConfirmationContextInTransaction(deps, tx, command, {
          allowCompleted: true,
        });
        assertStoredChatResultBinding(transactionReplay, context);
        return transactionReplay;
      }

      const context = await loadChatConfirmationContextInTransaction(deps, tx, command, {
        allowCompleted: false,
      });
      const workflowDrafts: Array<{ draft: WorkflowDraftDto; expectedRevision: number }> = [];
      const teamDrafts: Array<{ draft: TeamDraftDto; expectedRevision: number }> = [];
      const workerDrafts: ConfirmedAuthoringWorkerDraftRef[] = [];
      const taskPatches: ConfirmedAuthoringTaskPatchRef[] = [];

      for (const target of resolved) {
        await assertResolutionBinding(deps, tx, context, target);
        if (target.kind === "workflow") {
          workflowDrafts.push(await landChatWorkflowDraft(deps, tx, context, target));
        } else if (target.kind === "team") {
          teamDrafts.push(await landChatTeamDraft(deps, tx, context, target));
        } else if (target.kind === "worker") {
          workerDrafts.push(await landChatWorkerDraft(deps, tx, target));
        } else {
          taskPatches.push(await landChatTaskPatch(deps, tx, context, target));
        }
      }

      for (const item of workflowDrafts) {
        await deps.workflowDrafts.append(tx, item.draft, item.expectedRevision, {
          organizationId: context.project.organizationId,
          projectId: context.project.id,
        });
      }
      const teamPorts = teamDrafts.length > 0 ? requireTeamPorts(deps) : undefined;
      if (teamPorts) {
        for (const item of teamDrafts) {
          await teamPorts.drafts.append(tx, item.draft, item.expectedRevision);
        }
      }

      const workflowRefs = workflowDrafts.map(({ draft }) => ({
        targetType: "workflow" as const,
        workflowId: draft.workflowId,
        workflowDraftId: draft.id,
        revision: draft.revision,
      }));
      const teamRefs = teamDrafts.map(({ draft }) => ({
        targetType: "team" as const,
        teamId: draft.teamId,
        teamDraftId: draft.id,
        revision: draft.revision,
      }));
      const result: ConfirmAuthoringChatProposalResult = {
        reused: false,
        proposalId: context.proposal.id,
        projectId: context.project.id,
        workflowDrafts: workflowRefs,
        teamDrafts: teamRefs,
        taskPatches,
        workerDrafts,
      };
      try {
        await deps.turns.completeInTransaction(tx, {
          turnId: context.turn.id,
          expectedStateRevision: command.expectedRevision,
          idempotencyKey: command.idempotencyKey,
          proposalId: context.proposal.id,
          at: deps.clock.now().toISOString(),
          ...(workflowRefs[0] ? { workflowDraftId: workflowRefs[0].workflowDraftId } : {}),
          ...(workerDrafts[0] ? { workerDraftId: workerDrafts[0].workerDraftId } : {}),
        });
      } catch (error) {
        if (isRevisionConflict(error)) {
          throw revisionConflict(
            context.turn.id,
            command.expectedRevision,
            context.turn.stateRevision,
          );
        }
        throw error;
      }
      await deps.events.append(
        tx,
        chatConfirmedEvent({
          id: deps.ids.ulid("evt_"),
          now: deps.clock.now().toISOString(),
          operationId: command.operationId,
          principalId: deps.principalId,
          organizationId: context.project.organizationId,
          projectId: context.project.id,
          sourceRunId: context.sourceRun.id,
          proposalId: context.proposal.id,
          proposalDigest,
          workflowDrafts: workflowRefs,
          teamDrafts: teamRefs,
          taskPatches,
          workerDrafts,
        }),
      );
      await deps.receipts.complete(tx, command.operationId, storedChatResult(result));
      return result;
    });
  } catch (error) {
    await persistChatFailure(deps, input, scope, proposalDigest, error);
    throw error;
  }
}

class ReceiptReplay extends Error {
  constructor(readonly result: ConfirmAuthoringChatProposalResult) {
    super("authoring chat receipt replay");
  }
}

interface ChatConfirmationContext {
  project: AuthoringChatProject;
  sourceRun: AuthoringChatSourceRun;
  session: AuthoringChatSession;
  turn: AuthoringChatTurn;
  proposal: AuthoringChatProposalRecord;
}

async function loadChatConfirmationContext(
  deps: ConfirmChatProposalDeps,
  command: ConfirmChatProposalCommand,
  options: { allowCompleted: boolean },
): Promise<ChatConfirmationContext> {
  return deps.uow.withTransaction((tx) =>
    loadChatConfirmationContextInTransaction(deps, tx, command, options),
  );
}

async function loadChatConfirmationContextInTransaction(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  command: ConfirmChatProposalCommand,
  options: { allowCompleted: boolean },
): Promise<ChatConfirmationContext> {
  const session = await deps.sessions.getInTransaction(tx, command.sessionId);
  if (!session) throw notFound("authoring session", command.sessionId);
  const turn = await deps.turns.getInTransaction(tx, command.turnId);
  if (!turn) throw notFound("authoring turn", command.turnId);
  if (turn.sessionId !== session.id) {
    throw validationFailed("authoring turn does not belong to the session");
  }
  if (!options.allowCompleted && turn.stateRevision !== command.expectedRevision) {
    throw revisionConflict(turn.id, command.expectedRevision, turn.stateRevision);
  }
  if (!options.allowCompleted) {
    if (session.status !== "open") {
      throw validationFailed("authoring session is not open", { status: session.status });
    }
    if (turn.status !== "awaiting_confirmation" || turn.completedOperationId !== null) {
      throw validationFailed("authoring turn is not awaiting confirmation", {
        status: turn.status,
      });
    }
  } else if (turn.status !== "completed") {
    throw validationFailed("authoring turn is not completed for receipt replay", {
      status: turn.status,
    });
  } else if (turn.completedOperationId !== command.idempotencyKey) {
    throw validationFailed("authoring turn was completed with a different idempotency key", {
      status: turn.status,
    });
  }

  const project = await deps.projects.getInTransaction(tx, session.projectId);
  if (!project) throw notFound("project", session.projectId);
  const sourceRun = await deps.sourceRuns.getInTransaction(tx, turn.sourceRunId);
  if (!sourceRun) throw notFound("source run", turn.sourceRunId);
  if (!turn.proposalId) throw validationFailed("authoring turn has no proposal");
  const proposal = await deps.proposals.getInTransaction(tx, turn.proposalId);
  if (!proposal) throw notFound("authoring proposal", turn.proposalId);
  assertChatBinding({ proposal, project, sourceRun, session, turn });
  for (const target of proposal.targets) {
    const patch = await deps.patches.getInTransaction(tx, target.patchRef);
    if (!patch) throw notFound("authoring proposal patch", target.patchRef);
    assertPatchBinding(patch, proposal);
  }
  return { project, sourceRun, session, turn, proposal };
}

function assertStoredChatResultBinding(
  result: ConfirmAuthoringChatProposalResult,
  context: ChatConfirmationContext,
): void {
  if (result.proposalId !== context.proposal.id || result.projectId !== context.project.id) {
    throw new UseCaseError("conflict", "authoring chat committed receipt binding is malformed");
  }
}

interface ResolvedChatWorkflowTarget {
  kind: "workflow";
  operation: "create" | "update";
  graph: WorkflowGraphDefinitionDto;
  binding: AuthoringChatBindingProof;
  patchRef: string;
  workflowId?: string;
  expectedRevision?: number;
}

interface ResolvedChatTeamTarget {
  kind: "team";
  operation: "create" | "update";
  members: readonly TeamMemberDto[];
  binding: AuthoringChatBindingProof;
  patchRef: string;
  teamId?: string;
  expectedRevision?: number;
}

interface ResolvedChatTaskTarget {
  kind: "task";
  operation: "create" | "update";
  patch: AuthoringTaskPatch;
  binding: AuthoringChatBindingProof;
  patchRef: string;
  taskId?: string;
  expectedRevision?: number;
}

interface ResolvedChatWorkerTarget {
  kind: "worker";
  operation: "create" | "update";
  write: WorkerDraftWrite;
  binding: AuthoringChatBindingProof;
  patchRef: string;
  workerId?: string;
  expectedRevision?: number;
}

type ResolvedChatTarget =
  | ResolvedChatWorkflowTarget
  | ResolvedChatTeamTarget
  | ResolvedChatTaskTarget
  | ResolvedChatWorkerTarget;

async function resolveChatTargets(
  deps: ConfirmChatProposalDeps,
  context: ChatConfirmationContext,
): Promise<ResolvedChatTarget[]> {
  const resolved: ResolvedChatTarget[] = [];
  for (const target of context.proposal.targets) {
    if (target.targetType === "workflow") {
      const resolution = await deps.resolver.resolveWorkflowGraph({
        proposalId: context.proposal.id,
        projectId: context.proposal.projectId,
        sourceRunId: context.proposal.sourceRunId,
        operation: target.operation,
        patchRef: target.patchRef,
        ...(target.operation === "update"
          ? { workflowId: target.targetId, expectedRevision: target.expectedRevision }
          : {}),
      });
      resolved.push({
        kind: "workflow",
        operation: target.operation,
        graph: parseWorkflowGraphDefinition(resolution.graph),
        binding: resolution.binding,
        patchRef: target.patchRef,
        ...(target.operation === "update"
          ? { workflowId: target.targetId, expectedRevision: target.expectedRevision }
          : {}),
      });
      continue;
    }
    if (target.targetType === "team") {
      if (!deps.resolver.resolveTeamDraft) {
        throw validationFailed("authoring chat team confirmation requires a team draft resolver");
      }
      requireTeamPorts(deps);
      const resolution = await deps.resolver.resolveTeamDraft({
        proposalId: context.proposal.id,
        projectId: context.proposal.projectId,
        sourceRunId: context.proposal.sourceRunId,
        operation: target.operation,
        patchRef: target.patchRef,
        ...(target.operation === "update"
          ? { teamId: target.targetId, expectedRevision: target.expectedRevision }
          : {}),
      });
      const members = parseTeamVersionWrite({ members: resolution.members }).members;
      resolved.push({
        kind: "team",
        operation: target.operation,
        members,
        binding: resolution.binding,
        patchRef: target.patchRef,
        ...(target.operation === "update"
          ? { teamId: target.targetId, expectedRevision: target.expectedRevision }
          : {}),
      });
      continue;
    }
    if (target.targetType === "worker") {
      if (!deps.resolver.resolveWorkerDraft) {
        throw validationFailed(
          "authoring chat worker confirmation requires a worker draft resolver",
        );
      }
      requireWorkerLibrary(deps);
      const resolution = await deps.resolver.resolveWorkerDraft({
        proposalId: context.proposal.id,
        projectId: context.proposal.projectId,
        sourceRunId: context.proposal.sourceRunId,
        operation: target.operation,
        patchRef: target.patchRef,
        ...(target.operation === "update"
          ? { workerId: target.targetId, expectedRevision: target.expectedRevision }
          : {}),
      });
      resolved.push({
        kind: "worker",
        operation: target.operation,
        write: parseWorkerDraftWrite(resolution.write),
        binding: resolution.binding,
        patchRef: target.patchRef,
        ...(target.operation === "update"
          ? { workerId: target.targetId, expectedRevision: target.expectedRevision }
          : {}),
      });
      continue;
    }
    if (!deps.resolver.resolveTaskPatch || !deps.tasks) {
      throw validationFailed("authoring chat task confirmation requires a task patch resolver");
    }
    const resolution = await deps.resolver.resolveTaskPatch({
      proposalId: context.proposal.id,
      projectId: context.proposal.projectId,
      sourceRunId: context.proposal.sourceRunId,
      operation: target.operation,
      patchRef: target.patchRef,
      ...(target.operation === "update"
        ? { taskId: target.targetId, expectedRevision: target.expectedRevision }
        : {}),
    });
    resolved.push({
      kind: "task",
      operation: target.operation,
      patch: parseAuthoringTaskPatch(resolution.patch),
      binding: resolution.binding,
      patchRef: target.patchRef,
      ...(target.operation === "update"
        ? { taskId: target.targetId, expectedRevision: target.expectedRevision }
        : {}),
    });
  }
  return resolved;
}

async function landChatWorkflowDraft(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  context: ChatConfirmationContext,
  target: ResolvedChatWorkflowTarget,
): Promise<{ draft: WorkflowDraftDto; expectedRevision: number }> {
  const workflowId = target.operation === "create" ? deps.ids.ulid("wf_") : target.workflowId;
  if (!workflowId) {
    throw validationFailed("authoring update target has no workflow identity");
  }
  let expectedRevision = 0;
  if (target.operation === "create") {
    const now = deps.clock.now().toISOString();
    await deps.workflowIdentities.create(tx, {
      id: workflowId,
      name: "Untitled workflow",
      description: "",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
    await deps.workflowAuthorities.create(tx, {
      workflowId,
      organizationId: context.project.organizationId,
      projectId: context.project.id,
      createdAt: now,
      createdBy: deps.principalId,
    });
  } else {
    await deps.workflowAuthorities.requireInTransaction(tx, workflowId, {
      organizationId: context.project.organizationId,
      projectId: context.project.id,
    });
  }
  const expectedScope = {
    organizationId: context.project.organizationId,
    projectId: context.project.id,
  };
  const currentRevision = await deps.workflowDrafts.getCurrentRevision(
    tx,
    workflowId,
    expectedScope,
  );
  if (target.operation === "update") {
    expectedRevision = target.expectedRevision ?? -1;
    if (currentRevision !== expectedRevision) {
      throw revisionConflict(workflowId, expectedRevision, currentRevision);
    }
  } else if (currentRevision !== 0) {
    throw validationFailed(`new authoring workflow ${workflowId} already has a draft`, {
      currentRevision,
    });
  }
  return {
    draft: parseWorkflowDraft({
      id: deps.ids.ulid("wfd_"),
      workflowId,
      revision: currentRevision + 1,
      status: "draft",
      graph: target.graph,
      contentHash: sha256CanonicalDigest(target.graph),
      updatedAt: deps.clock.now().toISOString(),
      updatedBy: deps.principalId,
    }),
    expectedRevision,
  };
}

async function landChatTeamDraft(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  _context: ChatConfirmationContext,
  target: ResolvedChatTeamTarget,
): Promise<{ draft: TeamDraftDto; expectedRevision: number }> {
  const ports = requireTeamPorts(deps);
  const teamId = target.operation === "create" ? deps.ids.ulid("tm_") : target.teamId;
  if (!teamId) {
    throw validationFailed("authoring update target has no team identity");
  }
  let expectedRevision = 0;
  if (target.operation === "create") {
    const now = deps.clock.now().toISOString();
    await ports.identities.create(tx, {
      id: teamId,
      name: "Untitled team",
      description: "",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
  const currentRevision = await ports.drafts.getCurrentRevision(tx, teamId);
  if (target.operation === "update") {
    expectedRevision = target.expectedRevision ?? -1;
    if (currentRevision !== expectedRevision) {
      throw revisionConflict(teamId, expectedRevision, currentRevision);
    }
  } else if (currentRevision !== 0) {
    throw validationFailed(`new authoring team ${teamId} already has a draft`, {
      currentRevision,
    });
  }
  return {
    draft: parseTeamDraft({
      id: deps.ids.ulid("tmd_"),
      teamId,
      revision: currentRevision + 1,
      status: "draft",
      members: [...target.members],
      contentHash: sha256CanonicalDigest(target.members),
      updatedAt: deps.clock.now().toISOString(),
      updatedBy: deps.principalId,
    }),
    expectedRevision,
  };
}

async function landChatWorkerDraft(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  target: ResolvedChatWorkerTarget,
): Promise<ConfirmedAuthoringWorkerDraftRef> {
  const library = requireWorkerLibrary(deps);
  const workerId =
    target.operation === "create" ? deps.ids.ulid(ID_PREFIX.worker) : target.workerId;
  if (!workerId) {
    throw validationFailed("authoring update target has no worker identity");
  }
  const name = target.write.name?.trim() || "Untitled worker";
  const role = target.write.role?.trim() ?? "";
  if (role.length === 0) {
    throw validationFailed("authoring worker draft requires a role");
  }
  const now = deps.clock.now().toISOString();
  let expectedRevision = 0;
  if (target.operation === "update") {
    const existing = await library.getWorker(workerId);
    if (!existing) throw notFound("worker", workerId);
    expectedRevision = target.expectedRevision ?? -1;
  }
  const draft = parseWorkerDraft({
    id: deps.ids.ulid(ID_PREFIX.workerDraft),
    workerId,
    revision: expectedRevision + 1,
    status: "draft",
    name,
    role,
    contentHash: sha256CanonicalDigest({
      name,
      role,
      description: target.write.description,
      runtimeProfileId: target.write.runtimeProfileId,
    }),
    updatedAt: now,
    updatedBy: deps.principalId,
    ...(target.write.description !== undefined ? { description: target.write.description } : {}),
    ...(target.write.runtimeProfileId !== undefined
      ? { runtimeProfileId: target.write.runtimeProfileId }
      : {}),
  });
  if (target.operation === "create") {
    const worker = parseWorker({
      id: workerId,
      name,
      protocolVersion: "0.1",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      ...(target.write.description !== undefined ? { description: target.write.description } : {}),
    });
    await library.insertIdentity(tx, worker, draft);
  } else {
    await library.saveDraft(tx, draft, expectedRevision);
  }
  return {
    targetType: "worker",
    workerId,
    workerDraftId: draft.id,
    revision: draft.revision,
  };
}

async function landChatTaskPatch(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  context: ChatConfirmationContext,
  target: ResolvedChatTaskTarget,
): Promise<ConfirmedAuthoringTaskPatchRef> {
  if (!deps.tasks) {
    throw validationFailed("authoring chat task confirmation requires a task patch repository");
  }
  const taskId = target.operation === "update" ? target.taskId : target.patch.taskId;
  if (!taskId) {
    throw validationFailed("authoring task patch has no task identity");
  }
  const current = await deps.tasks.getInTransaction(tx, taskId);
  if (!current) throw validationFailed(`missing task ${taskId} for authoring patch`);
  if (current.projectId !== context.project.id) {
    throw validationFailed("authoring task patch does not belong to the project");
  }
  const expectedRevision =
    target.operation === "update" ? (target.expectedRevision ?? -1) : current.definitionRevision;
  const applied = await deps.tasks.applyInTransaction(tx, {
    taskId,
    expectedRevision,
    patch: { ...target.patch, taskId },
    at: deps.clock.now().toISOString(),
  });
  return {
    targetType: "task",
    taskId,
    definitionRevision: applied.definitionRevision,
  };
}

function requireTeamPorts(deps: ConfirmChatProposalDeps): {
  identities: AuthoringTeamIdentityRepository;
  drafts: AuthoringTeamDraftRepository;
} {
  if (!deps.teamIdentities || !deps.teamDrafts) {
    throw validationFailed(
      "authoring chat team confirmation requires team identity and draft repositories",
    );
  }
  return { identities: deps.teamIdentities, drafts: deps.teamDrafts };
}

function requireWorkerLibrary(deps: ConfirmChatProposalDeps): WorkerLibraryRepository {
  if (!deps.workerLibrary) {
    throw validationFailed(
      "authoring chat worker confirmation requires a worker library repository",
    );
  }
  return deps.workerLibrary;
}

async function assertResolutionBinding(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  context: ChatConfirmationContext,
  target: ResolvedChatTarget,
): Promise<void> {
  const proof = target.binding;
  const identityMatches = resolutionIdentityMatches(target, proof);
  if (
    proof.organizationId !== context.project.organizationId ||
    proof.patchRef !== target.patchRef ||
    proof.projectId !== context.project.id ||
    proof.sessionId !== context.session.id ||
    proof.turnId !== context.turn.id ||
    proof.sourceRunId !== context.sourceRun.id ||
    !identityMatches
  ) {
    throw validationFailed("authoring proposal resolver binding proof does not match the request");
  }
  const patch = await deps.patches.getInTransaction(tx, proof.patchRef);
  if (
    !patch ||
    patch.patchRef !== proof.patchRef ||
    patch.organizationId !== proof.organizationId ||
    patch.projectId !== proof.projectId ||
    patch.sessionId !== proof.sessionId ||
    patch.turnId !== proof.turnId ||
    patch.sourceRunId !== proof.sourceRunId
  ) {
    throw validationFailed("authoring proposal patch is outside the confirmed chat turn");
  }
}

function resolutionIdentityMatches(
  target: ResolvedChatTarget,
  proof: AuthoringChatBindingProof,
): boolean {
  if (target.kind === "workflow") {
    return target.operation === "update"
      ? proof.workflowId === target.workflowId && proof.expectedRevision === target.expectedRevision
      : proof.workflowId === undefined && proof.expectedRevision === undefined;
  }
  if (target.kind === "team") {
    return target.operation === "update"
      ? proof.teamId === target.teamId && proof.expectedRevision === target.expectedRevision
      : proof.teamId === undefined && proof.expectedRevision === undefined;
  }
  if (target.kind === "worker") {
    return target.operation === "update"
      ? proof.workerId === target.workerId && proof.expectedRevision === target.expectedRevision
      : proof.workerId === undefined && proof.expectedRevision === undefined;
  }
  return target.operation === "update"
    ? proof.taskId === target.taskId && proof.expectedRevision === target.expectedRevision
    : proof.taskId === undefined && proof.expectedRevision === undefined;
}

function assertChatBinding(input: {
  proposal: AuthoringChatProposalRecord;
  project: AuthoringChatProject;
  sourceRun: AuthoringChatSourceRun;
  session: AuthoringChatSession;
  turn: AuthoringChatTurn;
}): void {
  const { proposal, project, sourceRun, session, turn } = input;
  if (project.id !== proposal.projectId) {
    throw validationFailed("authoring chat proposal project identity mismatch");
  }
  if (sourceRun.projectId !== project.id || sourceRun.organizationId !== project.organizationId) {
    throw validationFailed("authoring chat proposal source run does not belong to the project");
  }
  if (
    session.projectId !== project.id ||
    session.organizationId !== project.organizationId ||
    session.status !== "open"
  ) {
    throw validationFailed("authoring chat session does not belong to the project");
  }
  if (
    turn.sessionId !== session.id ||
    turn.organizationId !== project.organizationId ||
    turn.projectId !== project.id ||
    turn.sourceRunId !== sourceRun.id ||
    proposal.sessionId !== session.id ||
    proposal.turnId !== turn.id ||
    proposal.organizationId !== project.organizationId ||
    proposal.projectId !== project.id ||
    proposal.sourceRunId !== sourceRun.id ||
    proposal.targets.some((target) => !turn.patchRefs.includes(target.patchRef))
  ) {
    throw validationFailed("authoring chat turn is not bound to the proposal");
  }
}

function assertPatchBinding(
  patch: AuthoringChatPatchBinding,
  proposal: AuthoringChatProposalRecord,
): void {
  if (
    patch.organizationId !== proposal.organizationId ||
    patch.projectId !== proposal.projectId ||
    patch.sessionId !== proposal.sessionId ||
    patch.turnId !== proposal.turnId ||
    patch.sourceRunId !== proposal.sourceRunId
  ) {
    throw validationFailed("authoring proposal patch is outside the confirmed chat turn");
  }
}

function chatConfirmedEvent(input: {
  id: string;
  now: string;
  operationId: string;
  principalId: string;
  organizationId: string;
  projectId: string;
  sourceRunId: string;
  proposalId: string;
  proposalDigest: string;
  workflowDrafts: readonly ConfirmedAuthoringWorkflowDraftRef[];
  teamDrafts: readonly ConfirmedAuthoringTeamDraftRef[];
  taskPatches: readonly ConfirmedAuthoringTaskPatchRef[];
  workerDrafts: readonly ConfirmedAuthoringWorkerDraftRef[];
}) {
  return {
    specVersion: "0.1" as const,
    id: input.id,
    type: "workflow.authoring.chat.confirmed",
    source: "workforce.application.authoring",
    subject: { type: "authoring_chat_proposal", id: input.proposalId },
    time: input.now,
    recordedAt: input.now,
    organizationId: input.organizationId,
    projectId: input.projectId,
    runId: input.sourceRunId,
    actor: { type: "user" as const, id: input.principalId },
    stream: `authoring_chat_proposal:${input.proposalId}`,
    correlationId: input.operationId,
    dataContentType: "application/json" as const,
    dataSchema: "urn:workforce:event:workflow.authoring.chat.confirmed:0.1",
    data: {
      proposalId: input.proposalId,
      proposalDigest: input.proposalDigest,
      workflowDrafts: input.workflowDrafts,
      teamDrafts: input.teamDrafts,
      taskPatches: input.taskPatches,
      workerDrafts: input.workerDrafts,
    },
    sensitivity: "internal" as const,
  };
}

function storedChatResult(result: ConfirmAuthoringChatProposalResult) {
  return {
    proposalId: result.proposalId,
    projectId: result.projectId,
    workflowDrafts: result.workflowDrafts,
    teamDrafts: result.teamDrafts,
    taskPatches: result.taskPatches,
    workerDrafts: result.workerDrafts,
  };
}

function readChatReceipt(
  receipt: CommandReceipt | null,
  proposalDigest: string,
): ConfirmAuthoringChatProposalResult | undefined {
  if (!receipt) return undefined;
  if (receipt.requestDigest !== proposalDigest) {
    throw new UseCaseError(
      "idempotency_key_reused",
      "authoring chat confirmation idempotency key reused with a different payload",
    );
  }
  if (receipt.status === "pending") {
    throw new UseCaseError("conflict", "authoring chat confirmation is already in progress", {
      details: { status: "pending" },
    });
  }
  if (receipt.status === "failed") {
    throw storedChatFailure(receipt.result);
  }
  const result = parseStoredChatResult(receipt.result);
  return { ...result, reused: true };
}

function readChatReceiptForContinuation(
  receipt: CommandReceipt | null,
  proposalDigest: string,
  operationId: string,
): ConfirmAuthoringChatProposalResult | undefined {
  if (
    receipt?.status === "pending" &&
    receipt.operationId === operationId &&
    receipt.requestDigest === proposalDigest
  ) {
    return undefined;
  }
  return readChatReceipt(receipt, proposalDigest);
}

function parseStoredChatResult(value: unknown): Omit<ConfirmAuthoringChatProposalResult, "reused"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          "proposalId",
          "projectId",
          "workflowDrafts",
          "teamDrafts",
          "taskPatches",
          "workerDrafts",
        ].includes(key),
    ) ||
    !isNonEmptyString(record.proposalId) ||
    !isNonEmptyString(record.projectId) ||
    !Array.isArray(record.workflowDrafts)
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const workflowDrafts = record.workflowDrafts.map((item) => parseWorkflowDraftRef(item));
  const teamDrafts = Array.isArray(record.teamDrafts)
    ? record.teamDrafts.map((item) => parseTeamDraftRef(item))
    : [];
  const taskPatches = Array.isArray(record.taskPatches)
    ? record.taskPatches.map((item) => parseTaskPatchRef(item))
    : [];
  const workerDrafts = Array.isArray(record.workerDrafts)
    ? record.workerDrafts.map((item) => parseWorkerDraftRef(item))
    : [];
  if (
    workflowDrafts.length === 0 &&
    teamDrafts.length === 0 &&
    taskPatches.length === 0 &&
    workerDrafts.length === 0
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  return {
    proposalId: record.proposalId,
    projectId: record.projectId,
    workflowDrafts,
    teamDrafts,
    taskPatches,
    workerDrafts,
  };
}

function parseWorkflowDraftRef(value: unknown): ConfirmedAuthoringWorkflowDraftRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const ref = value as Record<string, unknown>;
  if (
    Object.keys(ref).some(
      (key) => !["targetType", "workflowId", "workflowDraftId", "revision"].includes(key),
    ) ||
    ref.targetType !== "workflow" ||
    !isNonEmptyString(ref.workflowId) ||
    !isNonEmptyString(ref.workflowDraftId) ||
    !Number.isInteger(ref.revision) ||
    (ref.revision as number) < 1
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  return {
    targetType: "workflow",
    workflowId: ref.workflowId,
    workflowDraftId: ref.workflowDraftId,
    revision: ref.revision as number,
  };
}

function parseTeamDraftRef(value: unknown): ConfirmedAuthoringTeamDraftRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const ref = value as Record<string, unknown>;
  if (
    Object.keys(ref).some(
      (key) => !["targetType", "teamId", "teamDraftId", "revision"].includes(key),
    ) ||
    ref.targetType !== "team" ||
    !isNonEmptyString(ref.teamId) ||
    !isNonEmptyString(ref.teamDraftId) ||
    !Number.isInteger(ref.revision) ||
    (ref.revision as number) < 1
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  return {
    targetType: "team",
    teamId: ref.teamId,
    teamDraftId: ref.teamDraftId,
    revision: ref.revision as number,
  };
}

function parseTaskPatchRef(value: unknown): ConfirmedAuthoringTaskPatchRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const ref = value as Record<string, unknown>;
  if (
    Object.keys(ref).some((key) => !["targetType", "taskId", "definitionRevision"].includes(key)) ||
    ref.targetType !== "task" ||
    !isNonEmptyString(ref.taskId) ||
    !Number.isInteger(ref.definitionRevision) ||
    (ref.definitionRevision as number) < 1
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  return {
    targetType: "task",
    taskId: ref.taskId,
    definitionRevision: ref.definitionRevision as number,
  };
}

function parseWorkerDraftRef(value: unknown): ConfirmedAuthoringWorkerDraftRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const ref = value as Record<string, unknown>;
  if (
    Object.keys(ref).some(
      (key) => !["targetType", "workerId", "workerDraftId", "revision"].includes(key),
    ) ||
    ref.targetType !== "worker" ||
    !isNonEmptyString(ref.workerId) ||
    !isNonEmptyString(ref.workerDraftId) ||
    !Number.isInteger(ref.revision) ||
    (ref.revision as number) < 1
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  return {
    targetType: "worker",
    workerId: ref.workerId,
    workerDraftId: ref.workerDraftId,
    revision: ref.revision as number,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function storedChatFailure(value: unknown): UseCaseError {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new UseCaseError("conflict", "authoring chat failed receipt result is malformed");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "validation_failed",
    "unauthenticated",
    "forbidden",
    "not_found",
    "idempotency_key_reused",
    "conflict",
    "event_cursor_expired",
    "revision_conflict",
    "invalid_transition",
    "unsupported_capability",
    "unknown_cost_not_enforceable",
    "accepted",
  ]);
  if (
    Object.keys(record).some((key) => !["code", "message", "retryable", "details"].includes(key)) ||
    typeof record.code !== "string" ||
    !allowed.has(record.code) ||
    typeof record.message !== "string" ||
    typeof record.retryable !== "boolean" ||
    (record.details !== undefined &&
      (!record.details || typeof record.details !== "object" || Array.isArray(record.details)))
  ) {
    return new UseCaseError("conflict", "authoring chat failed receipt result is malformed");
  }
  return new UseCaseError(record.code as ProtocolError["code"], record.message, {
    retryable: record.retryable,
    ...(record.details === undefined ? {} : { details: record.details as Record<string, unknown> }),
  });
}

async function persistChatFailure(
  deps: ConfirmChatProposalDeps,
  input: ConfirmChatProposalCommand,
  scope: CommandReceipt["scope"],
  proposalDigest: string,
  error: unknown,
): Promise<void> {
  if (isReceiptControlError(error)) return;
  const failure = toProtocolError(error);
  try {
    await deps.uow.withTransaction(async (tx) => {
      const current = await deps.receipts.get(scope);
      if (current) {
        if (current.requestDigest !== proposalDigest || current.status !== "pending") return;
      } else {
        await deps.receipts.putPending(tx, {
          operationId: input.operationId,
          status: "pending",
          scope,
          requestDigest: proposalDigest,
          acceptedAt: deps.clock.now().toISOString(),
        });
      }
      await deps.receipts.fail(tx, input.operationId, failure);
    });
  } catch {
    // Preserve the original domain error. A receipt write failure must never
    // turn a truthful validation/CAS error into a false success.
  }
}

function isReceiptControlError(error: unknown): boolean {
  return (
    error instanceof UseCaseError &&
    (error.code === "idempotency_key_reused" || error.details?.status === "pending")
  );
}

function isRevisionConflict(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "revision_conflict"
  );
}

function toProtocolError(error: unknown) {
  if (error instanceof UseCaseError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    code: "conflict" as const,
    message: "authoring chat confirmation failed",
    retryable: false,
  };
}

/** Cryptographic digest deliberately independent from the legacy FNV helper. */
export { sha256CanonicalDigest } from "./canonical-digest.js";

/** Runtime adapters call this with validated, reference-only Proposal output. */
export async function recordAuthoringProposal(
  ctx: AppContext,
  input: RecordAuthoringProposalInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  const proposal = parseAuthoringProposal(input.proposal);
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf(proposal),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.record-proposal",
          resource: `run:${proposal.sourceRunId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const run = ctx.world.runs.get(proposal.sourceRunId);
        if (!run) throw notFound("source run", proposal.sourceRunId);
        if (run.projectId !== proposal.projectId) {
          throw validationFailed("authoring proposal source run does not belong to the project");
        }
        const project = requireProject(ctx, proposal.projectId);
        const now = ctx.world.nowIso();
        const workflowTargets = proposal.targets.filter(
          (target) => target.targetType === "workflow",
        );
        const changeSet = parseAuthoringChangeSet({
          id: ctx.world.ids.ulid("acs_"),
          organizationId: project.organizationId,
          projectId: project.id,
          ...(workflowTargets.length === 1 ? { workflowId: workflowTargets[0]!.targetId } : {}),
          sourceRunId: run.id,
          status: "proposed",
          proposalRef: proposal.id,
          steps: proposal.targets.map((target, index) => ({
            id: ctx.world.ids.ulid("acst_"),
            ordinal: index + 1,
            targetType: target.targetType,
            targetId: target.targetId,
            expectedRevision: target.expectedRevision,
            status: "pending",
            patchRef: target.patchRef,
          })),
          createdAt: now,
          updatedAt: now,
        });
        ctx.world.authoringChangeSets.set(changeSet.id, changeSet);
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.proposed",
          subjectType: "authoring_change_set",
          subjectId: changeSet.id,
          projectId: project.id,
          runId: run.id,
          correlationId: input.operationId,
          data: { proposalId: proposal.id, targetCount: proposal.targets.length },
        });
        return changeSet;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

/** Validation is explicit so callers cannot skip the proposed → validating boundary. */
export async function validateAuthoringChangeSet(
  ctx: AppContext,
  input: ValidateAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ changeSetId: input.changeSetId }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.validate-change-set",
          resource: `authoring_change_set:${input.changeSetId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const changeSet = ctx.world.authoringChangeSets.get(input.changeSetId);
        if (!changeSet) throw notFound("authoring change set", input.changeSetId);
        if (changeSet.status !== "proposed") {
          throw validationFailed(`authoring change set cannot validate from ${changeSet.status}`);
        }
        const next = parseAuthoringChangeSet({
          ...changeSet,
          status: "validating",
          updatedAt: ctx.world.nowIso(),
        });
        ctx.world.authoringChangeSets.set(next.id, next);
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.validating",
          subjectType: "authoring_change_set",
          subjectId: next.id,
          projectId: next.projectId,
          runId: next.sourceRunId,
          correlationId: input.operationId,
          data: { targetCount: next.steps.length },
        });
        return next;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

/**
 * Applies a previously validated, structured proposal to authoring drafts
 * and Task definition patches. Steps are staged in order. A later failure
 * keeps already-applied steps and reports `partially_applied` instead of
 * pretending the ChangeSet fully succeeded.
 */
export async function applyAuthoringChangeSet(
  ctx: AppContext,
  input: ApplyAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  const requested = parseAuthoringChangeSet(input.changeSet);
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          changeSet: requested,
          workflowDrafts: input.workflowDrafts ?? [],
          teamDrafts: input.teamDrafts ?? [],
          taskPatches: input.taskPatches ?? [],
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.apply-change-set",
          resource: `project:${requested.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const stored = ctx.world.authoringChangeSets.get(requested.id);
        if (!stored) {
          throw notFound("authoring change set", requested.id);
        }
        if (changeSetIdentityDigest(stored) !== changeSetIdentityDigest(requested)) {
          throw validationFailed("authoring change set differs from its validated record");
        }
        const project = requireProject(ctx, requested.projectId);
        if (project.organizationId !== requested.organizationId) {
          throw validationFailed("authoring change set organization does not match project");
        }
        const sourceRun = ctx.world.runs.get(requested.sourceRunId);
        if (!sourceRun) {
          throw notFound("source run", requested.sourceRunId);
        }
        if (sourceRun.projectId !== requested.projectId) {
          throw validationFailed("authoring source run does not belong to the project");
        }
        if (
          stored.status !== "validating" &&
          stored.status !== "applying" &&
          stored.status !== "partially_applied"
        ) {
          throw validationFailed(`authoring change set cannot apply from ${stored.status}`);
        }
        const workflowDrafts = new Map(
          (input.workflowDrafts ?? []).map((draft) => [
            draft.workflowId,
            parseWorkflowDraft(draft),
          ]),
        );
        const teamDrafts = new Map(
          (input.teamDrafts ?? []).map((draft) => [draft.teamId, parseTeamDraft(draft)]),
        );
        const taskPatches = new Map(
          (input.taskPatches ?? []).map((patch) => [patch.taskId, parseAuthoringTaskPatch(patch)]),
        );
        if (
          workflowDrafts.size !== (input.workflowDrafts ?? []).length ||
          teamDrafts.size !== (input.teamDrafts ?? []).length ||
          taskPatches.size !== (input.taskPatches ?? []).length
        ) {
          throw validationFailed("authoring draft targets must be unique");
        }

        const pendingSteps = stored.steps.filter((step) => step.status !== "applied");
        for (const step of pendingSteps) {
          if (step.status !== "pending" && step.status !== "applying" && step.status !== "failed") {
            throw validationFailed("authoring change set steps must be pending before apply");
          }
          if (step.targetType === "task") {
            if (!taskPatches.get(step.targetId)) {
              throw validationFailed(`missing task draft for ${step.targetId}`);
            }
            continue;
          }
          if (step.targetType === "worker") {
            throw validationFailed(
              "authoring worker drafts land through chat confirmation, not change-set apply",
            );
          }
          const draft =
            step.targetType === "workflow"
              ? workflowDrafts.get(step.targetId)
              : teamDrafts.get(step.targetId);
          if (!draft) {
            throw validationFailed(`missing ${step.targetType} draft for ${step.targetId}`);
          }
          assertDraftRevision(
            ctx,
            step.targetType,
            step.targetId,
            draft.revision,
            step.expectedRevision,
          );
          if (
            (step.targetType === "workflow" && ctx.world.workflowDrafts.has(draft.id)) ||
            (step.targetType === "team" && ctx.world.teamDrafts.has(draft.id))
          ) {
            throw validationFailed(`authoring draft ${draft.id} already exists`);
          }
        }

        const now = ctx.world.nowIso();
        const steps = stored.steps.map((step) => ({ ...step }));
        let halted: { code: string; message: string } | undefined;
        for (const step of steps) {
          if (step.status === "applied") continue;
          if (halted) continue;
          try {
            const resultRevision = applyAuthoringStep(ctx, {
              step,
              workflowDrafts,
              teamDrafts,
              taskPatches,
              now,
            });
            step.status = "applied";
            step.resultRevision = resultRevision;
            step.completedAt = now;
            delete step.failure;
          } catch (error) {
            const failure = toStepFailure(error);
            step.status = "failed";
            step.failure = failure;
            step.completedAt = now;
            halted = failure;
          }
        }

        const appliedCount = steps.filter((step) => step.status === "applied").length;
        const failedCount = steps.filter((step) => step.status === "failed").length;
        const status =
          halted === undefined ? "applied" : appliedCount > 0 ? "partially_applied" : "failed";
        const applied = parseAuthoringChangeSet({
          ...stored,
          status,
          updatedAt: now,
          steps,
          ...(halted && status === "failed" ? { failure: halted } : {}),
        });
        ctx.world.authoringChangeSets.set(applied.id, applied);
        await appendEvent(ctx.world, tx, {
          type:
            status === "applied"
              ? "workflow.authoring.applied"
              : status === "partially_applied"
                ? "workflow.authoring.partially_applied"
                : "workflow.authoring.failed",
          subjectType: "authoring_change_set",
          subjectId: applied.id,
          projectId: applied.projectId,
          runId: applied.sourceRunId,
          correlationId: input.operationId,
          data: {
            status: applied.status,
            stepCount: applied.steps.length,
            appliedCount,
            failedCount,
          },
        });
        return applied;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

export function parseAuthoringTaskPatch(input: AuthoringTaskPatch): AuthoringTaskPatch {
  if (!isNonEmptyString(input.taskId) || !Number.isInteger(input.revision) || input.revision < 1) {
    throw validationFailed("authoring task patch is malformed");
  }
  const roles: ReadonlySet<TaskRecord["role"]> = new Set([
    "planner",
    "developer",
    "reviewer",
    "approver",
  ]);
  if (input.role !== undefined && !roles.has(input.role)) {
    throw validationFailed(`authoring task patch has an unknown role ${input.role}`);
  }
  return {
    taskId: input.taskId,
    revision: input.revision,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.requiresReview !== undefined ? { requiresReview: input.requiresReview } : {}),
    ...(input.expectedOutputs !== undefined ? { expectedOutputs: input.expectedOutputs } : {}),
    ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {}),
    ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    ...(input.maxReworkCycles !== undefined ? { maxReworkCycles: input.maxReworkCycles } : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
  };
}

export function adaptTeamDraftRepository(repository: {
  listByTeam(teamId: string): readonly TeamDraftDto[];
  append(tx: Tx, draft: TeamDraftDto, expectedRevision: number): Promise<void> | void;
}): AuthoringTeamDraftRepository {
  return {
    getCurrentRevision: (_tx, teamId) =>
      Math.max(0, ...repository.listByTeam(teamId).map((draft) => draft.revision)),
    append: (tx, draft, expectedRevision) => repository.append(tx, draft, expectedRevision),
  };
}

function changeSetIdentityDigest(changeSet: AuthoringChangeSetDto): string {
  return digestOf({
    id: changeSet.id,
    organizationId: changeSet.organizationId,
    projectId: changeSet.projectId,
    workflowId: changeSet.workflowId,
    sourceRunId: changeSet.sourceRunId,
    proposalRef: changeSet.proposalRef,
    steps: changeSet.steps.map((step) => ({
      id: step.id,
      ordinal: step.ordinal,
      targetType: step.targetType,
      targetId: step.targetId,
      expectedRevision: step.expectedRevision,
      patchRef: step.patchRef,
    })),
  });
}

function applyAuthoringStep(
  ctx: AppContext,
  input: {
    step: AuthoringChangeSetDto["steps"][number];
    workflowDrafts: Map<string, WorkflowDraftDto>;
    teamDrafts: Map<string, TeamDraftDto>;
    taskPatches: Map<string, AuthoringTaskPatch>;
    now: string;
  },
): number {
  if (input.step.targetType === "task") {
    return applyTaskPatch(ctx, input.step, input.taskPatches.get(input.step.targetId)!, input.now);
  }
  if (input.step.targetType === "workflow") {
    const draft = input.workflowDrafts.get(input.step.targetId);
    if (!draft) {
      throw validationFailed(`missing workflow draft for ${input.step.targetId}`);
    }
    ctx.world.workflowDrafts.set(draft.id, draft);
    return draft.revision;
  }
  if (input.step.targetType === "worker") {
    throw validationFailed(
      "authoring worker drafts land through chat confirmation, not change-set apply",
    );
  }
  const draft = input.teamDrafts.get(input.step.targetId);
  if (!draft) {
    throw validationFailed(`missing team draft for ${input.step.targetId}`);
  }
  ctx.world.teamDrafts.set(draft.id, draft);
  return draft.revision;
}

function applyTaskPatch(
  ctx: AppContext,
  step: AuthoringChangeSetDto["steps"][number],
  patch: AuthoringTaskPatch,
  now: string,
): number {
  const task = ctx.world.tasks.get(step.targetId);
  if (!task) {
    throw validationFailed(`missing task ${step.targetId} for authoring patch`);
  }
  if (task.projectId !== ctx.world.projects.get(task.projectId)?.id) {
    throw validationFailed("authoring task patch does not belong to a known project");
  }
  if (
    task.definitionRevision !== step.expectedRevision ||
    patch.revision !== step.expectedRevision + 1
  ) {
    throw validationFailed(`authoring task draft revision conflict for ${step.targetId}`, {
      expectedRevision: step.expectedRevision,
      currentRevision: task.definitionRevision,
      nextRevision: patch.revision,
    });
  }
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.role !== undefined) task.role = patch.role;
  if (patch.requiresReview !== undefined) task.requiresReview = patch.requiresReview;
  if (patch.expectedOutputs !== undefined) task.expectedOutputs = [...patch.expectedOutputs];
  if (patch.dependsOn !== undefined) task.dependsOn = [...patch.dependsOn];
  if (patch.maxAttempts !== undefined) task.maxAttempts = patch.maxAttempts;
  if (patch.maxReworkCycles !== undefined) task.maxReworkCycles = patch.maxReworkCycles;
  if (patch.priority !== undefined) task.priority = patch.priority;
  task.definitionRevision = patch.revision;
  task.updatedAt = now;
  return patch.revision;
}

function toStepFailure(error: unknown): { code: string; message: string } {
  if (error instanceof UseCaseError) {
    return { code: error.code, message: error.message };
  }
  return { code: "conflict", message: "authoring change set step failed" };
}

function assertDraftRevision(
  ctx: AppContext,
  targetType: "workflow" | "team",
  targetId: string,
  nextRevision: number,
  expectedRevision: number,
): void {
  let currentRevision = 0;
  if (targetType === "workflow") {
    for (const draft of ctx.world.workflowDrafts.values()) {
      if (draft.workflowId === targetId)
        currentRevision = Math.max(currentRevision, draft.revision);
    }
  } else {
    for (const draft of ctx.world.teamDrafts.values()) {
      if (draft.teamId === targetId) currentRevision = Math.max(currentRevision, draft.revision);
    }
  }
  if (currentRevision !== expectedRevision || nextRevision !== currentRevision + 1) {
    throw validationFailed(`authoring ${targetType} draft revision conflict for ${targetId}`, {
      expectedRevision,
      currentRevision,
      nextRevision,
    });
  }
}
