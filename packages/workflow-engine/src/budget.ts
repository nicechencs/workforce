export interface BudgetAmount {
  costMinor: number;
  currency: string;
  kind?: "unknown" | "estimated" | "settled";
}

export interface BudgetState {
  currency: string;
  limitMinor: number;
  reservedMinor: number;
  settledMinor: number;
  authorizationVersion: number;
}

export type BudgetDecision =
  | { ok: true; state: BudgetState }
  | {
      ok: false;
      code: "unknown_cost_not_enforceable" | "conflict" | "validation_failed";
      message: string;
    };

export function availableMinor(state: BudgetState): number {
  return state.limitMinor - state.reservedMinor - state.settledMinor;
}

export function reserveBudget(state: BudgetState, amount: BudgetAmount): BudgetDecision {
  if (amount.kind === "unknown") {
    return {
      ok: false,
      code: "unknown_cost_not_enforceable",
      message: "unknown cost cannot be reserved as zero",
    };
  }
  if (amount.currency !== state.currency) {
    return { ok: false, code: "validation_failed", message: "currency mismatch" };
  }
  if (amount.costMinor < 0) {
    return { ok: false, code: "validation_failed", message: "reservation must be non-negative" };
  }
  if (amount.costMinor > availableMinor(state)) {
    return { ok: false, code: "conflict", message: "budget limit exceeded" };
  }
  return {
    ok: true,
    state: { ...state, reservedMinor: state.reservedMinor + amount.costMinor },
  };
}

export function releaseReservation(state: BudgetState, amountMinor: number): BudgetDecision {
  if (amountMinor < 0 || amountMinor > state.reservedMinor) {
    return { ok: false, code: "validation_failed", message: "cannot release more than reserved" };
  }
  return { ok: true, state: { ...state, reservedMinor: state.reservedMinor - amountMinor } };
}

export function settleUsage(
  state: BudgetState,
  amount: BudgetAmount,
  usageKey: string,
  seenKeys: ReadonlySet<string>,
): BudgetDecision & { duplicate: boolean } {
  if (seenKeys.has(usageKey)) {
    return { ok: true, state, duplicate: true };
  }
  if (amount.kind === "unknown") {
    return {
      ok: false,
      code: "unknown_cost_not_enforceable",
      message: "unknown cost cannot settle as zero",
      duplicate: false,
    };
  }
  if (amount.currency !== state.currency) {
    return { ok: false, code: "validation_failed", message: "currency mismatch", duplicate: false };
  }
  const fromReserved = Math.min(state.reservedMinor, amount.costMinor);
  const remainder = amount.costMinor - fromReserved;
  if (remainder > availableMinor({ ...state, reservedMinor: state.reservedMinor - fromReserved })) {
    return { ok: false, code: "conflict", message: "budget limit exceeded", duplicate: false };
  }
  return {
    ok: true,
    duplicate: false,
    state: {
      ...state,
      reservedMinor: state.reservedMinor - fromReserved,
      settledMinor: state.settledMinor + amount.costMinor,
    },
  };
}

export function raiseBudget(state: BudgetState, newLimitMinor: number): BudgetDecision {
  if (newLimitMinor < state.limitMinor) {
    return { ok: false, code: "validation_failed", message: "budget raise cannot lower the limit" };
  }
  return {
    ok: true,
    state: {
      ...state,
      limitMinor: newLimitMinor,
      authorizationVersion: state.authorizationVersion + 1,
    },
  };
}
