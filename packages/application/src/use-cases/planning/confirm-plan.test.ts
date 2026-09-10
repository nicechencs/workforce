import { describe, expect, it } from "vitest";

import type {
  Clock,
  CommandReceiptRepository,
  EventStore,
  IdGenerator,
  Tx,
  UnitOfWork,
} from "../../ports/index.js";
import type {
  CommandReceipt,
  ProtocolError,
  ReceiptScope,
  WorkforceEvent,
} from "@workforce/protocol";

import { confirmPlan } from "./confirm-plan.js";
import { contentDigest } from "./digest.js";
import { mockPlanFixture } from "./mock-plan.js";
import type { ConfirmPlanDeps } from "./ports.js";
import type {
  ConfirmPlanCommand,
  ConfirmedWorkflowVersion,
  PlanApprovalRecord,
  PlanArtifactRecord,
  ProjectSnapshot,
} from "./types.js";

class SeqIds implements IdGenerator {
  private n = 0;
  ulid(prefix: string): string {
    this.n += 1;
    return `${prefix}${String(this.n).padStart(4, "0")}`;
  }
}

class FixedClock implements Clock {
  constructor(private readonly iso = "2026-09-10T12:00:00.000Z") {}
  now(): Date {
    return new Date(this.iso);
  }
}

class ImmediateUow implements UnitOfWork {
  async withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn({ kind: "tx" });
  }
}

class MemoryEvents implements EventStore {
  readonly events: WorkforceEvent[] = [];
  async append(_tx: Tx, event: WorkforceEvent): Promise<{ ingestionPosition: number }> {
    const ingestionPosition = this.events.length + 1;
    this.events.push(event);
    return { ingestionPosition };
  }
  async read(): Promise<WorkforceEvent[]> {
    return this.events;
  }
}

class MemoryReceipts implements CommandReceiptRepository {
  private readonly byKey = new Map<string, CommandReceipt>();
  private readonly byOp = new Map<string, CommandReceipt>();

  private key(scope: ReceiptScope): string {
    return `${scope.principalId}|${scope.clientId}|${scope.canonicalOperation}|${scope.resource}|${scope.idempotencyKey}`;
  }

  async get(scope: ReceiptScope): Promise<CommandReceipt | null> {
    return this.byKey.get(this.key(scope)) ?? null;
  }

  async putPending(_tx: Tx, receipt: CommandReceipt): Promise<void> {
    this.byKey.set(this.key(receipt.scope), receipt);
    this.byOp.set(receipt.operationId, receipt);
  }

  async complete(_tx: Tx, operationId: string, result: unknown): Promise<void> {
    const current = this.byOp.get(operationId);
    if (!current) {
      return;
    }
    const next: CommandReceipt = { ...current, status: "committed", result };
    this.byOp.set(operationId, next);
    this.byKey.set(this.key(next.scope), next);
  }

  async fail(_tx: Tx, operationId: string, error: ProtocolError): Promise<void> {
    const current = this.byOp.get(operationId);
    if (!current) {
      return;
    }
    const next: CommandReceipt = { ...current, status: "failed", result: error };
    this.byOp.set(operationId, next);
    this.byKey.set(this.key(next.scope), next);
  }
}

interface Harness {
  deps: ConfirmPlanDeps;
  events: MemoryEvents;
  plans: Map<string, PlanArtifactRecord>;
  approvals: Map<string, PlanApprovalRecord>;
  projects: Map<string, ProjectSnapshot>;
  confirmed: Map<string, ConfirmedWorkflowVersion>;
}

function createHarness(): Harness {
  const plan = mockPlanFixture();
  const digest = contentDigest(plan);
  const plans = new Map<string, PlanArtifactRecord>([
    [
      "arv_plan",
      {
        artifactVersionId: "arv_plan",
        status: "available",
        hash: digest,
        body: plan,
      },
    ],
  ]);
  const approvals = new Map<string, PlanApprovalRecord>([
    [
      "apr_plan",
      {
        approvalId: "apr_plan",
        gate: "plan",
        projectId: "prj_1",
        planArtifactVersionId: "arv_plan",
        digest,
        status: "approved",
        principalId: "usr_1",
        policyVersion: "0.1.0",
        expiresAt: "2026-09-11T00:00:00.000Z",
      },
    ],
  ]);
  const projects = new Map<string, ProjectSnapshot>([
    ["prj_1", { projectId: "prj_1", status: "planning", stateRevision: 2 }],
  ]);
  const confirmed = new Map<string, ConfirmedWorkflowVersion>();
  const events = new MemoryEvents();
  const deps: ConfirmPlanDeps = {
    clock: new FixedClock(),
    ids: new SeqIds(),
    uow: new ImmediateUow(),
    events,
    receipts: new MemoryReceipts(),
    projects: {
      get: async (id) => projects.get(id) ?? null,
    },
    plans: {
      get: async (id) => plans.get(id) ?? null,
    },
    approvals: {
      get: async (id) => approvals.get(id) ?? null,
      consume: async (id, consumedAt) => {
        const current = approvals.get(id);
        if (!current) {
          return;
        }
        approvals.set(id, { ...current, status: "consumed", consumedAt });
      },
    },
    confirmed: {
      getByProject: async (projectId) => confirmed.get(projectId) ?? null,
      put: async (version) => {
        confirmed.set(version.projectId, version);
      },
    },
  };
  return { deps, events, plans, approvals, projects, confirmed };
}

function command(overrides: Partial<ConfirmPlanCommand> = {}): ConfirmPlanCommand {
  const plan = mockPlanFixture();
  return {
    operationId: "op_confirm_1",
    idempotencyKey: "idem_confirm_1",
    projectId: "prj_1",
    planArtifactVersionId: "arv_plan",
    planDigest: contentDigest(plan),
    approvalId: "apr_plan",
    principalId: "usr_1",
    clientId: "cli_1",
    ...overrides,
  };
}

describe("confirmPlan", () => {
  it("publishes a confirmed WorkflowVersion description without starting the workflow", async () => {
    const h = createHarness();
    const result = await confirmPlan(command(), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.replayed).toBe(false);
    expect(result.workflowVersion.immutable).toBe(true);
    expect(result.workflowVersion.workflowStarted).toBe(false);
    expect(result.workflowVersion.intendedProjectStatus).toBe("ready");
    expect(result.workflowVersion.entryNodeIds.sort()).toEqual(["dev_alpha", "dev_bravo"]);
    expect(result.workflowVersion.nodes.map((node) => node.id)).toEqual([
      "dev_alpha",
      "dev_bravo",
      "review_integration",
      "approve_delivery",
    ]);
    expect(result.workflowVersion.runtime.adapterId).toBe("mock");
    expect(h.events.events.map((event) => event.type)).toEqual(["project.plan_confirmed"]);
    expect(h.approvals.get("apr_plan")?.status).toBe("consumed");
    expect(h.confirmed.get("prj_1")?.workflowVersionId).toBe(
      result.workflowVersion.workflowVersionId,
    );
  });

  it("does not instantiate a development graph when the plan is not approved", async () => {
    const h = createHarness();
    const pending = h.approvals.get("apr_plan");
    if (pending) {
      h.approvals.set("apr_plan", { ...pending, status: "pending" });
    }
    const result = await confirmPlan(command(), h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("invalid_transition");
    expect(result.error.message).toMatch(/not approved/);
    expect(h.confirmed.size).toBe(0);
    expect(h.events.events).toEqual([]);
  });

  it("does not re-instantiate when the same plan is approved again", async () => {
    const h = createHarness();
    const first = await confirmPlan(command(), h.deps);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const second = await confirmPlan(
      command({ operationId: "op_confirm_2", idempotencyKey: "idem_confirm_2" }),
      h.deps,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.replayed).toBe(true);
    expect(second.workflowVersion.workflowVersionId).toBe(first.workflowVersion.workflowVersionId);
    expect(h.events.events).toHaveLength(1);
  });

  it("replays a committed receipt for the same idempotency key", async () => {
    const h = createHarness();
    const first = await confirmPlan(command(), h.deps);
    expect(first.ok).toBe(true);
    const second = await confirmPlan(command(), h.deps);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.replayed).toBe(true);
  });

  it("rejects a digest mismatch", async () => {
    const h = createHarness();
    const result = await confirmPlan(command({ planDigest: "fnv1a64:deadbeefdeadbeef" }), h.deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("conflict");
    }
    expect(h.confirmed.size).toBe(0);
  });

  it("keeps reviewer edges on outputs_ready so developers do not wait for reviewer completed", async () => {
    const h = createHarness();
    const result = await confirmPlan(command(), h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const intoReview = result.workflowVersion.edges.filter(
      (edge) => edge.to === "review_integration",
    );
    expect(intoReview).toHaveLength(2);
    expect(intoReview.every((edge) => edge.onUpstream === "outputs_ready")).toBe(true);
    expect(
      result.workflowVersion.edges.some(
        (edge) => edge.from === "review_integration" && edge.to.startsWith("dev_"),
      ),
    ).toBe(false);
  });
});
