import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  parsePlacementSnapshot,
  parseRunExecutionSnapshot,
  type PlacementSnapshot,
  type RuntimeTransport,
  type RunExecutionSnapshot,
} from "@workforce/protocol";

import { cell, optionalInt, optionalText, requiredText } from "./sql.js";

export const LEGACY_PLACEMENT_SCHEMA_VERSION = "m3.legacy.1";
export const EMPTY_VERSION_CONTENT_HASH = "sha256:empty";

export const EXECUTION_AXIS_BACKFILL_ACTIONS = [
  "already_canonical",
  "filled",
  "repair_required",
  "quarantined",
  "skipped_direct",
] as const;

export type ExecutionAxisBackfillAction = (typeof EXECUTION_AXIS_BACKFILL_ACTIONS)[number];

export interface ExecutionAxisBackfillResult {
  runId: string;
  action: ExecutionAxisBackfillAction;
  reason: string;
  snapshotId: string | null;
  sourceDigest: string;
  appliedAt: string;
}

interface RunBackfillRow {
  runId: string;
  organizationId: string;
  taskId: string;
  createdAt: string;
  orchestrationMode: string | null;
  transport: string | null;
  executionSnapshotId: string | null;
  placementSnapshotJson: string | null;
  executionNodeId: string | null;
  runtimeInstallationId: string | null;
  workspaceInstanceId: string | null;
  projectId: string;
  taskOrganizationId: string;
  projectOrganizationId: string;
  projectTeamVersionId: string | null;
  projectWorkflowVersionId: string | null;
  projectSnapshotId: string | null;
}

interface Decision {
  action: ExecutionAxisBackfillAction;
  reason: string;
  snapshot?: RunExecutionSnapshot;
  projectSnapshotId?: string;
}

/**
 * Historical M3 Run backfill. Never infers remote capability, never guesses
 * unpublished versions, and never overwrites a partial or quarantined axis.
 *
 * Called from migration 011 inside the migrator's transaction, and may be
 * re-run later: filled / already-canonical rows are no-ops, quarantine sticks.
 */
export function applyExecutionAxisBackfill(
  db: DatabaseSync,
  now: string = new Date().toISOString(),
): ExecutionAxisBackfillResult[] {
  quarantineDuplicateProjectSnapshots(db, now);
  ensureProjectExecutionSnapshots(db, now);
  const results: ExecutionAxisBackfillResult[] = [];
  for (const run of listRuns(db)) {
    const decision = decideRun(db, run);
    if (decision.action === "filled" && decision.snapshot && decision.projectSnapshotId) {
      fillRun(db, run.runId, decision.snapshot);
      bindProjectAndInstances(db, run.projectId, decision.projectSnapshotId);
    }
    results.push(recordResult(db, run, decision, now));
  }
  return results;
}

export function stampExecutionAxisSwitch(db: DatabaseSync, now: string): void {
  db.prepare("UPDATE execution_axis_authority SET switched_at = ? WHERE id = 1").run(now);
}

function quarantineDuplicateProjectSnapshots(db: DatabaseSync, now: string): void {
  const groups = db
    .prepare(
      `SELECT project_id AS project_id, COUNT(*) AS n
         FROM project_execution_snapshots
        GROUP BY project_id
       HAVING COUNT(*) > 1`,
    )
    .all();
  for (const group of groups) {
    const projectId = requiredText(cell(group, "project_id"), "project_id");
    const rows = db
      .prepare(
        `SELECT id, project_id, workflow_version_id, team_version_id, content_hash,
                policy_snapshot_json, budget_snapshot_json, created_at
           FROM project_execution_snapshots
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(projectId);
    const keeper = rows[0] as Record<string, unknown> | undefined;
    if (!keeper) continue;
    const keeperId = requiredText(cell(keeper, "id"), "id");
    const keeperHash = requiredText(cell(keeper, "content_hash"), "content_hash");
    for (const extra of rows.slice(1)) {
      const extraRow = extra as Record<string, unknown>;
      const extraId = requiredText(cell(extraRow, "id"), "id");
      const extraHash = requiredText(cell(extraRow, "content_hash"), "content_hash");
      const reason =
        extraHash === keeperHash
          ? "duplicate project execution snapshot with identical content hash"
          : "conflicting project execution snapshots for the same project";
      db.prepare(
        `INSERT OR IGNORE INTO project_execution_snapshot_conflicts (
           id, project_id, snapshot_id, content_hash, payload_json, reason, quarantined_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        extraId,
        projectId,
        extraId,
        extraHash,
        JSON.stringify({
          id: extraId,
          projectId,
          workflowVersionId: requiredText(
            cell(extraRow, "workflow_version_id"),
            "workflow_version_id",
          ),
          teamVersionId: requiredText(cell(extraRow, "team_version_id"), "team_version_id"),
          contentHash: extraHash,
        }),
        reason,
        now,
      );
      db.prepare("UPDATE runs SET execution_snapshot_id = ? WHERE execution_snapshot_id = ?").run(
        extraHash === keeperHash ? keeperId : extraId,
        extraId,
      );
      db.prepare(
        "UPDATE projects SET execution_snapshot_id = ? WHERE execution_snapshot_id = ?",
      ).run(extraHash === keeperHash ? keeperId : extraId, extraId);
      db.prepare(
        `UPDATE workflow_instances SET execution_snapshot_id = ?
          WHERE execution_snapshot_id = ?`,
      ).run(extraHash === keeperHash ? keeperId : extraId, extraId);
      db.prepare("DELETE FROM project_execution_snapshots WHERE id = ?").run(extraId);
    }
  }
}

function ensureProjectExecutionSnapshots(db: DatabaseSync, now: string): void {
  const projects = db
    .prepare(
      `SELECT id, organization_id, team_version_id, workflow_version_id,
              execution_snapshot_id, budget_id
         FROM projects
        ORDER BY created_at ASC, id ASC`,
    )
    .all();
  for (const row of projects) {
    const record = row as Record<string, unknown>;
    const projectId = requiredText(cell(record, "id"), "id");
    const existingId = optionalText(cell(record, "execution_snapshot_id"));
    if (existingId !== null) {
      const existing = db
        .prepare("SELECT id FROM project_execution_snapshots WHERE id = ?")
        .get(existingId);
      if (existing) continue;
    }
    const byProject = db
      .prepare(
        `SELECT id FROM project_execution_snapshots
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
      )
      .get(projectId) as Record<string, unknown> | undefined;
    if (byProject) {
      const snapshotId = requiredText(cell(byProject, "id"), "id");
      db.prepare("UPDATE projects SET execution_snapshot_id = ? WHERE id = ?").run(
        snapshotId,
        projectId,
      );
      bindWorkflowInstances(db, projectId, snapshotId);
      continue;
    }
    const teamVersionId = optionalText(cell(record, "team_version_id"));
    const workflowVersionId = optionalText(cell(record, "workflow_version_id"));
    if (teamVersionId === null || workflowVersionId === null) continue;
    if (!isPublishedVersion(db, "team_versions", teamVersionId)) continue;
    if (!isPublishedVersion(db, "workflow_versions", workflowVersionId)) continue;
    const budgetId = optionalText(cell(record, "budget_id"));
    const snapshotId = insertProjectSnapshot(db, {
      projectId,
      workflowVersionId,
      teamVersionId,
      budgetId,
      now,
    });
    if (snapshotId) {
      db.prepare("UPDATE projects SET execution_snapshot_id = ? WHERE id = ?").run(
        snapshotId,
        projectId,
      );
      bindWorkflowInstances(db, projectId, snapshotId);
    }
  }
}

function insertProjectSnapshot(
  db: DatabaseSync,
  input: {
    projectId: string;
    workflowVersionId: string;
    teamVersionId: string;
    budgetId: string | null;
    now: string;
  },
): string | null {
  const policySnapshot = {};
  const budgetSnapshot =
    input.budgetId === null ? undefined : readBudgetSnapshot(db, input.budgetId);
  const contentHash = snapshotContentHash({
    projectId: input.projectId,
    workflowVersionId: input.workflowVersionId,
    teamVersionId: input.teamVersionId,
    policySnapshot,
    ...(budgetSnapshot === undefined ? {} : { budgetSnapshot }),
  });
  const id = `snp_backfill_${input.projectId}`;
  try {
    db.prepare(
      `INSERT INTO project_execution_snapshots (
         id, project_id, workflow_version_id, team_version_id, content_hash,
         policy_snapshot_json, budget_snapshot_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.projectId,
      input.workflowVersionId,
      input.teamVersionId,
      contentHash,
      JSON.stringify(policySnapshot),
      budgetSnapshot === undefined ? null : JSON.stringify(budgetSnapshot),
      input.now,
    );
    return id;
  } catch {
    const existing = db
      .prepare(
        `SELECT id FROM project_execution_snapshots
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1`,
      )
      .get(input.projectId) as Record<string, unknown> | undefined;
    return existing ? requiredText(cell(existing, "id"), "id") : null;
  }
}

function bindProjectAndInstances(db: DatabaseSync, projectId: string, snapshotId: string): void {
  db.prepare(
    `UPDATE projects SET execution_snapshot_id = COALESCE(execution_snapshot_id, ?) WHERE id = ?`,
  ).run(snapshotId, projectId);
  bindWorkflowInstances(db, projectId, snapshotId);
}

function bindWorkflowInstances(db: DatabaseSync, projectId: string, snapshotId: string): void {
  const snapshot = db
    .prepare(`SELECT workflow_version_id FROM project_execution_snapshots WHERE id = ?`)
    .get(snapshotId) as Record<string, unknown> | undefined;
  if (!snapshot) return;
  const workflowVersionId = requiredText(
    cell(snapshot, "workflow_version_id"),
    "workflow_version_id",
  );
  db.prepare(
    `UPDATE workflow_instances
        SET execution_snapshot_id = ?
      WHERE project_id = ?
        AND execution_snapshot_id IS NULL
        AND workflow_version_id = ?`,
  ).run(snapshotId, projectId, workflowVersionId);
}

function decideRun(db: DatabaseSync, run: RunBackfillRow): Decision {
  const prior = latestBackfill(db, run.runId);
  if (prior?.action === "quarantined") {
    return {
      action: "quarantined",
      reason: `prior quarantine retained; ${classifyFresh(db, run).reason}`,
    };
  }

  const database = classifyDatabaseAxes(run);
  if (database.action === "already_canonical") {
    if (database.snapshot?.orchestrationMode === "direct") {
      return {
        action: "skipped_direct",
        reason: "historical direct Run keeps a null execution snapshot reference",
        snapshot: database.snapshot,
      };
    }
    return database;
  }
  if (database.action === "quarantined") {
    return database;
  }

  if (run.taskOrganizationId !== run.projectOrganizationId) {
    return {
      action: "quarantined",
      reason: "Run task organization does not match its Project tenant",
    };
  }
  if (run.organizationId !== run.projectOrganizationId) {
    return {
      action: "quarantined",
      reason: "Run organization does not match its Project tenant",
    };
  }

  const projectSnapshot = resolveProjectSnapshot(db, run);
  if (projectSnapshot.kind !== "ok") {
    return { action: projectSnapshot.kind, reason: projectSnapshot.reason };
  }

  const transport = resolveTransport(db, run);
  if (transport.kind !== "ok") {
    return { action: transport.kind, reason: transport.reason };
  }

  const placement = resolvePlacement(db, run);
  if (placement.kind !== "ok") {
    return { action: placement.kind, reason: placement.reason };
  }

  try {
    const snapshot = parseRunExecutionSnapshot({
      orchestrationMode: "workflow_bound",
      transport: transport.value,
      executionSnapshotId: projectSnapshot.id,
      placementSnapshot: placement.value,
    });
    return {
      action: "filled",
      reason: "historical M3 Run reconstructed as workflow_bound from verified local facts",
      snapshot,
      projectSnapshotId: projectSnapshot.id,
    };
  } catch {
    return {
      action: "quarantined",
      reason: "reconstructed execution-axis facts failed canonical snapshot validation",
    };
  }
}

function classifyFresh(db: DatabaseSync, run: RunBackfillRow): Decision {
  const database = classifyDatabaseAxes(run);
  if (database.action !== "repair_required") return database;
  return decideRunWithoutPrior(db, run);
}

function decideRunWithoutPrior(db: DatabaseSync, run: RunBackfillRow): Decision {
  const prior = latestBackfill(db, run.runId);
  if (prior) return { action: prior.action, reason: prior.reason };
  return classifyDatabaseAxes(run);
}

function classifyDatabaseAxes(run: RunBackfillRow): Decision {
  const hasAny =
    run.orchestrationMode !== null ||
    run.transport !== null ||
    run.executionSnapshotId !== null ||
    run.placementSnapshotJson !== null;
  if (!hasAny) {
    return {
      action: "repair_required",
      reason: "Run has no persisted execution-axis facts",
    };
  }
  if (
    run.placementSnapshotJson === null ||
    run.orchestrationMode === null ||
    run.transport === null
  ) {
    return {
      action: "quarantined",
      reason: "Run has a partial execution-axis projection without a complete placement",
    };
  }
  try {
    const snapshot = parseRunExecutionSnapshot({
      orchestrationMode: run.orchestrationMode,
      transport: run.transport,
      ...(run.executionSnapshotId === null ? {} : { executionSnapshotId: run.executionSnapshotId }),
      placementSnapshot: JSON.parse(run.placementSnapshotJson) as unknown,
    });
    return {
      action: "already_canonical",
      reason: "Run contains a complete, schema-valid immutable execution-axis snapshot",
      snapshot,
    };
  } catch {
    return {
      action: "quarantined",
      reason: "Run contains partial or invalid execution-axis facts; no axis was inferred",
    };
  }
}

function resolveProjectSnapshot(
  db: DatabaseSync,
  run: RunBackfillRow,
): { kind: "ok"; id: string } | { kind: "repair_required" | "quarantined"; reason: string } {
  const row = db
    .prepare(
      `SELECT id, workflow_version_id, team_version_id
         FROM project_execution_snapshots
        WHERE project_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
    )
    .get(run.projectId) as Record<string, unknown> | undefined;
  if (!row) {
    return {
      kind: "repair_required",
      reason:
        "Project has no unique published WorkflowVersion/TeamVersion snapshot; versions were not guessed",
    };
  }
  const id = requiredText(cell(row, "id"), "id");
  const workflowVersionId = requiredText(cell(row, "workflow_version_id"), "workflow_version_id");
  const teamVersionId = requiredText(cell(row, "team_version_id"), "team_version_id");
  if (run.projectWorkflowVersionId !== null && run.projectWorkflowVersionId !== workflowVersionId) {
    return {
      kind: "quarantined",
      reason: "Project workflow_version_id conflicts with the unique execution snapshot",
    };
  }
  if (run.projectTeamVersionId !== null && run.projectTeamVersionId !== teamVersionId) {
    return {
      kind: "quarantined",
      reason: "Project team_version_id conflicts with the unique execution snapshot",
    };
  }
  return { kind: "ok", id };
}

function resolveTransport(
  db: DatabaseSync,
  run: RunBackfillRow,
):
  | { kind: "ok"; value: RuntimeTransport }
  | { kind: "repair_required" | "quarantined"; reason: string } {
  if (run.runtimeInstallationId === null) {
    return {
      kind: "repair_required",
      reason: "Run has no runtime installation from which transport can be read",
    };
  }
  const installation = db
    .prepare(
      `SELECT id, node_id, runtime_profile_id
         FROM runtime_installations WHERE id = ?`,
    )
    .get(run.runtimeInstallationId) as Record<string, unknown> | undefined;
  if (!installation) {
    return {
      kind: "repair_required",
      reason: "Run runtime installation is missing; transport was not inferred from adapter name",
    };
  }
  if (
    run.executionNodeId !== null &&
    optionalText(cell(installation, "node_id")) !== run.executionNodeId
  ) {
    return {
      kind: "quarantined",
      reason: "Runtime installation node does not match the Run execution node",
    };
  }
  const profileId = optionalText(cell(installation, "runtime_profile_id"));
  if (profileId === null) {
    return {
      kind: "repair_required",
      reason: "Runtime installation has no RuntimeProfile; transport was not guessed",
    };
  }
  const transports = db
    .prepare(
      `SELECT DISTINCT transport AS transport
         FROM runtime_profile_versions
        WHERE runtime_profile_id = ?
          AND transport IS NOT NULL`,
    )
    .all(profileId)
    .map((entry) => optionalText(cell(entry as Record<string, unknown>, "transport")))
    .filter((value): value is string => value !== null);
  const unique = [...new Set(transports)];
  if (unique.length === 0) {
    return {
      kind: "repair_required",
      reason: "RuntimeProfile has no recorded process/sdk/http transport",
    };
  }
  if (unique.length > 1) {
    return {
      kind: "quarantined",
      reason: "RuntimeProfile versions disagree on transport",
    };
  }
  const value = unique[0];
  if (value !== "process" && value !== "sdk" && value !== "http") {
    return {
      kind: "quarantined",
      reason: "RuntimeProfile transport is not a canonical process/sdk/http value",
    };
  }
  return { kind: "ok", value };
}

function resolvePlacement(
  db: DatabaseSync,
  run: RunBackfillRow,
):
  | { kind: "ok"; value: PlacementSnapshot }
  | { kind: "repair_required" | "quarantined"; reason: string } {
  const scheduled = readSchedulingPlacement(db, run.runId);
  const reconstructed = reconstructLegacyPlacement(db, run);
  if (scheduled.kind === "quarantined") return scheduled;
  if (reconstructed.kind === "quarantined") return reconstructed;
  if (scheduled.kind === "ok" && reconstructed.kind === "ok") {
    if (!samePlacement(scheduled.value, reconstructed.value)) {
      return {
        kind: "quarantined",
        reason: "scheduling record placement conflicts with Local Node / Workspace / Run binding",
      };
    }
    return { kind: "ok", value: withLegacyVersion(reconstructed.value) };
  }
  if (reconstructed.kind === "ok") {
    return { kind: "ok", value: withLegacyVersion(reconstructed.value) };
  }
  if (scheduled.kind === "ok") {
    return { kind: "ok", value: withLegacyVersion(scheduled.value) };
  }
  return reconstructed.kind === "repair_required" ? reconstructed : scheduled;
}

function reconstructLegacyPlacement(
  db: DatabaseSync,
  run: RunBackfillRow,
):
  | { kind: "ok"; value: PlacementSnapshot }
  | { kind: "repair_required" | "quarantined"; reason: string } {
  if (
    run.executionNodeId === null ||
    run.runtimeInstallationId === null ||
    run.workspaceInstanceId === null
  ) {
    return {
      kind: "repair_required",
      reason: "Run is missing Local Node / RuntimeInstallation / WorkspaceInstance binding columns",
    };
  }
  const node = db
    .prepare("SELECT id, kind FROM execution_nodes WHERE id = ?")
    .get(run.executionNodeId) as Record<string, unknown> | undefined;
  if (!node) {
    return {
      kind: "repair_required",
      reason: "Run execution node is missing; remote capability was not invented",
    };
  }
  const kind = requiredText(cell(node, "kind"), "kind");
  if (kind !== "local") {
    return {
      kind: "quarantined",
      reason: `execution node kind ${kind} is not a verified local placement`,
    };
  }
  const workspace = db
    .prepare(`SELECT id, node_id, run_id FROM workspace_instances WHERE id = ?`)
    .get(run.workspaceInstanceId) as Record<string, unknown> | undefined;
  if (!workspace) {
    return {
      kind: "repair_required",
      reason: "Run workspace instance is missing",
    };
  }
  if (optionalText(cell(workspace, "node_id")) !== run.executionNodeId) {
    return {
      kind: "quarantined",
      reason: "Workspace instance node does not match the Run execution node",
    };
  }
  const boundRun = optionalText(cell(workspace, "run_id"));
  if (boundRun !== null && boundRun !== run.runId) {
    return {
      kind: "quarantined",
      reason: "Workspace instance is bound to a different Run",
    };
  }
  const sessions = db
    .prepare(
      `SELECT id FROM node_sessions
        WHERE node_id = ? AND revoked_at IS NULL
        ORDER BY started_at ASC, id ASC`,
    )
    .all(run.executionNodeId);
  if (sessions.length === 0) {
    return {
      kind: "repair_required",
      reason: "No node session exists for the local execution node",
    };
  }
  if (sessions.length > 1) {
    return {
      kind: "quarantined",
      reason: "Multiple active node sessions conflict for the local execution node",
    };
  }
  const lease = db
    .prepare(`SELECT id, node_id, fencing_token FROM execution_leases WHERE run_id = ?`)
    .get(run.runId) as Record<string, unknown> | undefined;
  if (!lease) {
    return {
      kind: "repair_required",
      reason: "No execution lease exists for the Run; fencing was not invented",
    };
  }
  if (optionalText(cell(lease, "node_id")) !== run.executionNodeId) {
    return {
      kind: "quarantined",
      reason: "Execution lease node does not match the Run execution node",
    };
  }
  const fencingToken = optionalInt(cell(lease, "fencing_token"));
  if (fencingToken === null || fencingToken < 0) {
    return {
      kind: "quarantined",
      reason: "Execution lease fencing token is missing or invalid",
    };
  }
  try {
    return {
      kind: "ok",
      value: parsePlacementSnapshot({
        nodeId: run.executionNodeId,
        nodeSessionId: requiredText(cell(sessions[0] as Record<string, unknown>, "id"), "id"),
        runtimeInstallationId: run.runtimeInstallationId,
        workspaceInstanceId: run.workspaceInstanceId,
        executionLeaseId: requiredText(cell(lease, "id"), "id"),
        fencingToken,
      }),
    };
  } catch {
    return {
      kind: "quarantined",
      reason: "Local Node / Workspace / lease facts did not form a valid PlacementSnapshot",
    };
  }
}

function readSchedulingPlacement(
  db: DatabaseSync,
  runId: string,
):
  | { kind: "ok"; value: PlacementSnapshot }
  | { kind: "repair_required" | "quarantined"; reason: string } {
  const rows = db
    .prepare(
      `SELECT placement_snapshot_json FROM scheduling_records
        WHERE run_id = ?
        ORDER BY created_at ASC, id ASC`,
    )
    .all(runId);
  if (rows.length === 0) {
    return {
      kind: "repair_required",
      reason: "No scheduling record placement exists for the Run",
    };
  }
  const parsed: PlacementSnapshot[] = [];
  for (const row of rows) {
    const json = optionalText(cell(row as Record<string, unknown>, "placement_snapshot_json"));
    if (json === null) {
      return {
        kind: "quarantined",
        reason: "Scheduling record placement is missing",
      };
    }
    try {
      parsed.push(parsePlacementSnapshot(JSON.parse(json) as unknown));
    } catch {
      return {
        kind: "quarantined",
        reason: "Scheduling record placement is not a canonical PlacementSnapshot",
      };
    }
  }
  const first = parsed[0];
  if (!first) {
    return {
      kind: "repair_required",
      reason: "No scheduling record placement exists for the Run",
    };
  }
  if (parsed.some((item) => !samePlacement(item, first))) {
    return {
      kind: "quarantined",
      reason: "Scheduling records disagree on placement for the same Run",
    };
  }
  return { kind: "ok", value: first };
}

function withLegacyVersion(placement: PlacementSnapshot): PlacementSnapshot {
  return placement.legacySchemaVersion
    ? placement
    : { ...placement, legacySchemaVersion: LEGACY_PLACEMENT_SCHEMA_VERSION };
}

function samePlacement(left: PlacementSnapshot, right: PlacementSnapshot): boolean {
  return (
    left.nodeId === right.nodeId &&
    left.nodeSessionId === right.nodeSessionId &&
    left.runtimeInstallationId === right.runtimeInstallationId &&
    left.workspaceInstanceId === right.workspaceInstanceId &&
    left.executionLeaseId === right.executionLeaseId &&
    left.fencingToken === right.fencingToken
  );
}

function fillRun(db: DatabaseSync, runId: string, snapshot: RunExecutionSnapshot): void {
  const result = db
    .prepare(
      `UPDATE runs
          SET orchestration_mode = ?,
              transport = ?,
              execution_snapshot_id = ?,
              placement_snapshot_json = ?
        WHERE id = ?
          AND orchestration_mode IS NULL
          AND transport IS NULL
          AND execution_snapshot_id IS NULL
          AND placement_snapshot_json IS NULL`,
    )
    .run(
      snapshot.orchestrationMode,
      snapshot.transport,
      snapshot.executionSnapshotId ?? null,
      JSON.stringify(snapshot.placementSnapshot),
      runId,
    );
  if (Number(result.changes) === 0) {
    throw new Error(`execution-axis backfill could not fill Run ${runId}`);
  }
}

function recordResult(
  db: DatabaseSync,
  run: RunBackfillRow,
  decision: Decision,
  now: string,
): ExecutionAxisBackfillResult {
  const source = {
    runId: run.runId,
    action: decision.action,
    snapshotId: decision.projectSnapshotId ?? decision.snapshot?.executionSnapshotId ?? null,
    axisFields: [
      run.orchestrationMode === null ? null : "orchestrationMode",
      run.transport === null ? null : "transport",
      run.executionSnapshotId === null ? null : "executionSnapshotId",
      run.placementSnapshotJson === null ? null : "placementSnapshot",
    ].filter((value): value is string => value !== null),
  };
  const sourceDigest = digestOf(source);
  db.prepare(
    `INSERT OR IGNORE INTO execution_axis_backfill_results (
       run_id, action, reason, snapshot_id, source_digest, applied_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    run.runId,
    decision.action,
    decision.reason,
    decision.projectSnapshotId ?? decision.snapshot?.executionSnapshotId ?? null,
    sourceDigest,
    now,
  );
  const stored = db
    .prepare(
      `SELECT run_id, action, reason, snapshot_id, source_digest, applied_at
         FROM execution_axis_backfill_results
        WHERE run_id = ? AND source_digest = ?`,
    )
    .get(run.runId, sourceDigest) as Record<string, unknown>;
  return {
    runId: requiredText(cell(stored, "run_id"), "run_id"),
    action: requiredText(cell(stored, "action"), "action") as ExecutionAxisBackfillAction,
    reason: requiredText(cell(stored, "reason"), "reason"),
    snapshotId: optionalText(cell(stored, "snapshot_id")),
    sourceDigest: requiredText(cell(stored, "source_digest"), "source_digest"),
    appliedAt: requiredText(cell(stored, "applied_at"), "applied_at"),
  };
}

function latestBackfill(db: DatabaseSync, runId: string): ExecutionAxisBackfillResult | null {
  const row = db
    .prepare(
      `SELECT run_id, action, reason, snapshot_id, source_digest, applied_at
         FROM execution_axis_backfill_results
        WHERE run_id = ?
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(runId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    runId: requiredText(cell(row, "run_id"), "run_id"),
    action: requiredText(cell(row, "action"), "action") as ExecutionAxisBackfillAction,
    reason: requiredText(cell(row, "reason"), "reason"),
    snapshotId: optionalText(cell(row, "snapshot_id")),
    sourceDigest: requiredText(cell(row, "source_digest"), "source_digest"),
    appliedAt: requiredText(cell(row, "applied_at"), "applied_at"),
  };
}

function listRuns(db: DatabaseSync): RunBackfillRow[] {
  return db
    .prepare(
      `SELECT r.id AS run_id, r.organization_id, r.task_id, r.created_at,
              r.orchestration_mode, r.transport, r.execution_snapshot_id,
              r.placement_snapshot_json, r.execution_node_id,
              r.runtime_installation_id, r.workspace_instance_id,
              t.project_id, t.organization_id AS task_organization_id,
              p.organization_id AS project_organization_id,
              p.team_version_id, p.workflow_version_id,
              p.execution_snapshot_id AS project_snapshot_id
         FROM runs r
         INNER JOIN tasks t ON t.id = r.task_id
         INNER JOIN projects p ON p.id = t.project_id
        ORDER BY r.id ASC`,
    )
    .all()
    .map((row) => {
      const record = row as Record<string, unknown>;
      return {
        runId: requiredText(cell(record, "run_id"), "run_id"),
        organizationId: requiredText(cell(record, "organization_id"), "organization_id"),
        taskId: requiredText(cell(record, "task_id"), "task_id"),
        createdAt: requiredText(cell(record, "created_at"), "created_at"),
        orchestrationMode: optionalText(cell(record, "orchestration_mode")),
        transport: optionalText(cell(record, "transport")),
        executionSnapshotId: optionalText(cell(record, "execution_snapshot_id")),
        placementSnapshotJson: optionalText(cell(record, "placement_snapshot_json")),
        executionNodeId: optionalText(cell(record, "execution_node_id")),
        runtimeInstallationId: optionalText(cell(record, "runtime_installation_id")),
        workspaceInstanceId: optionalText(cell(record, "workspace_instance_id")),
        projectId: requiredText(cell(record, "project_id"), "project_id"),
        taskOrganizationId: requiredText(
          cell(record, "task_organization_id"),
          "task_organization_id",
        ),
        projectOrganizationId: requiredText(
          cell(record, "project_organization_id"),
          "project_organization_id",
        ),
        projectTeamVersionId: optionalText(cell(record, "team_version_id")),
        projectWorkflowVersionId: optionalText(cell(record, "workflow_version_id")),
        projectSnapshotId: optionalText(cell(record, "project_snapshot_id")),
      };
    });
}

function isPublishedVersion(
  db: DatabaseSync,
  table: "team_versions" | "workflow_versions",
  id: string,
): boolean {
  const row = db
    .prepare(`SELECT content_hash, definition_json FROM ${table} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return false;
  const hash = requiredText(cell(row, "content_hash"), "content_hash");
  const definition = requiredText(cell(row, "definition_json"), "definition_json");
  return hash !== EMPTY_VERSION_CONTENT_HASH && definition !== "{}";
}

function readBudgetSnapshot(
  db: DatabaseSync,
  budgetId: string,
): Record<string, unknown> | undefined {
  const row = db
    .prepare(
      `SELECT id, currency, limit_minor, authorization_version
         FROM budgets WHERE id = ?`,
    )
    .get(budgetId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: requiredText(cell(row, "id"), "id"),
    currency: requiredText(cell(row, "currency"), "currency"),
    limitMinor: optionalInt(cell(row, "limit_minor")),
    authorizationVersion: optionalInt(cell(row, "authorization_version")),
  };
}

function snapshotContentHash(input: {
  projectId: string;
  workflowVersionId: string;
  teamVersionId: string;
  policySnapshot: Record<string, unknown>;
  budgetSnapshot?: Record<string, unknown>;
}): string {
  return `sha256:${digestOf({
    projectId: input.projectId,
    workflowVersionId: input.workflowVersionId,
    teamVersionId: input.teamVersionId,
    policySnapshot: input.policySnapshot,
    budgetSnapshot: input.budgetSnapshot ?? null,
  })}`;
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify({ invalidValueType: typeof value });
}
