import {
  parseAuthoringTurnActionCommand,
  parseAuthoringProposal,
  parseAuthoringChangeSet,
  parseWorkflowGraphDefinition,
  parseTeamDraft,
  parseWorkflowDraft,
  type AuthoringProposalTargetInput,
  type AuthoringTurnActionCommand,
  type AuthoringChangeSetDto,
  type AuthoringProposalDto,
  type CommandReceipt,
  type ProtocolError,
  type TeamDraftDto,
  type WorkflowGraphDefinitionDto,
  type WorkflowDraftDto,
} from "@workforce/protocol";

import type { Clock, EventStore, IdGenerator, Tx, UnitOfWork } from "../../ports/index.js";
import type { AppContext } from "../projects/context.js";
import { notFound, revisionConflict, UseCaseError, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { requireProject } from "../projects/projects.js";
import { startRun } from "../runs/runs.js";
import type { WorkflowDefinitionRecord } from "../catalog/types.js";

export interface ApplyAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSet: AuthoringChangeSetDto;
  workflowDrafts?: readonly WorkflowDraftDto[];
  teamDrafts?: readonly TeamDraftDto[];
}

export interface StartAuthoringInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  /** Used only for Runtime invocation; never copied to events, ChangeSets, or drafts. */
  intent: string;
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
  completedOperationId: string | null;
  patchRefs: readonly string[];
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

export interface ConfirmAuthoringChatProposalResult {
  reused: boolean;
  proposalId: string;
  projectId: string;
  workflowDrafts: readonly ConfirmedAuthoringWorkflowDraftRef[];
}

/**
 * Creates the governed Task/Run that a Runtime adapter uses for authoring.
 * The intent intentionally remains transient; adapters must return references
 * and a structured Proposal through recordAuthoringProposal instead of logging it.
 */
export async function startAuthoring(
  ctx: AppContext,
  input: StartAuthoringInput,
): Promise<{ reused: boolean; taskId: string; runId: string }> {
  if (input.intent.trim() === "") {
    throw validationFailed("authoring intent is required");
  }
  const taskResult = await ctx.world.uow.withTransaction(async (tx) =>
    withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ projectId: input.projectId, intent: input.intent }),
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
          data: { phase: "runtime_requested" },
        });
        return { taskId };
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
  };
}

/**
 * Confirms a trusted conversational proposal into unpublished WorkflowDrafts.
 *
 * Resolver work happens before the write transaction. Every identity and
 * binding is then read again inside the transaction, so a stale resolver
 * result cannot cross a Project/organization/session/Run boundary. The
 * transaction owns identity, authority scope, draft CAS, Event and committed
 * receipt together. There is intentionally no MemoryWorld fallback.
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

  let resolved: ResolvedChatWorkflowTarget[];
  try {
    resolved = await resolveChatWorkflowTargets(deps.resolver, prepared);
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
      const drafts: Array<{ draft: WorkflowDraftDto; expectedRevision: number }> = [];

      for (const target of resolved) {
        await assertResolutionBinding(deps, tx, context, target);
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

        const draft = parseWorkflowDraft({
          id: deps.ids.ulid("wfd_"),
          workflowId,
          revision: currentRevision + 1,
          status: "draft",
          graph: target.graph,
          contentHash: sha256CanonicalDigest(target.graph),
          updatedAt: deps.clock.now().toISOString(),
          updatedBy: deps.principalId,
        });
        drafts.push({ draft, expectedRevision });
      }

      for (const item of drafts) {
        await deps.workflowDrafts.append(tx, item.draft, item.expectedRevision, {
          organizationId: context.project.organizationId,
          projectId: context.project.id,
        });
      }

      const refs = drafts.map(({ draft }) => ({
        targetType: "workflow" as const,
        workflowId: draft.workflowId,
        workflowDraftId: draft.id,
        revision: draft.revision,
      }));
      const result: ConfirmAuthoringChatProposalResult = {
        reused: false,
        proposalId: context.proposal.id,
        projectId: context.project.id,
        workflowDrafts: refs,
      };
      try {
        await deps.turns.completeInTransaction(tx, {
          turnId: context.turn.id,
          expectedStateRevision: command.expectedRevision,
          idempotencyKey: command.idempotencyKey,
          proposalId: context.proposal.id,
          at: deps.clock.now().toISOString(),
          ...(refs[0] ? { workflowDraftId: refs[0].workflowDraftId } : {}),
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
          refs,
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
  operation: "create" | "update";
  graph: WorkflowGraphDefinitionDto;
  binding: AuthoringChatBindingProof;
  patchRef: string;
  workflowId?: string;
  expectedRevision?: number;
}

async function resolveChatWorkflowTargets(
  resolver: AuthoringChatProposalResolver,
  context: ChatConfirmationContext,
): Promise<ResolvedChatWorkflowTarget[]> {
  const resolved: ResolvedChatWorkflowTarget[] = [];
  for (const target of context.proposal.targets) {
    if (target.targetType !== "workflow") {
      throw validationFailed(
        `authoring chat proposal ${target.operation} for ${target.targetType} is not implemented`,
      );
    }
    const resolution = await resolver.resolveWorkflowGraph({
      proposalId: context.proposal.id,
      projectId: context.proposal.projectId,
      sourceRunId: context.proposal.sourceRunId,
      operation: target.operation,
      patchRef: target.patchRef,
      ...(target.operation === "update"
        ? { workflowId: target.targetId, expectedRevision: target.expectedRevision }
        : {}),
    });
    const graph = parseWorkflowGraphDefinition(resolution.graph);
    resolved.push({
      operation: target.operation,
      graph,
      binding: resolution.binding,
      patchRef: target.patchRef,
      ...(target.operation === "update"
        ? { workflowId: target.targetId, expectedRevision: target.expectedRevision }
        : {}),
    });
  }
  return resolved;
}

async function assertResolutionBinding(
  deps: ConfirmChatProposalDeps,
  tx: Tx,
  context: ChatConfirmationContext,
  target: ResolvedChatWorkflowTarget,
): Promise<void> {
  const proof = target.binding;
  if (
    proof.organizationId !== context.project.organizationId ||
    proof.patchRef !== target.patchRef ||
    proof.projectId !== context.project.id ||
    proof.sessionId !== context.session.id ||
    proof.turnId !== context.turn.id ||
    proof.sourceRunId !== context.sourceRun.id ||
    (target.operation === "update" &&
      (proof.workflowId !== target.workflowId ||
        proof.expectedRevision !== target.expectedRevision)) ||
    (target.operation === "create" &&
      (proof.workflowId !== undefined || proof.expectedRevision !== undefined))
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
  refs: readonly ConfirmedAuthoringWorkflowDraftRef[];
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
      workflowDrafts: input.refs,
    },
    sensitivity: "internal" as const,
  };
}

function storedChatResult(result: ConfirmAuthoringChatProposalResult) {
  return {
    proposalId: result.proposalId,
    projectId: result.projectId,
    workflowDrafts: result.workflowDrafts,
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
      (key) => !["proposalId", "projectId", "workflowDrafts"].includes(key),
    ) ||
    !isNonEmptyString(record.proposalId) ||
    !isNonEmptyString(record.projectId) ||
    !Array.isArray(record.workflowDrafts) ||
    record.workflowDrafts.length === 0
  ) {
    throw new UseCaseError("conflict", "authoring chat committed receipt result is malformed");
  }
  const refs = record.workflowDrafts.map((value) => {
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
      targetType: "workflow" as const,
      workflowId: ref.workflowId,
      workflowDraftId: ref.workflowDraftId,
      revision: ref.revision as number,
    };
  });
  return { proposalId: record.proposalId, projectId: record.projectId, workflowDrafts: refs };
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
export function sha256CanonicalDigest(value: unknown): string {
  const bytes = utf8Bytes(canonicalJson(value));
  return `sha256:${sha256Words(bytes)
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("")}`;
}

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Words(input: Uint8Array): number[] {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = schedule[index - 15]!;
      const y = schedule[index - 2]!;
      const sigma0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const sigma1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      schedule[index] = (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + constants[index]! + schedule[index]!) >>> 0;
      const sigma0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7];
}

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
 * Applies a previously validated, structured proposal to authoring drafts.
 * This intentionally has no Runtime call: Runtime proposal creation, task
 * patches, recovery and durable adapter composition are separate slices.
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
        if (digestOf(stored) !== digestOf(requested)) {
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
        if (requested.status !== "validating") {
          throw validationFailed("authoring change set must be validating before apply");
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
        if (
          workflowDrafts.size !== (input.workflowDrafts ?? []).length ||
          teamDrafts.size !== (input.teamDrafts ?? []).length
        ) {
          throw validationFailed("authoring draft targets must be unique");
        }

        for (const step of requested.steps) {
          if (step.status !== "pending") {
            throw validationFailed("authoring change set steps must be pending before apply");
          }
          if (step.targetType === "task") {
            throw validationFailed("task authoring patches are not implemented");
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
        for (const draft of workflowDrafts.values()) ctx.world.workflowDrafts.set(draft.id, draft);
        for (const draft of teamDrafts.values()) ctx.world.teamDrafts.set(draft.id, draft);
        const applied = parseAuthoringChangeSet({
          ...requested,
          status: "applied",
          updatedAt: now,
          steps: requested.steps.map((step) => {
            const draft =
              step.targetType === "workflow"
                ? workflowDrafts.get(step.targetId)
                : teamDrafts.get(step.targetId);
            return {
              ...step,
              status: "applied",
              resultRevision: draft?.revision,
              completedAt: now,
            };
          }),
        });
        ctx.world.authoringChangeSets.set(applied.id, applied);
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.applied",
          subjectType: "authoring_change_set",
          subjectId: applied.id,
          projectId: applied.projectId,
          runId: applied.sourceRunId,
          correlationId: input.operationId,
          data: { status: applied.status, stepCount: applied.steps.length },
        });
        return applied;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
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
