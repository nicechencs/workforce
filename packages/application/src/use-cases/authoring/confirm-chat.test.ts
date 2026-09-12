import { describe, expect, it } from "vitest";

import type {
  AuthoringChatPatchBinding,
  AuthoringChatProposalResolver,
  AuthoringChatProject,
  AuthoringChatSession,
  AuthoringChatSourceRun,
  AuthoringChatTurn,
  ConfirmChatProposalCommand,
  ConfirmChatProposalDeps,
} from "./authoring.js";
import { confirmAuthoringChatProposal, sha256CanonicalDigest } from "./authoring.js";
import type {
  CommandReceipt,
  EventStore,
  ProtocolError,
  Tx,
  WorkforceEvent,
  WorkflowDraftDto,
} from "@workforce/protocol";
import type { Clock, IdGenerator, UnitOfWork } from "../../ports/index.js";
import type { WorkflowDefinitionRecord } from "../catalog/types.js";

const graph = {
  entryNodeIds: ["node_1"],
  nodes: [{ id: "node_1", kind: "task" as const, role: "developer" as const }],
  edges: [],
  failurePolicy: { default: "fail" as const },
  concurrencyPolicy: {
    runWorktree: "isolated" as const,
    integrationWorktree: "dedicated" as const,
  },
};

const tx: Tx = { kind: "tx" };

class FakeClock implements Clock {
  now(): Date {
    return new Date("2026-09-12T10:00:00.000Z");
  }
}

class FakeIds implements IdGenerator {
  private count = 0;

  ulid(prefix: string): string {
    this.count += 1;
    return `${prefix}${this.count}`;
  }
}

class FakeTransactionalState {
  projects = new Map<string, AuthoringChatProject>();
  sourceRuns = new Map<string, AuthoringChatSourceRun>();
  sessions = new Map<string, AuthoringChatSession>();
  turns = new Map<string, AuthoringChatTurn>();
  patches = new Map<string, AuthoringChatPatchBinding>();
  identities = new Map<string, WorkflowDefinitionRecord>();
  authorities = new Map<string, { organizationId: string; projectId: string }>();
  drafts = new Map<string, WorkflowDraftDto>();
  receipts = new Map<string, CommandReceipt>();
  events: WorkforceEvent[] = [];
  failEvent = false;

  snapshot(): FakeTransactionalState {
    const copy = new FakeTransactionalState();
    copy.projects = new Map(this.projects);
    copy.sourceRuns = new Map(this.sourceRuns);
    copy.sessions = new Map(this.sessions);
    copy.turns = new Map(
      [...this.turns.entries()].map(([key, value]) => [
        key,
        { ...value, patchRefs: [...value.patchRefs] },
      ]),
    );
    copy.patches = new Map(this.patches);
    copy.identities = new Map(this.identities);
    copy.authorities = new Map(this.authorities);
    copy.drafts = new Map(this.drafts);
    copy.receipts = new Map(
      [...this.receipts.entries()].map(([key, value]) => [
        key,
        { ...value, scope: { ...value.scope } },
      ]),
    );
    copy.events = [...this.events];
    copy.failEvent = this.failEvent;
    return copy;
  }

  restore(snapshot: FakeTransactionalState): void {
    this.projects = snapshot.projects;
    this.sourceRuns = snapshot.sourceRuns;
    this.sessions = snapshot.sessions;
    this.turns = snapshot.turns;
    this.patches = snapshot.patches;
    this.identities = snapshot.identities;
    this.authorities = snapshot.authorities;
    this.drafts = snapshot.drafts;
    this.receipts = snapshot.receipts;
    this.events = snapshot.events;
    this.failEvent = snapshot.failEvent;
  }
}

class FakeUow implements UnitOfWork {
  constructor(private readonly state: FakeTransactionalState) {}

  async withTransaction<T>(fn: (transaction: Tx) => Promise<T>): Promise<T> {
    const snapshot = this.state.snapshot();
    try {
      return await fn(tx);
    } catch (error) {
      this.state.restore(snapshot);
      throw error;
    }
  }
}

function receiptKey(scope: CommandReceipt["scope"]): string {
  return [
    scope.principalId,
    scope.clientId,
    scope.canonicalOperation,
    scope.resource,
    scope.idempotencyKey,
  ].join("\u0000");
}

function depsFor(state = new FakeTransactionalState()): ConfirmChatProposalDeps {
  return {
    clock: new FakeClock(),
    ids: new FakeIds(),
    uow: new FakeUow(state),
    events: {
      async append(_tx: Tx, event: WorkforceEvent) {
        if (state.failEvent) throw new Error("event append failed");
        state.events.push(event);
        return { ingestionPosition: state.events.length };
      },
      async read() {
        return state.events;
      },
    } satisfies EventStore,
    receipts: {
      async get(scope) {
        return state.receipts.get(receiptKey(scope)) ?? null;
      },
      async putPending(_tx, receipt) {
        state.receipts.set(receiptKey(receipt.scope), receipt);
      },
      async complete(_tx, operationId, result) {
        const entry = [...state.receipts.entries()].find(
          ([, receipt]) => receipt.operationId === operationId,
        );
        if (!entry) throw new Error("missing receipt");
        const [key, receipt] = entry;
        state.receipts.set(key, { ...receipt, status: "committed", result });
      },
      async fail(_tx, operationId, error: ProtocolError) {
        const entry = [...state.receipts.entries()].find(
          ([, receipt]) => receipt.operationId === operationId,
        );
        if (!entry) throw new Error("missing receipt");
        const [key, receipt] = entry;
        state.receipts.set(key, { ...receipt, status: "failed", result: error });
      },
    },
    projects: { getInTransaction: (_tx, id) => state.projects.get(id) ?? null },
    sourceRuns: { getInTransaction: (_tx, id) => state.sourceRuns.get(id) ?? null },
    sessions: { getInTransaction: (_tx, id) => state.sessions.get(id) ?? null },
    turns: { getInTransaction: (_tx, id) => state.turns.get(id) ?? null },
    patches: { getInTransaction: (_tx, id) => state.patches.get(id) ?? null },
    workflowIdentities: {
      create: (_tx, identity) => {
        if (state.identities.has(identity.id)) throw new Error("identity exists");
        state.identities.set(identity.id, identity);
      },
    },
    workflowAuthorities: {
      create: (_tx, authority) => {
        if (state.authorities.has(authority.workflowId)) throw new Error("authority exists");
        state.authorities.set(authority.workflowId, {
          organizationId: authority.organizationId,
          projectId: authority.projectId,
        });
      },
      requireInTransaction: (_tx, workflowId, expected) => {
        const authority = state.authorities.get(workflowId);
        if (!authority) throw new Error("missing authority");
        if (
          authority.projectId !== expected.projectId ||
          authority.organizationId !== expected.organizationId
        ) {
          throw new Error("authority scope mismatch");
        }
        return authority;
      },
    },
    workflowDrafts: {
      getCurrentRevision: (_tx, workflowId, expected) => {
        if (!state.authorities.has(workflowId)) throw new Error("missing authority");
        const authority = state.authorities.get(workflowId)!;
        if (
          authority.projectId !== expected.projectId ||
          authority.organizationId !== expected.organizationId
        ) {
          throw new Error("authority scope mismatch");
        }
        return Math.max(
          0,
          ...[...state.drafts.values()]
            .filter((draft) => draft.workflowId === workflowId)
            .map((draft) => draft.revision),
        );
      },
      append: (_tx, draft, expectedRevision, expected) => {
        const authority = state.authorities.get(draft.workflowId);
        if (
          !authority ||
          authority.projectId !== expected.projectId ||
          authority.organizationId !== expected.organizationId
        ) {
          throw new Error("authority scope mismatch");
        }
        const current = Math.max(
          0,
          ...[...state.drafts.values()]
            .filter((item) => item.workflowId === draft.workflowId)
            .map((item) => item.revision),
        );
        if (current !== expectedRevision || draft.revision !== current + 1) {
          throw new Error("revision conflict");
        }
        state.drafts.set(draft.id, draft);
      },
    },
    resolver: resolverFor(),
    principalId: "usr_author",
    clientId: "cli_desktop",
  };
}

function resolverFor(): AuthoringChatProposalResolver {
  return {
    resolveWorkflowGraph: ({
      projectId,
      sourceRunId,
      operation,
      patchRef,
      workflowId,
      expectedRevision,
    }) => ({
      graph,
      binding: {
        organizationId: "org_authoring",
        projectId,
        sessionId: "session_1",
        turnId: "turn_1",
        sourceRunId,
        patchRef,
        ...(operation === "update" ? { workflowId, expectedRevision } : {}),
      },
    }),
  };
}

function command(overrides: Partial<ConfirmChatProposalCommand> = {}): ConfirmChatProposalCommand {
  return {
    operationId: "op_confirm",
    idempotencyKey: "confirm-key",
    proposal: {
      id: "proposal_1",
      projectId: "project_1",
      sessionId: "session_1",
      turnId: "turn_1",
      sourceRunId: "run_1",
      summary: "secret prompt must not be persisted",
      targets: [{ operation: "create", targetType: "workflow", patchRef: "patch_1" }],
    },
    ...overrides,
  };
}

function seed(state: FakeTransactionalState): void {
  state.projects.set("project_1", { id: "project_1", organizationId: "org_authoring" });
  state.sourceRuns.set("run_1", {
    id: "run_1",
    projectId: "project_1",
    organizationId: "org_authoring",
  });
  state.sessions.set("session_1", {
    id: "session_1",
    projectId: "project_1",
    organizationId: "org_authoring",
  });
  state.turns.set("turn_1", {
    id: "turn_1",
    sessionId: "session_1",
    projectId: "project_1",
    sourceRunId: "run_1",
    patchRefs: ["patch_1"],
  });
  state.patches.set("patch_1", {
    patchRef: "patch_1",
    organizationId: "org_authoring",
    projectId: "project_1",
    sessionId: "session_1",
    turnId: "turn_1",
    sourceRunId: "run_1",
  });
}

describe("confirmAuthoringChatProposal", () => {
  it("creates identity, authority, revision one draft and committed receipt atomically", async () => {
    const state = new FakeTransactionalState();
    seed(state);
    const result = await confirmAuthoringChatProposal(command(), depsFor(state));

    expect(result).toMatchObject({
      reused: false,
      proposalId: "proposal_1",
      projectId: "project_1",
    });
    const ref = result.workflowDrafts[0]!;
    expect(state.identities.get(ref.workflowId)).toMatchObject({ status: "draft" });
    expect(state.authorities.get(ref.workflowId)).toEqual({
      organizationId: "org_authoring",
      projectId: "project_1",
    });
    expect(state.drafts.get(ref.workflowDraftId)).toMatchObject({ revision: 1, graph });
    expect(state.receipts.values().next().value).toMatchObject({ status: "committed" });
    expect(JSON.stringify(state.events)).not.toContain("secret prompt");
    expect(JSON.stringify([...state.receipts.values()])).not.toContain("secret prompt");
  });

  it("rolls back all domain writes when event append fails, while recording an honest failure", async () => {
    const state = new FakeTransactionalState();
    seed(state);
    state.failEvent = true;
    await expect(confirmAuthoringChatProposal(command(), depsFor(state))).rejects.toThrow(
      "event append failed",
    );
    expect(state.identities).toHaveLength(0);
    expect(state.authorities).toHaveLength(0);
    expect(state.drafts).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.receipts.values().next().value).toMatchObject({ status: "failed" });
  });

  it("replays only a strictly parsed committed receipt", async () => {
    const state = new FakeTransactionalState();
    seed(state);
    const deps = depsFor(state);
    const first = await confirmAuthoringChatProposal(command(), deps);
    const second = await confirmAuthoringChatProposal(command({ operationId: "op_retry" }), deps);
    expect(second).toEqual({ ...first, reused: true });
    expect(state.drafts).toHaveLength(1);

    const key = receiptKey({
      principalId: "usr_author",
      clientId: "cli_desktop",
      canonicalOperation: "authoring.confirm-chat-proposal",
      resource: "project:project_1",
      idempotencyKey: "confirm-key",
    });
    state.receipts.set(key, {
      ...state.receipts.get(key)!,
      status: "committed",
      result: {
        proposalId: "proposal_1",
        projectId: "project_1",
        workflowDrafts: [],
        prompt: "bad",
      },
    });
    await expect(confirmAuthoringChatProposal(command(), deps)).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("does not treat pending or failed receipts as successful replays", async () => {
    const state = new FakeTransactionalState();
    seed(state);
    const deps = depsFor(state);
    const scope = {
      principalId: "usr_author",
      clientId: "cli_desktop",
      canonicalOperation: "authoring.confirm-chat-proposal",
      resource: "project:project_1",
      idempotencyKey: "confirm-key",
    } as const;
    const digest = sha256CanonicalDigest(command().proposal);
    state.receipts.set(receiptKey(scope), {
      operationId: "op_old",
      status: "pending",
      scope,
      requestDigest: digest,
      acceptedAt: "2026-09-12T10:00:00.000Z",
    });
    await expect(confirmAuthoringChatProposal(command(), deps)).rejects.toMatchObject({
      code: "conflict",
      details: { status: "pending" },
    });
    state.receipts.set(receiptKey(scope), {
      ...state.receipts.get(receiptKey(scope))!,
      status: "failed",
      result: { code: "revision_conflict", message: "stale", retryable: false },
    });
    await expect(confirmAuthoringChatProposal(command(), deps)).rejects.toMatchObject({
      code: "revision_conflict",
    });
  });

  it("rejects key/digest conflicts, cross-scope proof and stale update CAS", async () => {
    const state = new FakeTransactionalState();
    seed(state);
    const deps = depsFor(state);
    await confirmAuthoringChatProposal(command(), deps);
    await expect(
      confirmAuthoringChatProposal(
        command({ proposal: { ...command().proposal, summary: "different payload" } }),
        deps,
      ),
    ).rejects.toMatchObject({ code: "idempotency_key_reused" });

    const crossScopeState = new FakeTransactionalState();
    seed(crossScopeState);
    const crossScopeDeps = depsFor(crossScopeState);
    crossScopeState.patches.set("patch_1", {
      ...crossScopeState.patches.get("patch_1")!,
      projectId: "project_other",
    });
    await expect(confirmAuthoringChatProposal(command(), crossScopeDeps)).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(crossScopeState.drafts).toHaveLength(0);

    const updateState = new FakeTransactionalState();
    seed(updateState);
    updateState.identities.set("wf_existing", {
      id: "wf_existing",
      name: "Existing",
      description: "",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    });
    updateState.authorities.set("wf_existing", {
      organizationId: "org_authoring",
      projectId: "project_1",
    });
    updateState.drafts.set("wfd_existing", {
      id: "wfd_existing",
      workflowId: "wf_existing",
      revision: 2,
      status: "draft",
      graph,
      contentHash: "sha256:existing",
      updatedAt: "2026-09-12T10:00:00.000Z",
      updatedBy: "usr_author",
    });
    const update = command({
      operationId: "op_update",
      idempotencyKey: "update-key",
      proposal: {
        ...command().proposal,
        id: "proposal_update",
        targets: [
          {
            operation: "update",
            targetType: "workflow",
            targetId: "wf_existing",
            expectedRevision: 1,
            patchRef: "patch_1",
          },
        ],
      },
    });
    await expect(confirmAuthoringChatProposal(update, depsFor(updateState))).rejects.toMatchObject({
      code: "validation_failed",
    });
    expect(updateState.drafts).toHaveLength(1);
  });
});
