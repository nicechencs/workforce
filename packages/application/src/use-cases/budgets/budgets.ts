import type { AppContext } from "../projects/context.js";
import { notFound } from "../projects/errors.js";
import { UseCaseError } from "../projects/errors.js";
import type { BudgetAmount } from "../projects/engine-port.js";
import type { BudgetRecord } from "../projects/store.js";

export function requireBudget(ctx: AppContext, budgetId: string): BudgetRecord {
  const budget = ctx.world.budgets.get(budgetId);
  if (!budget) {
    throw notFound("budget", budgetId);
  }
  return budget;
}

function applyDecision(
  budget: BudgetRecord,
  decision: ReturnType<AppContext["engine"]["reserveBudget"]>,
): BudgetRecord {
  if (!decision.ok) {
    throw new UseCaseError(decision.code, decision.message);
  }
  Object.assign(budget, decision.state);
  return budget;
}

export function reserveRunBudget(
  ctx: AppContext,
  input: { budgetId: string; amount: BudgetAmount; runId?: string },
): { reservationId: string; budget: BudgetRecord } {
  const budget = requireBudget(ctx, input.budgetId);
  applyDecision(budget, ctx.engine.reserveBudget(budget, input.amount));
  const reservationId = ctx.world.ids.ulid("rsv_");
  ctx.world.reservations.set(reservationId, {
    id: reservationId,
    budgetId: budget.id,
    amountMinor: input.amount.costMinor,
    ...(input.runId ? { runId: input.runId } : {}),
  });
  return { reservationId, budget };
}

export function releaseRunBudget(ctx: AppContext, reservationId: string): BudgetRecord {
  const reservation = ctx.world.reservations.get(reservationId);
  if (!reservation) {
    throw notFound("reservation", reservationId);
  }
  const budget = requireBudget(ctx, reservation.budgetId);
  applyDecision(budget, ctx.engine.releaseReservation(budget, reservation.amountMinor));
  ctx.world.reservations.delete(reservationId);
  return budget;
}

export function settleRunUsage(
  ctx: AppContext,
  input: { budgetId: string; amount: BudgetAmount; usageKey: string },
): BudgetRecord {
  const budget = requireBudget(ctx, input.budgetId);
  const decision = ctx.engine.settleUsage(
    budget,
    input.amount,
    input.usageKey,
    ctx.world.usageKeys,
  );
  if (!decision.ok) {
    throw new UseCaseError(decision.code, decision.message);
  }
  if (!decision.duplicate) {
    ctx.world.usageKeys.add(input.usageKey);
  }
  Object.assign(budget, decision.state);
  return budget;
}

export function raiseProjectBudget(
  ctx: AppContext,
  input: { budgetId: string; newLimitMinor: number; approvalId?: string },
): BudgetRecord {
  const budget = requireBudget(ctx, input.budgetId);
  const pending = [...ctx.world.approvals.values()].find(
    (approval) =>
      approval.projectId === budget.projectId &&
      approval.gate === "budget" &&
      approval.status === "pending",
  );
  if (pending) {
    throw new UseCaseError(
      "validation_failed",
      "budget raise requires the pending budget approval to be consumed",
      { details: { approvalId: pending.id } },
    );
  }
  if (input.approvalId) {
    const approval = ctx.world.approvals.get(input.approvalId);
    if (!approval || approval.gate !== "budget" || approval.status !== "consumed") {
      throw new UseCaseError(
        "validation_failed",
        "budget raise requires a consumed budget approval",
      );
    }
  }
  return applyDecision(budget, ctx.engine.raiseBudget(budget, input.newLimitMinor));
}
