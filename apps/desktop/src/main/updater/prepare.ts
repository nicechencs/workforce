import { probeNonTerminalRuns, type ActiveRunProbe } from "./active-runs.js";
import { createStateBackup, restoreStateBackup, type StateBackupManifest } from "./backup.js";
import { decideDaemonUpgrade, UPGRADE_ACTIVE_RUN_POLICY, type UpgradeDecision } from "./policy.js";

export type PrepareUpgradeResult =
  | {
      ok: true;
      decision: "allow";
      policy: typeof UPGRADE_ACTIVE_RUN_POLICY;
      backupDir: string;
      manifest: StateBackupManifest;
      probe: Extract<ActiveRunProbe, { ok: true }>;
    }
  | {
      ok: false;
      decision: UpgradeDecision;
      policy: typeof UPGRADE_ACTIVE_RUN_POLICY;
      reason: "active_run" | "active_run_unknown" | "drain_unsupported";
      probe: ActiveRunProbe;
    };

export interface PrepareDaemonUpgradeInput {
  stateDir: string;
  backupDir?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * Backup-then-replace is only allowed when `decideDaemonUpgrade` returns `allow`.
 * Active Runs freeze the T11 handoff to `reject`; `drain` is not implemented.
 */
export async function prepareDaemonUpgrade(
  input: PrepareDaemonUpgradeInput,
): Promise<PrepareUpgradeResult> {
  const probeInput: { stateDir: string; fetchImpl?: typeof fetch } = { stateDir: input.stateDir };
  if (input.fetchImpl) {
    probeInput.fetchImpl = input.fetchImpl;
  }
  const probe = await probeNonTerminalRuns(probeInput);
  const decision = decideDaemonUpgrade({ hasNonTerminalRun: probe.hasNonTerminalRun });
  if (decision === "drain") {
    return {
      ok: false,
      decision,
      policy: UPGRADE_ACTIVE_RUN_POLICY,
      reason: "drain_unsupported",
      probe,
    };
  }
  if (decision !== "allow" || !probe.ok) {
    return {
      ok: false,
      decision,
      policy: UPGRADE_ACTIVE_RUN_POLICY,
      reason: probe.ok ? "active_run" : "active_run_unknown",
      probe,
    };
  }
  const backupInput: {
    stateDir: string;
    destinationDir?: string;
    now?: () => Date;
  } = { stateDir: input.stateDir };
  if (input.backupDir) {
    backupInput.destinationDir = input.backupDir;
  }
  if (input.now) {
    backupInput.now = input.now;
  }
  const backup = createStateBackup(backupInput);
  return {
    ok: true,
    decision: "allow",
    policy: UPGRADE_ACTIVE_RUN_POLICY,
    backupDir: backup.backupDir,
    manifest: backup.manifest,
    probe,
  };
}

export function rollbackUpgradeBackup(backupDir: string, stateDir: string): StateBackupManifest {
  return restoreStateBackup(backupDir, stateDir);
}
