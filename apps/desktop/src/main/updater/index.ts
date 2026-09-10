export type UpgradeDecision = "allow" | "drain" | "reject";

export interface UpdaterHandoffInput {
  hasNonTerminalRun: boolean;
}

/**
 * T17 owns packaging and the actual updater. T11 only freezes the handoff:
 * never hot-replace a Daemon that still has non-terminal Runs.
 */
export function decideDaemonUpgrade(input: UpdaterHandoffInput): UpgradeDecision {
  return input.hasNonTerminalRun ? "reject" : "allow";
}

export const updaterDirectory = "src/main/updater" as const;
