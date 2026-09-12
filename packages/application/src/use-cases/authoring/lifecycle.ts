import {
  parseAuthoringChangeSet,
  parseAuthoringTurnActionCommand,
  type AuthoringChangeSetDto,
  type AuthoringChangeSetStatus,
  type AuthoringChangeSetStepDto,
  type AuthoringTurnActionCommand,
  type ProtocolError,
} from "@workforce/protocol";

import type { Clock, EventStore, IdGenerator, Tx, UnitOfWork } from "../../ports/index.js";
import type { AppContext } from "../projects/context.js";
import { invalidTransition, notFound, UseCaseError, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { cancelRun } from "../runs/runs.js";
import type {
  AuthoringChatReceiptRepository,
  AuthoringChatSession,
  AuthoringChatSessionRepository,
  AuthoringChatTurn,
  StartAuthoringInput,
  StartAuthoringResult,
} from "./authoring.js";
import { recoverAuthoringProtectedBody, type AuthoringProtectedBodyStore } from "./protected-content.js";

export interface FailAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSetId: string;
  failure: { code: string; message: string };
}

export interface CancelAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSetId: string;
}

export interface RetryAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSetId: string;
}

export interface ExpireAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSetId: string;
}

export interface AuthoringTurnLifecycleTurnRepository {
  getInTransaction(
    tx: Tx,
    turnId: string,
  ): Promise<AuthoringChatTurn> | AuthoringChatTurn | null;
  transitionInTransaction(
    tx: Tx,
    input: {
      turnId: string;
      expectedStateRevision: number;
      idempotencyKey: string;
      status: Extract<AuthoringChatTurn["status"], "failed" | "cancelled" | "closed" | "running">;
      at: string;
      taskId?: string;
      runId?: string;
      sourceRunId?: string;
      failure?: { code: string; message: string };
    },
  ): Promise<AuthoringChatTurn> | AuthoringChatTurn;
}

export interface AuthoringTurnLifecycleDeps {
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  events: EventStore;
  receipts: AuthoringChatReceiptRepository;
  sessions: AuthoringChatSessionRepository;
  turns: AuthoringTurnLifecycleTurnRepository;
  protectedBodies: AuthoringProtectedBodyStore;
  principalId: string;
  clientId: string;
  startAuthoring: (input: StartAuthoringInput) => Promise<StartAuthoringResult>;
  cancelAuthoringRun?: (runId: string) => Promise<void> | void;
}

export type AuthoringTurnLifecycleCommand = Extract<
  AuthoringTurnActionCommand,
  { action: "cancel" | "retry" | "close" }
>;

export interface FailAuthoringTurnInput {
  operationId: string;
  idempotencyKey: string;
  sessionId: string;
  turnId: string;
  expectedRevision: number;
  failure: { code: string; message: string };
}

export interface RetryAuthoringTurnInput {
  operationId: string;
  idempotencyKey: string;
  sessionId: string;
  turnId: string;
  expectedRevision: number;
  contentRef: string;
  projectId: string;
}

export interface AuthoringTurnLifecycleResult {
  reused: boolean;
  sessionId: string;
  turnId: string;
  status: AuthoringChatTurn["status"];
  taskId?: string;
  runId?: string;
  agentReceivedIntent: false;
}

const FAIL_FROM: ReadonlySet<AuthoringChangeSetStatus> = new Set([
  "proposed",
  "validating",
  "applying",
  "partially_applied",
]);
const CANCEL_FROM: ReadonlySet<AuthoringChangeSetStatus> = new Set([
  "proposed",
  "validating",
  "applying",
  "partially_applied",
]);
const RETRY_FROM: ReadonlySet<AuthoringChangeSetStatus> = new Set([
  "partially_applied",
  "failed",
]);
const EXPIRE_FROM: ReadonlySet<AuthoringChangeSetStatus> = new Set([
  "proposed",
  "validating",
  "applying",
  "partially_applied",
]);

export async function failAuthoringChangeSet(
  ctx: AppContext,
  input: FailAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return mutateChangeSet(ctx, {
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    changeSetId: input.changeSetId,
    canonicalOperation: "authoring.fail-change-set",
    digest: digestOf({ changeSetId: input.changeSetId, failure: input.failure }),
    apply: (stored, now) => {
      assertStatus(stored, FAIL_FROM, "fail");
      const steps = stored.steps.map((step) =>
        step.status === "applied"
          ? step
          : {
              ...step,
              status: "failed" as const,
              failure: input.failure,
              completedAt: now,
            },
      );
      return parseAuthoringChangeSet({
        ...stored,
        status: "failed",
        failure: input.failure,
        updatedAt: now,
        steps,
      });
    },
    eventType: "workflow.authoring.failed",
  });
}

export async function cancelAuthoringChangeSet(
  ctx: AppContext,
  input: CancelAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return mutateChangeSet(ctx, {
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    changeSetId: input.changeSetId,
    canonicalOperation: "authoring.cancel-change-set",
    digest: digestOf({ changeSetId: input.changeSetId, action: "cancel" }),
    apply: (stored, now) => {
      assertStatus(stored, CANCEL_FROM, "cancel");
      const steps = stored.steps.map((step) => {
        if (step.status === "applied" || step.status === "cancelled") return step;
        return { ...step, status: "cancelled" as const, completedAt: now };
      });
      return parseAuthoringChangeSet({
        ...stored,
        status: "cancelled",
        updatedAt: now,
        steps,
      });
    },
    eventType: "workflow.authoring.cancelled",
  });
}

export async function retryAuthoringChangeSet(
  ctx: AppContext,
  input: RetryAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return mutateChangeSet(ctx, {
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    changeSetId: input.changeSetId,
    canonicalOperation: "authoring.retry-change-set",
    digest: digestOf({ changeSetId: input.changeSetId, action: "retry" }),
    apply: (stored, now) => {
      assertStatus(stored, RETRY_FROM, "retry");
      const remaining = stored.steps.filter((step) => step.status !== "applied");
      if (remaining.length === 0) {
        throw validationFailed("authoring change set has no remaining steps to retry");
      }
      const steps = stored.steps.map((step) => {
        if (step.status === "applied") return step;
        const { failure: _failure, startedAt: _started, completedAt: _completed, ...rest } =
          step;
        return { ...rest, status: "pending" as const };
      });
      const { failure: _changeSetFailure, ...rest } = stored;
      return parseAuthoringChangeSet({
        ...rest,
        status: "applying",
        updatedAt: now,
        steps,
      });
    },
    eventType: "workflow.authoring.retried",
  });
}

export async function expireAuthoringChangeSet(
  ctx: AppContext,
  input: ExpireAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return mutateChangeSet(ctx, {
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    changeSetId: input.changeSetId,
    canonicalOperation: "authoring.expire-change-set",
    digest: digestOf({ changeSetId: input.changeSetId, action: "expire" }),
    apply: (stored, now) => {
      assertStatus(stored, EXPIRE_FROM, "expire");
      if (stored.expiresAt !== undefined && stored.expiresAt > now) {
        throw validationFailed("authoring change set has not reached its retention deadline");
      }
      const steps = stored.steps.map((step) =>
        step.status === "applied"
          ? step
          : { ...step, status: "expired" as const, completedAt: now },
      );
      return parseAuthoringChangeSet({
        ...stored,
        status: "expired",
        updatedAt: now,
        steps,
      });
    },
    eventType: "workflow.authoring.expired",
  });
}

export async function failAuthoringTurn(
  input: FailAuthoringTurnInput,
  deps: AuthoringTurnLifecycleDeps,
): Promise<AuthoringTurnLifecycleResult> {
  return transitionTurn(
    {
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      sessionId: input.sessionId,
      turnId: input.turnId,
      expectedRevision: input.expectedRevision,
    },
    deps,
    "authoring.fail-turn",
    async ({ tx, session, turn }) => {
      assertOpenSession(session);
      if (turn.status === "completed" || turn.status === "closed") {
        throw invalidTransition("authoring turn cannot fail from a terminal success");
      }
      const next = await deps.turns.transitionInTransaction(tx, {
        turnId: turn.id,
        expectedStateRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        at: deps.clock.now().toISOString(),
        failure: input.failure,
      });
      return { next, eventType: "workflow.authoring.failed" };
    },
  );
}

export async function cancelAuthoringTurn(
  input: AuthoringTurnLifecycleCommand | Omit<AuthoringTurnActionCommand, "action">,
  deps: AuthoringTurnLifecycleDeps,
): Promise<AuthoringTurnLifecycleResult> {
  const command = normalizeTurnCommand(input, "cancel");
  return transitionTurn(command, deps, "authoring.cancel-turn", async ({ tx, session, turn }) => {
    assertOpenSession(session);
    if (turn.status === "completed" || turn.status === "closed" || turn.status === "cancelled") {
      throw invalidTransition(`authoring turn cannot cancel from ${turn.status}`);
    }
    if (deps.cancelAuthoringRun) {
      await deps.cancelAuthoringRun(turn.sourceRunId);
    }
    const next = await deps.turns.transitionInTransaction(tx, {
      turnId: turn.id,
      expectedStateRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      status: "cancelled",
      at: deps.clock.now().toISOString(),
    });
    return { next, eventType: "workflow.authoring.cancelled" };
  });
}

export async function closeAuthoringTurn(
  input: AuthoringTurnLifecycleCommand | Omit<AuthoringTurnActionCommand, "action">,
  deps: AuthoringTurnLifecycleDeps,
): Promise<AuthoringTurnLifecycleResult> {
  const command = normalizeTurnCommand(input, "close");
  return transitionTurn(command, deps, "authoring.close-turn", async ({ tx, session, turn }) => {
    if (session.status === "open" && turn.status !== "completed" && turn.status !== "failed") {
      throw invalidTransition(`authoring turn cannot close from ${turn.status}`);
    }
    const next = await deps.turns.transitionInTransaction(tx, {
      turnId: turn.id,
      expectedStateRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      status: "closed",
      at: deps.clock.now().toISOString(),
    });
    return { next, eventType: "workflow.authoring.closed" };
  });
}

/**
 * Retry creates a new authoring Task/Run. The original intent is recovered only
 * from transient process memory. Restart without that body fail-closes and
 * never reports that an Agent received the intent.
 */
export async function retryAuthoringTurn(
  input: RetryAuthoringTurnInput,
  deps: AuthoringTurnLifecycleDeps,
): Promise<AuthoringTurnLifecycleResult> {
  const command = {
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    sessionId: input.sessionId,
    turnId: input.turnId,
    expectedRevision: input.expectedRevision,
  };
  let recoveredIntent: string;
  try {
    recoveredIntent = recoverAuthoringProtectedBody(deps.protectedBodies, input.contentRef).body;
  } catch (error) {
    await persistTurnFailure(deps, command, "authoring.retry-turn", error);
    throw error;
  }

  const started = await deps.startAuthoring({
    operationId: `${input.operationId}:authoring`,
    idempotencyKey: `${input.idempotencyKey}:authoring`,
    projectId: input.projectId,
    intent: recoveredIntent,
  });
  if (started.agentReceivedIntent !== false) {
    throw validationFailed("authoring retry must not report that the Agent received intent");
  }

  return transitionTurn(command, deps, "authoring.retry-turn", async ({ tx, session, turn }) => {
    assertOpenSession(session);
    if (turn.status !== "failed" && turn.status !== "cancelled") {
      throw invalidTransition(`authoring turn cannot retry from ${turn.status}`);
    }
    const next = await deps.turns.transitionInTransaction(tx, {
      turnId: turn.id,
      expectedStateRevision: command.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      status: "running",
      at: deps.clock.now().toISOString(),
      taskId: started.taskId,
      runId: started.runId,
      sourceRunId: started.runId,
    });
    return {
      next,
      eventType: "workflow.authoring.retried",
      extra: { previousRunId: turn.sourceRunId, agentReceivedIntent: false as const },
    };
  });
}

export async function cancelAuthoringRunFromContext(ctx: AppContext, runId: string): Promise<void> {
  await cancelRun(ctx, {
    operationId: `authoring-cancel:${runId}`,
    idempotencyKey: `authoring-cancel:${runId}`,
    runId,
  });
}

async function mutateChangeSet(
  ctx: AppContext,
  input: {
    operationId: string;
    idempotencyKey: string;
    changeSetId: string;
    canonicalOperation: string;
    digest: string;
    apply: (stored: AuthoringChangeSetDto, now: string) => AuthoringChangeSetDto;
    eventType: string;
  },
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: input.digest,
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: input.canonicalOperation,
          resource: `authoring_change_set:${input.changeSetId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const stored = ctx.world.authoringChangeSets.get(input.changeSetId);
        if (!stored) throw notFound("authoring change set", input.changeSetId);
        const now = ctx.world.nowIso();
        const next = input.apply(stored, now);
        ctx.world.authoringChangeSets.set(next.id, next);
        await appendEvent(ctx.world, tx, {
          type: input.eventType,
          subjectType: "authoring_change_set",
          subjectId: next.id,
          projectId: next.projectId,
          runId: next.sourceRunId,
          correlationId: input.operationId,
          data: {
            status: next.status,
            stepCount: next.steps.length,
            appliedCount: countSteps(next.steps, "applied"),
            failedCount: countSteps(next.steps, "failed"),
          },
        });
        return next;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

function assertStatus(
  changeSet: AuthoringChangeSetDto,
  allowed: ReadonlySet<AuthoringChangeSetStatus>,
  command: string,
): void {
  if (!allowed.has(changeSet.status)) {
    throw invalidTransition(`authoring change set cannot ${command} from ${changeSet.status}`, {
      status: changeSet.status,
    });
  }
}

function countSteps(
  steps: readonly AuthoringChangeSetStepDto[],
  status: AuthoringChangeSetStepDto["status"],
): number {
  return steps.filter((step) => step.status === status).length;
}

function normalizeTurnCommand(
  input: AuthoringTurnLifecycleCommand | Omit<AuthoringTurnActionCommand, "action">,
  action: "cancel" | "close",
): Extract<AuthoringTurnActionCommand, { action: "cancel" | "close" }> {
  const command = parseAuthoringTurnActionCommand({ ...input, action });
  if (command.action !== action) {
    throw validationFailed(`authoring turn action must be ${action}`);
  }
  return command;
}

async function transitionTurn(
  command: {
    operationId: string;
    idempotencyKey: string;
    sessionId: string;
    turnId: string;
    expectedRevision: number;
  },
  deps: AuthoringTurnLifecycleDeps,
  canonicalOperation: string,
  apply: (input: {
    tx: Tx;
    session: AuthoringChatSession;
    turn: AuthoringChatTurn;
  }) => Promise<{
    next: AuthoringChatTurn;
    eventType: string;
    extra?: Record<string, unknown>;
  }>,
): Promise<AuthoringTurnLifecycleResult> {
  const digest = digestOf({
    action: canonicalOperation,
    sessionId: command.sessionId,
    turnId: command.turnId,
    expectedRevision: command.expectedRevision,
  });
  const scope = {
    principalId: deps.principalId,
    clientId: deps.clientId,
    canonicalOperation,
    resource: `authoring-turn:${command.sessionId}:${command.turnId}`,
    idempotencyKey: command.idempotencyKey,
  } as const;
  const existing = await deps.receipts.get(scope);
  if (existing) {
    if (existing.requestDigest !== digest) {
      throw new UseCaseError(
        "idempotency_key_reused",
        "authoring turn lifecycle idempotency key reused with a different payload",
      );
    }
    if (existing.status === "pending") {
      throw new UseCaseError("conflict", "authoring turn lifecycle is already in progress", {
        details: { status: "pending" },
      });
    }
    if (existing.status === "failed") {
      throw storedFailure(existing.result);
    }
    return parseTurnResult(existing.result);
  }

  try {
    return await deps.uow.withTransaction(async (tx) => {
      await deps.receipts.putPending(tx, {
        operationId: command.operationId,
        status: "pending",
        scope,
        requestDigest: digest,
        acceptedAt: deps.clock.now().toISOString(),
      });
      const session = await deps.sessions.getInTransaction(tx, command.sessionId);
      if (!session) throw notFound("authoring session", command.sessionId);
      const turn = await deps.turns.getInTransaction(tx, command.turnId);
      if (!turn) throw notFound("authoring turn", command.turnId);
      if (turn.sessionId !== session.id) {
        throw validationFailed("authoring turn does not belong to the session");
      }
      if (turn.stateRevision !== command.expectedRevision) {
        throw new UseCaseError("revision_conflict", `${turn.id} revision mismatch`, {
          details: { expected: command.expectedRevision, actual: turn.stateRevision },
        });
      }
      const applied = await apply({ tx, session, turn });
      const result: AuthoringTurnLifecycleResult = {
        reused: false,
        sessionId: session.id,
        turnId: applied.next.id,
        status: applied.next.status,
        ...(applied.next.taskId ? { taskId: applied.next.taskId } : {}),
        runId: applied.next.sourceRunId,
        agentReceivedIntent: false,
      };
      await deps.events.append(tx, {
        specVersion: "0.1",
        id: deps.ids.ulid("evt_"),
        type: applied.eventType,
        source: "workforce.application.authoring",
        subject: { type: "authoring_turn", id: turn.id },
        time: deps.clock.now().toISOString(),
        recordedAt: deps.clock.now().toISOString(),
        organizationId: session.organizationId,
        projectId: session.projectId,
        runId: applied.next.sourceRunId,
        actor: { type: "user" as const, id: deps.principalId },
        stream: `authoring_turn:${turn.id}`,
        correlationId: command.operationId,
        dataContentType: "application/json",
        dataSchema: `urn:workforce:event:${applied.eventType}:0.1`,
        data: {
          sessionId: session.id,
          turnId: turn.id,
          status: applied.next.status,
          agentReceivedIntent: false,
          ...(applied.extra ?? {}),
        },
        sensitivity: "internal",
      });
      await deps.receipts.complete(tx, command.operationId, {
        sessionId: result.sessionId,
        turnId: result.turnId,
        status: result.status,
        ...(result.taskId ? { taskId: result.taskId } : {}),
        runId: result.runId,
        agentReceivedIntent: false,
      });
      return result;
    });
  } catch (error) {
    await persistTurnFailure(deps, command, canonicalOperation, error);
    throw error;
  }
}

function assertOpenSession(session: AuthoringChatSession): void {
  if (session.status !== "open") {
    throw validationFailed("authoring session is not open", { status: session.status });
  }
}

function parseTurnResult(value: unknown): AuthoringTurnLifecycleResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UseCaseError("conflict", "authoring turn lifecycle receipt result is malformed");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.sessionId !== "string" ||
    typeof record.turnId !== "string" ||
    typeof record.status !== "string" ||
    record.agentReceivedIntent !== false
  ) {
    throw new UseCaseError("conflict", "authoring turn lifecycle receipt result is malformed");
  }
  return {
    reused: true,
    sessionId: record.sessionId,
    turnId: record.turnId,
    status: record.status as AuthoringChatTurn["status"],
    ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
    ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
    agentReceivedIntent: false,
  };
}

function storedFailure(value: unknown): UseCaseError {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new UseCaseError("conflict", "authoring turn failed receipt result is malformed");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || typeof record.message !== "string") {
    return new UseCaseError("conflict", "authoring turn failed receipt result is malformed");
  }
  return new UseCaseError(record.code as ProtocolError["code"], record.message, {
    retryable: typeof record.retryable === "boolean" ? record.retryable : false,
    ...(record.details && typeof record.details === "object" && !Array.isArray(record.details)
      ? { details: record.details as Record<string, unknown> }
      : {}),
  });
}

async function persistTurnFailure(
  deps: AuthoringTurnLifecycleDeps,
  command: { operationId: string; idempotencyKey: string; sessionId: string; turnId: string },
  canonicalOperation: string,
  error: unknown,
): Promise<void> {
  if (
    error instanceof UseCaseError &&
    (error.code === "idempotency_key_reused" || error.details?.status === "pending")
  ) {
    return;
  }
  const failure: ProtocolError = {
    code: error instanceof UseCaseError ? error.code : "conflict",
    message: error instanceof UseCaseError ? error.message : "authoring turn lifecycle failed",
    retryable: error instanceof UseCaseError ? error.retryable : false,
    ...(error instanceof UseCaseError && error.details ? { details: error.details } : {}),
  };
  try {
    await deps.uow.withTransaction(async (tx) => {
      const scope = {
        principalId: deps.principalId,
        clientId: deps.clientId,
        canonicalOperation,
        resource: `authoring-turn:${command.sessionId}:${command.turnId}`,
        idempotencyKey: command.idempotencyKey,
      };
      const current = await deps.receipts.get(scope);
      if (!current) {
        await deps.receipts.putPending(tx, {
          operationId: command.operationId,
          status: "pending",
          scope,
          requestDigest: digestOf(command),
          acceptedAt: deps.clock.now().toISOString(),
        });
      }
      await deps.receipts.fail(tx, command.operationId, failure);
    });
  } catch {
    // Preserve the original domain error.
  }
}
