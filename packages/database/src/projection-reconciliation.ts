import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { cell, parseJson, requiredInt, requiredText } from "./sql.js";
import type { WorldEntitySnapshot } from "./world-snapshot.js";

export const PROJECTION_RECONCILIATION_CLASSIFICATIONS = [
  "sqlite_authority",
  "sidecar_repaired",
  "sidecar_stale_ignored",
  "projection_failed",
  "repair_failed",
  "partial_projection",
] as const;

export type ProjectionReconciliationClassification =
  (typeof PROJECTION_RECONCILIATION_CLASSIFICATIONS)[number];

export interface ProjectionReconciliationItem {
  auditSequence: number;
  sourceDigest: string;
  classification: ProjectionReconciliationClassification;
  reason: string;
  source: Record<string, unknown>;
  recordedAt: string;
}

export interface RecordProjectionReconciliationInput {
  classification: ProjectionReconciliationClassification;
  reason: string;
  source: Record<string, unknown>;
  now?: string;
}

export interface ProjectionRepairPlan {
  classification: ProjectionReconciliationClassification;
  reason: string;
  source: Record<string, unknown>;
  snapshot: WorldEntitySnapshot;
  shouldWriteSqlite: boolean;
}

const UNRESOLVED = new Set<ProjectionReconciliationClassification>([
  "projection_failed",
  "repair_failed",
  "partial_projection",
]);

/**
 * Append-only ledger for world.json ↔ SQLite projection outcomes.
 * Source JSON is sanitized identity/digest facts only — never sidecar bodies.
 */
export class SqliteProjectionReconciliationRepository {
  constructor(private readonly db: DatabaseSync) {}

  record(input: RecordProjectionReconciliationInput): ProjectionReconciliationItem {
    const now = input.now ?? new Date().toISOString();
    const source = sanitizeSource(input.source);
    const sourceDigest = digestOf(source);
    const write = (): ProjectionReconciliationItem => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO projection_reconciliation_items (
             source_digest, classification, reason, source_json, recorded_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sourceDigest, input.classification, input.reason, JSON.stringify(source), now);
      return (
        this.get(sourceDigest, input.classification) ??
        (() => {
          throw new Error(
            `projection reconciliation row ${sourceDigest}/${input.classification} was not stored`,
          );
        })()
      );
    };
    if (this.db.isTransaction) {
      return write();
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const item = write();
      this.db.exec("COMMIT");
      return item;
    } catch (error) {
      if (this.db.isTransaction) {
        this.db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  get(
    sourceDigest: string,
    classification: ProjectionReconciliationClassification,
  ): ProjectionReconciliationItem | null {
    const row = this.db
      .prepare(
        `SELECT audit_sequence, source_digest, classification, reason, source_json, recorded_at
           FROM projection_reconciliation_items
          WHERE source_digest = ? AND classification = ?`,
      )
      .get(sourceDigest, classification);
    return row ? rowToItem(row) : null;
  }

  list(): ProjectionReconciliationItem[] {
    return this.db
      .prepare(
        `SELECT audit_sequence, source_digest, classification, reason, source_json, recorded_at
           FROM projection_reconciliation_items
          ORDER BY audit_sequence ASC`,
      )
      .all()
      .map(rowToItem);
  }

  listUnresolved(): ProjectionReconciliationItem[] {
    return this.list().filter((item) => UNRESOLVED.has(item.classification));
  }
}

export function hasDurableEntities(snapshot: WorldEntitySnapshot): boolean {
  return (
    snapshot.projects.length > 0 ||
    snapshot.tasks.length > 0 ||
    snapshot.workflows.length > 0 ||
    snapshot.runs.length > 0 ||
    snapshot.nodes.length > 0 ||
    snapshot.approvals.length > 0 ||
    snapshot.artifacts.length > 0 ||
    snapshot.budgets.length > 0 ||
    snapshot.executionSnapshots.length > 0 ||
    (snapshot.executionLeases?.length ?? 0) > 0 ||
    (snapshot.workflowVersions?.length ?? 0) > 0 ||
    (snapshot.workflowDrafts?.length ?? 0) > 0 ||
    (snapshot.teamDrafts?.length ?? 0) > 0 ||
    (snapshot.authoringChangeSets?.length ?? 0) > 0
  );
}

export function entityAuthorityDigest(snapshot: WorldEntitySnapshot): string {
  return digestOf({
    projects: identityRevisions(snapshot.projects),
    tasks: identityRevisions(snapshot.tasks),
    workflows: identityRevisions(snapshot.workflows),
    nodes: identityRevisions(snapshot.nodes),
    approvals: identityRevisions(snapshot.approvals),
    runs: identityRevisions(snapshot.runs),
    artifacts: snapshot.artifacts.map((item) => item.artifactVersionId).sort(),
    budgets: snapshot.budgets.map((item) => item.id).sort(),
    executionSnapshots: snapshot.executionSnapshots.map((item) => item.id).sort(),
    executionLeases: (snapshot.executionLeases ?? []).map((item) => item.id).sort(),
    workflowVersions: (snapshot.workflowVersions ?? []).map((item) => item.id).sort(),
    workflowDrafts: (snapshot.workflowDrafts ?? []).map((item) => `${item.id}:${item.revision}`),
    teamDrafts: (snapshot.teamDrafts ?? []).map((item) => `${item.id}:${item.revision}`),
    authoringChangeSets: (snapshot.authoringChangeSets ?? []).map((item) => item.id).sort(),
  });
}

/**
 * Decide whether an old sidecar must be projected into SQLite.
 * SQLite is the restart authority: sidecar never silently overlays populated tables.
 */
export function planWorldProjectionRepair(
  sqlite: WorldEntitySnapshot,
  sidecar: WorldEntitySnapshot | undefined,
): ProjectionRepairPlan {
  const sqliteDigest = entityAuthorityDigest(sqlite);
  if (!sidecar || !hasDurableEntities(sidecar)) {
    return {
      classification: "sqlite_authority",
      reason: "SQLite entity tables are the restart authority",
      source: { sqliteEntityDigest: sqliteDigest, sidecarEntityDigest: null },
      snapshot: sqlite,
      shouldWriteSqlite: false,
    };
  }
  const sidecarDigest = entityAuthorityDigest(sidecar);
  const source = {
    sqliteEntityDigest: sqliteDigest,
    sidecarEntityDigest: sidecarDigest,
    sqliteProjectCount: sqlite.projects.length,
    sidecarProjectCount: sidecar.projects.length,
  };
  if (!hasDurableEntities(sqlite)) {
    return {
      classification: "sidecar_repaired",
      reason: "empty SQLite received durable sidecar entities",
      source,
      snapshot: sidecar,
      shouldWriteSqlite: true,
    };
  }

  const merged = mergeEntitySnapshots(sqlite, sidecar);
  if (merged.repairedIds.length > 0 && merged.staleIgnoredIds.length > 0) {
    return {
      classification: "partial_projection",
      reason: "sidecar contributed missing entities; newer SQLite rows were kept",
      source: {
        ...source,
        repairedCount: merged.repairedIds.length,
        staleIgnoredCount: merged.staleIgnoredIds.length,
      },
      snapshot: merged.snapshot,
      shouldWriteSqlite: true,
    };
  }
  if (merged.repairedIds.length > 0) {
    return {
      classification: "sidecar_repaired",
      reason: "sidecar-ahead entities were projected into SQLite",
      source: { ...source, repairedCount: merged.repairedIds.length },
      snapshot: merged.snapshot,
      shouldWriteSqlite: true,
    };
  }
  if (merged.staleIgnoredIds.length > 0 || sqliteDigest !== sidecarDigest) {
    return {
      classification: "sidecar_stale_ignored",
      reason: "restart kept SQLite entities and ignored a stale sidecar projection",
      source: { ...source, staleIgnoredCount: merged.staleIgnoredIds.length },
      snapshot: sqlite,
      shouldWriteSqlite: false,
    };
  }
  return {
    classification: "sqlite_authority",
    reason: "SQLite entity tables match the sidecar identity digest",
    source,
    snapshot: sqlite,
    shouldWriteSqlite: false,
  };
}

export function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function mergeEntitySnapshots(
  sqlite: WorldEntitySnapshot,
  sidecar: WorldEntitySnapshot,
): {
  snapshot: WorldEntitySnapshot;
  repairedIds: string[];
  staleIgnoredIds: string[];
} {
  const repairedIds: string[] = [];
  const staleIgnoredIds: string[] = [];
  const projects = pickByRevision(sqlite.projects, sidecar.projects, repairedIds, staleIgnoredIds);
  const tasks = pickByRevision(sqlite.tasks, sidecar.tasks, repairedIds, staleIgnoredIds);
  const workflows = pickByRevision(
    sqlite.workflows,
    sidecar.workflows,
    repairedIds,
    staleIgnoredIds,
  );
  const nodes = pickByRevision(sqlite.nodes, sidecar.nodes, repairedIds, staleIgnoredIds);
  const approvals = pickByRevision(
    sqlite.approvals,
    sidecar.approvals,
    repairedIds,
    staleIgnoredIds,
  );
  const runs = pickByRevision(sqlite.runs, sidecar.runs, repairedIds, staleIgnoredIds);
  return {
    snapshot: {
      workflowVersions: preferSqliteCollection(
        sqlite.workflowVersions ?? [],
        sidecar.workflowVersions ?? [],
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      projects,
      tasks,
      workflows,
      nodes,
      approvals,
      artifacts: preferSqliteCollection(
        sqlite.artifacts,
        sidecar.artifacts,
        (item) => item.artifactVersionId,
        repairedIds,
        staleIgnoredIds,
      ),
      runs,
      budgets: preferSqliteCollection(
        sqlite.budgets,
        sidecar.budgets,
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      reservations: preferSqliteCollection(
        sqlite.reservations,
        sidecar.reservations,
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      usageKeys: [...new Set([...sqlite.usageKeys, ...sidecar.usageKeys])],
      executionSnapshots: preferSqliteCollection(
        sqlite.executionSnapshots,
        sidecar.executionSnapshots,
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      executionLeases: preferSqliteCollection(
        sqlite.executionLeases ?? [],
        sidecar.executionLeases ?? [],
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      workflowDrafts: preferSqliteCollection(
        sqlite.workflowDrafts ?? [],
        sidecar.workflowDrafts ?? [],
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      teamDrafts: preferSqliteCollection(
        sqlite.teamDrafts ?? [],
        sidecar.teamDrafts ?? [],
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
      authoringChangeSets: preferSqliteCollection(
        sqlite.authoringChangeSets ?? [],
        sidecar.authoringChangeSets ?? [],
        (item) => item.id,
        repairedIds,
        staleIgnoredIds,
      ),
    },
    repairedIds,
    staleIgnoredIds,
  };
}

function pickByRevision<T extends { id: string; stateRevision: number }>(
  sqlite: readonly T[],
  sidecar: readonly T[],
  repairedIds: string[],
  staleIgnoredIds: string[],
): T[] {
  const sqliteById = new Map(sqlite.map((item) => [item.id, item]));
  const sidecarById = new Map(sidecar.map((item) => [item.id, item]));
  const ids = [...new Set([...sqliteById.keys(), ...sidecarById.keys()])].sort();
  const chosen: T[] = [];
  for (const id of ids) {
    const stored = sqliteById.get(id);
    const incoming = sidecarById.get(id);
    if (stored === undefined && incoming !== undefined) {
      chosen.push(incoming);
      repairedIds.push(id);
      continue;
    }
    if (stored !== undefined && incoming === undefined) {
      chosen.push(stored);
      continue;
    }
    if (stored !== undefined && incoming !== undefined) {
      if (incoming.stateRevision > stored.stateRevision) {
        chosen.push(incoming);
        repairedIds.push(id);
      } else {
        chosen.push(stored);
        if (
          incoming.stateRevision < stored.stateRevision ||
          JSON.stringify(incoming) !== JSON.stringify(stored)
        ) {
          staleIgnoredIds.push(id);
        }
      }
    }
  }
  return chosen;
}

function preferSqliteCollection<T>(
  sqlite: readonly T[],
  sidecar: readonly T[],
  keyOf: (item: T) => string,
  repairedIds: string[],
  staleIgnoredIds: string[],
): T[] {
  const sqliteByKey = new Map(sqlite.map((item) => [keyOf(item), item]));
  const sidecarByKey = new Map(sidecar.map((item) => [keyOf(item), item]));
  const keys = [...new Set([...sqliteByKey.keys(), ...sidecarByKey.keys()])].sort();
  const chosen: T[] = [];
  for (const key of keys) {
    const stored = sqliteByKey.get(key);
    const incoming = sidecarByKey.get(key);
    if (stored === undefined && incoming !== undefined) {
      chosen.push(incoming);
      repairedIds.push(key);
      continue;
    }
    if (stored !== undefined) {
      chosen.push(stored);
      if (incoming !== undefined && JSON.stringify(incoming) !== JSON.stringify(stored)) {
        staleIgnoredIds.push(key);
      }
    }
  }
  return chosen;
}

function identityRevisions(records: readonly { id: string; stateRevision: number }[]): string[] {
  return [...records]
    .map((item) => `${item.id}:${item.stateRevision}`)
    .sort((left, right) => left.localeCompare(right));
}

function sanitizeSource(source: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
      continue;
    }
    if (typeof value === "string") {
      sanitized[key] = value.length > 200 ? digestOf(value) : value;
      continue;
    }
    sanitized[key] = digestOf(value);
  }
  return sanitized;
}

function rowToItem(row: Record<string, unknown>): ProjectionReconciliationItem {
  const classification = requiredText(
    cell(row, "classification"),
    "classification",
  ) as ProjectionReconciliationClassification;
  return {
    auditSequence: requiredInt(cell(row, "audit_sequence"), "audit_sequence"),
    sourceDigest: requiredText(cell(row, "source_digest"), "source_digest"),
    classification,
    reason: requiredText(cell(row, "reason"), "reason"),
    source: parseJson(cell(row, "source_json"), "source_json") as Record<string, unknown>,
    recordedAt: requiredText(cell(row, "recorded_at"), "recorded_at"),
  };
}
