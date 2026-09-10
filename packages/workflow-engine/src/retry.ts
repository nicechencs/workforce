export function nextBackoffMs(attempt: number, baseMs = 1000, capMs = 60_000): number {
  const exp = Math.max(0, Math.min(attempt - 1, 16));
  return Math.min(baseMs * 2 ** exp, capMs);
}

export type RecoveryKind = "retry" | "rework";

export interface RecoveryInput {
  kind: RecoveryKind;
  attempt: number;
  maxAttempts: number;
  generation: number;
  maxReworkCycles: number;
  capacityAvailable: boolean;
}

export type RecoveryDecision =
  | { action: "wait-capacity" }
  | { action: "retry"; nextAttempt: number; backoffMs: number }
  | { action: "rework"; nextGeneration: number; nextAttempt: 1 }
  | { action: "fail" };

/**
 * Capacity waits do not consume attempt budget. Technical retry stays on the
 * same generation; quality rework starts generation+1 at attempt 1.
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  if (!input.capacityAvailable) {
    return { action: "wait-capacity" };
  }
  if (input.kind === "retry") {
    if (input.attempt >= input.maxAttempts) {
      return { action: "fail" };
    }
    const nextAttempt = input.attempt + 1;
    return { action: "retry", nextAttempt, backoffMs: nextBackoffMs(nextAttempt) };
  }
  if (input.generation > input.maxReworkCycles) {
    return { action: "fail" };
  }
  return { action: "rework", nextGeneration: input.generation + 1, nextAttempt: 1 };
}
