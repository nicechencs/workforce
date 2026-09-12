/**
 * T09 completion barriers. T08 supplies artifact/evaluation evidence;
 * this module only decides whether a Task may enter `completed`.
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
  if (input.evaluations.some((evaluation) => evaluation.verdict === "fail")) {
    return { ok: false, reason: "evaluation_failed" };
  }
  return { ok: true };
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
