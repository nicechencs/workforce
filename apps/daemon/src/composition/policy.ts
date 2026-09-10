import type { ApprovalGate } from "@workforce/domain";
import {
  CONSTRAINT,
  InMemoryPolicyEngine,
  createCanonicalAction,
  type CanonicalAction,
  type InMemoryPolicyEngineOptions,
  type PolicyDecision,
  type RequestedConstraint,
} from "@workforce/policy";

import { AppError } from "../modules/errors.js";

const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CompositionStartRequest {
  runtime: string;
  resource?: string;
  budgetHardLimitMinor?: number;
}

export function createCompositionPolicy(
  options: InMemoryPolicyEngineOptions = {},
): CompositionPolicy {
  return new CompositionPolicy(new InMemoryPolicyEngine(options));
}

/**
 * Production adapter over `@workforce/policy`. Does not invent rules: start uses
 * `decideStart` + DEFAULT_RULES, approvals use `createCanonicalAction` types
 * already declared as `plan.apply` / `artifact.publish`.
 */
export class CompositionPolicy {
  constructor(readonly engine: InMemoryPolicyEngine) {}

  requestedStartConstraints(input: { budgetHardLimitMinor?: number }): RequestedConstraint[] {
    if (input.budgetHardLimitMinor === undefined) {
      return [];
    }
    return [{ name: CONSTRAINT.moneyHardCap, hard: true }];
  }

  async assertStartAllowed(input: CompositionStartRequest): Promise<void> {
    const requested = this.requestedStartConstraints(input);
    const decision = await this.engine.decideStart({
      runtime: input.runtime,
      requested,
      params: {
        runtime: input.runtime,
        requested,
        ...(input.budgetHardLimitMinor !== undefined
          ? { budgetHardLimitMinor: input.budgetHardLimitMinor }
          : {}),
      },
      resource: input.resource ?? `runtime:${input.runtime}`,
    });
    this.assertAllowed(decision, "start");
  }

  async assertPauseAllowed(runtime: string): Promise<void> {
    const requested: RequestedConstraint[] = [{ name: CONSTRAINT.pause, hard: true }];
    const decision = await this.engine.decideStart({
      runtime,
      requested,
      params: { runtime, requested },
      resource: `runtime:${runtime}`,
    });
    this.assertAllowed(decision, "pause");
  }

  planApplyAction(input: { resource: string; plan: unknown; version?: string }): CanonicalAction {
    return createCanonicalAction({
      type: "plan.apply",
      resource: input.resource,
      params: input.plan,
      ...(input.version !== undefined ? { version: input.version } : {}),
    });
  }

  artifactPublishAction(input: {
    resource: string;
    version: string;
    hash: string;
    slotId?: string;
  }): CanonicalAction {
    return createCanonicalAction({
      type: "artifact.publish",
      resource: input.resource,
      version: input.version,
      params: {
        hash: input.hash,
        ...(input.slotId !== undefined ? { slotId: input.slotId } : {}),
      },
    });
  }

  assertDigestMatch(expected: string, actual: string): void {
    if (expected !== actual) {
      throw new AppError("conflict", "Approval digest does not match the canonical action");
    }
  }

  async consumeGrant(input: {
    action: CanonicalAction;
    gate: ApprovalGate;
    expiresAt?: string;
  }): Promise<PolicyDecision> {
    await this.engine.recordGrant({
      action: input.action,
      gate: input.gate,
      expiresAt: input.expiresAt ?? new Date(Date.now() + GRANT_TTL_MS).toISOString(),
    });
    const decision = await this.engine.decide(input.action);
    this.assertAllowed(decision, "approval consume");
    return decision;
  }

  assertAllowed(decision: PolicyDecision, operation: string): void {
    if (decision.decision === "allow") {
      return;
    }
    if (decision.decision === "deny") {
      throwDenied(decision);
    }
    throw new AppError("forbidden", `policy requires approval before ${operation}`);
  }
}

function throwDenied(decision: PolicyDecision): never {
  const reason = decision.reason ?? "policy_denied";
  if (reason.startsWith("unknown_cost_not_enforceable")) {
    throw new AppError(
      "unknown_cost_not_enforceable",
      "Mock run cost is unknown and cannot enforce a hard currency limit",
    );
  }
  if (reason.startsWith("unsupported_capability")) {
    const capability = reason.split(":")[1] ?? "capability";
    throw new AppError("unsupported_capability", `${capability} is unsupported`);
  }
  throw new AppError("forbidden", reason);
}
