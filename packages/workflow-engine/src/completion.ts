/**
 * T09 completion barriers. T08 supplies artifact/evaluation evidence;
 * this module only decides whether a Task may enter `completed`.
 * Run exit is not an acceptance verdict: empty / fail / inconclusive
 * evaluations must not pass the gate.
 */
export type CompletionBarrierReason = "missing_artifact" | "integrity" | "evaluation_failed";

export type CompletionBarrier = { ok: true } | { ok: false; reason: CompletionBarrierReason };

export function taskCompletionBarrier(input: {
  requiredOutputsBound: boolean;
  artifacts: readonly { status: string }[];
  evaluations: readonly { verdict: string }[];
}): CompletionBarrier {
  if (!input.requiredOutputsBound) {
    return { ok: false, reason: "missing_artifact" };
  }
  if (
    input.artifacts.some(
      (artifact) => artifact.status === "quarantined" || artifact.status === "staging",
    )
  ) {
    return { ok: false, reason: "integrity" };
  }
  if (!hasTrustedPass(input.evaluations)) {
    return { ok: false, reason: "evaluation_failed" };
  }
  return { ok: true };
}

/**
 * A Task may complete only when every recorded evaluation is `pass`
 * and at least one exists. `fail`, `inconclusive`, unknown verdicts,
 * and an empty list are all `evaluation_failed`.
 */
function hasTrustedPass(evaluations: readonly { verdict: string }[]): boolean {
  return evaluations.length > 0 && evaluations.every((evaluation) => evaluation.verdict === "pass");
}

export function runTimeoutDue(nowMs: number, deadlineMs: number | undefined): boolean {
  return deadlineAtReached(nowMs, deadlineMs);
}

export function retryIsDue(nowIso: string, nextAttemptAt: string | undefined): boolean {
  if (nextAttemptAt === undefined) {
    return true;
  }
  return Date.parse(nowIso) >= Date.parse(nextAttemptAt);
}

function deadlineAtReached(nowMs: number, deadlineMs: number | undefined): boolean {
  return deadlineMs !== undefined && nowMs >= deadlineMs;
}
