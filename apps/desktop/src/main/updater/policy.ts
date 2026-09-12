export type UpgradeDecision = "allow" | "drain" | "reject";

export interface UpdaterHandoffInput {
  hasNonTerminalRun: boolean;
}

/**
 * Frozen T11→T17 handoff: never hot-replace a Daemon that still has
 * non-terminal Runs. `drain` stays in the decision union but is not used.
 */
export const UPGRADE_ACTIVE_RUN_POLICY = "reject" as const;

export function decideDaemonUpgrade(input: UpdaterHandoffInput): UpgradeDecision {
  return input.hasNonTerminalRun ? "reject" : "allow";
}

export const TERMINAL_RUN_STATUSES = ["succeeded", "failed", "timed_out", "cancelled"] as const;

export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

export function isTerminalRunStatus(status: string): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** Unknown statuses are treated as non-terminal (fail-closed). */
export function isNonTerminalRunStatus(status: string): boolean {
  return !isTerminalRunStatus(status);
}
