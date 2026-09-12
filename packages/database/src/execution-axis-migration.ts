import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { parseRunExecutionSnapshot, type RunExecutionSnapshot } from "@workforce/protocol";

import { cell, optionalText, requiredText } from "./sql.js";

export const EXECUTION_AXIS_MIGRATION_CLASSIFICATIONS = [
  "already_canonical",
  "eligible",
  "repair_required",
  "quarantined",
] as const;

export type ExecutionAxisMigrationClassification =
  (typeof EXECUTION_AXIS_MIGRATION_CLASSIFICATIONS)[number];

/**
 * A deliberately small input shape for operator/import evidence.  The
 * caller owns sanitisation; this repository stores only these known fields
 * and never follows a path or reads a sidecar/world file.
 */
export interface ExecutionAxisMigrationEvidence {
  runId: string;
  provenance?: string | { source: string; reference: string };
  orchestrationMode?: unknown;
  transport?: unknown;
  executionSnapshotId?: unknown;
  placementSnapshot?: unknown;
}

export interface ExecutionAxisMigrationAuditOptions {
  evidence?: readonly ExecutionAxisMigrationEvidence[];
  now?: string;
  /** Explicit operator action; default is fail-closed for prior quarantine. */
  allowQuarantinePromotion?: boolean;
}

export interface ExecutionAxisMigrationItem {
  runId: string;
  sourceDigest: string;
  classification: ExecutionAxisMigrationClassification;
  reason: string;
  source: Record<string, unknown>;
  auditedAt: string;
}

interface RunAxisFacts {
  runId: string;
  orchestrationMode: string | null;
  transport: string | null;
  executionSnapshotId: string | null;
  placementSnapshotJson: string | null;
}

interface SanitizedEvidence {
  provenance?: { source: string; reference: string };
  orchestrationMode?: unknown;
  transport?: unknown;
  executionSnapshotId?: unknown;
  placementSnapshot?: unknown;
}

interface ClassificationResult {
  classification: ExecutionAxisMigrationClassification;
  reason: string;
  snapshot?: RunExecutionSnapshot;
}

/**
 * Persistent, append-only audit ledger for the 005/007 execution-axis
 * migration.  It is intentionally not a backfill writer: `audit()` only
 * reads `runs` and inserts an observation into its own table.
 */
export class SqliteExecutionAxisMigrationRepository {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Classify every historical Run and persist one row per `(run, source
   * digest)`. Repeating the same audit is idempotent; changed source facts
   * produce a new ledger row.
   */
  audit(options: ExecutionAxisMigrationAuditOptions = {}): ExecutionAxisMigrationItem[] {
    const now = options.now ?? new Date().toISOString();
    const evidenceByRun = indexEvidence(options.evidence ?? []);
    const runs = this.listRunFacts();
    const wasOpen = this.db.isTransaction;
    if (!wasOpen) {
      this.db.exec("BEGIN IMMEDIATE");
    }

    try {
      const results: ExecutionAxisMigrationItem[] = [];
      for (const run of runs) {
        const evidence = evidenceByRun.get(run.runId);
        const source = sourceFor(run, evidence);
        const sourceDigest = digestOf(source);
        const prior = this.latest(run.runId);
        const base = classify(run, evidence);
        const classification =
          prior?.classification === "quarantined" &&
          !options.allowQuarantinePromotion &&
          base.classification !== "quarantined"
            ? "quarantined"
            : base.classification;
        const reason =
          classification === "quarantined" &&
          prior?.classification === "quarantined" &&
          base.classification !== "quarantined" &&
          !options.allowQuarantinePromotion
            ? `prior quarantine retained; ${base.reason}`
            : base.reason;

        this.db
          .prepare(
            `INSERT OR IGNORE INTO execution_axis_migration_items (
               run_id, source_digest, classification, reason, source_json, audited_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(run.runId, sourceDigest, classification, reason, JSON.stringify(source), now);

        results.push(
          this.get(run.runId, sourceDigest) ??
            (() => {
              throw new Error(
                `execution-axis audit row ${run.runId}/${sourceDigest} was not stored`,
              );
            })(),
        );
      }

      if (!wasOpen) {
        this.db.exec("COMMIT");
      }
      return results;
    } catch (error) {
      if (this.db.isTransaction && !wasOpen) {
        this.db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  get(runId: string, sourceDigest: string): ExecutionAxisMigrationItem | null {
    const row = this.db
      .prepare(
        `SELECT run_id, source_digest, classification, reason, source_json, audited_at
           FROM execution_axis_migration_items
          WHERE run_id = ? AND source_digest = ?`,
      )
      .get(runId, sourceDigest);
    return row ? rowToItem(row) : null;
  }

  list(): ExecutionAxisMigrationItem[] {
    return this.db
      .prepare(
        `SELECT run_id, source_digest, classification, reason, source_json, audited_at
           FROM execution_axis_migration_items
          ORDER BY audited_at ASC, run_id ASC, source_digest ASC`,
      )
      .all()
      .map(rowToItem);
  }

  latest(runId: string): ExecutionAxisMigrationItem | null {
    const row = this.db
      .prepare(
        `SELECT run_id, source_digest, classification, reason, source_json, audited_at
           FROM execution_axis_migration_items
          WHERE run_id = ?
          ORDER BY audited_at DESC, source_digest DESC
          LIMIT 1`,
      )
      .get(runId);
    return row ? rowToItem(row) : null;
  }

  /** Return only the current unresolved item for each Run. */
  listUnresolved(): ExecutionAxisMigrationItem[] {
    const latestByRun = new Map<string, ExecutionAxisMigrationItem>();
    for (const item of this.list()) {
      latestByRun.set(item.runId, item);
    }
    return [...latestByRun.values()]
      .filter((item) => item.classification !== "already_canonical")
      .sort((left, right) => left.runId.localeCompare(right.runId));
  }

  private listRunFacts(): RunAxisFacts[] {
    return this.db
      .prepare(
        `SELECT id, orchestration_mode, transport, execution_snapshot_id,
                placement_snapshot_json
           FROM runs
          ORDER BY id ASC`,
      )
      .all()
      .map((row) => ({
        runId: requiredText(cell(row, "id"), "id"),
        orchestrationMode: optionalText(cell(row, "orchestration_mode")),
        transport: optionalText(cell(row, "transport")),
        executionSnapshotId: optionalText(cell(row, "execution_snapshot_id")),
        placementSnapshotJson: optionalText(cell(row, "placement_snapshot_json")),
      }));
  }
}

function indexEvidence(
  evidence: readonly ExecutionAxisMigrationEvidence[],
): Map<string, ExecutionAxisMigrationEvidence> {
  const byRun = new Map<string, ExecutionAxisMigrationEvidence>();
  for (const item of evidence) {
    if (byRun.has(item.runId)) {
      throw new Error(`duplicate execution-axis migration evidence for Run ${item.runId}`);
    }
    byRun.set(item.runId, item);
  }
  return byRun;
}

function sourceFor(
  run: RunAxisFacts,
  evidence: ExecutionAxisMigrationEvidence | undefined,
): Record<string, unknown> {
  return {
    runId: run.runId,
    database: {
      orchestrationMode: run.orchestrationMode,
      transport: run.transport,
      executionSnapshotId: run.executionSnapshotId,
      placementSnapshot: parsePlacementForSource(run.placementSnapshotJson),
    },
    evidence: evidence === undefined ? null : sanitizeEvidence(evidence),
  };
}

function classify(
  run: RunAxisFacts,
  input: ExecutionAxisMigrationEvidence | undefined,
): ClassificationResult {
  const database = classifyDatabaseFacts(run);
  const evidence = input === undefined ? undefined : sanitizeEvidence(input);
  const evidenceHasAxes = evidence !== undefined && hasAnyEvidenceAxis(evidence);

  if (database.classification === "already_canonical") {
    if (!evidenceHasAxes) {
      return database;
    }
    const supplied = parseEvidenceSnapshot(evidence);
    if (supplied.snapshot && sameSnapshot(database.snapshot, supplied.snapshot)) {
      return database;
    }
    return {
      classification: "quarantined",
      reason: supplied.reason ?? "external evidence conflicts with canonical Run axes",
    };
  }

  // Any already-written but incomplete/invalid axis is ambiguous. It must be
  // quarantined even when a later evidence payload happens to look complete;
  // this prevents a partial historical write from being silently overwritten.
  if (database.classification === "quarantined") {
    return database;
  }

  if (!evidenceHasAxes) {
    return {
      classification: "repair_required",
      reason:
        "Run has no canonical execution-axis provenance; no mode, transport, or placement was inferred",
    };
  }

  const supplied = parseEvidenceSnapshot(evidence);
  if (!supplied.snapshot) {
    return {
      classification:
        supplied.reason === "external evidence is incomplete" ? "quarantined" : "repair_required",
      reason: supplied.reason ?? "external evidence cannot establish canonical execution axes",
    };
  }
  if (!hasProvenance(evidence)) {
    return {
      classification: "repair_required",
      reason: "complete external axes have no provenance reference",
    };
  }
  return {
    classification: "eligible",
    reason: "complete, provenance-bearing external evidence is available; Run was not modified",
    snapshot: supplied.snapshot,
  };
}

function classifyDatabaseFacts(run: RunAxisFacts): ClassificationResult {
  const hasAny =
    run.orchestrationMode !== null ||
    run.transport !== null ||
    run.executionSnapshotId !== null ||
    run.placementSnapshotJson !== null;
  if (!hasAny) {
    return {
      classification: "repair_required",
      reason: "Run has no persisted execution-axis facts",
    };
  }

  if (run.placementSnapshotJson === null) {
    return {
      classification: "quarantined",
      reason: "Run has a partial execution-axis projection without placement provenance",
    };
  }

  let placement: unknown;
  try {
    placement = JSON.parse(run.placementSnapshotJson) as unknown;
  } catch {
    return {
      classification: "quarantined",
      reason: "Run placement_snapshot_json is not valid JSON",
    };
  }

  try {
    const snapshot = parseRunExecutionSnapshot({
      orchestrationMode: run.orchestrationMode,
      transport: run.transport,
      ...(run.executionSnapshotId === null ? {} : { executionSnapshotId: run.executionSnapshotId }),
      placementSnapshot: placement,
    });
    return {
      classification: "already_canonical",
      reason: "Run contains a complete, schema-valid immutable execution-axis snapshot",
      snapshot,
    };
  } catch {
    return {
      classification: "quarantined",
      reason: "Run contains partial or invalid execution-axis facts; no axis was inferred",
    };
  }
}

function parseEvidenceSnapshot(evidence: SanitizedEvidence): {
  snapshot?: RunExecutionSnapshot;
  reason?: string;
} {
  const hasRequired =
    evidence.orchestrationMode !== undefined &&
    evidence.transport !== undefined &&
    evidence.placementSnapshot !== undefined;
  if (!hasRequired) {
    return { reason: "external evidence is incomplete" };
  }

  try {
    const snapshot = parseRunExecutionSnapshot({
      orchestrationMode: evidence.orchestrationMode,
      transport: evidence.transport,
      ...(evidence.executionSnapshotId === undefined
        ? {}
        : { executionSnapshotId: evidence.executionSnapshotId }),
      placementSnapshot: evidence.placementSnapshot,
    });
    return { snapshot };
  } catch {
    return { reason: "external evidence contains invalid or conflicting execution axes" };
  }
}

function hasAnyEvidenceAxis(evidence: SanitizedEvidence): boolean {
  return (
    evidence.orchestrationMode !== undefined ||
    evidence.transport !== undefined ||
    evidence.executionSnapshotId !== undefined ||
    evidence.placementSnapshot !== undefined
  );
}

function hasProvenance(evidence: SanitizedEvidence): boolean {
  return evidence.provenance !== undefined;
}

function sanitizeEvidence(input: ExecutionAxisMigrationEvidence): SanitizedEvidence {
  const result: SanitizedEvidence = {};
  const provenance = normalizeProvenance(input.provenance);
  if (provenance !== undefined) {
    result.provenance = provenance;
  }
  if (Object.prototype.hasOwnProperty.call(input, "orchestrationMode")) {
    result.orchestrationMode = jsonSafe(input.orchestrationMode);
  }
  if (Object.prototype.hasOwnProperty.call(input, "transport")) {
    result.transport = jsonSafe(input.transport);
  }
  if (Object.prototype.hasOwnProperty.call(input, "executionSnapshotId")) {
    result.executionSnapshotId = jsonSafe(input.executionSnapshotId);
  }
  if (Object.prototype.hasOwnProperty.call(input, "placementSnapshot")) {
    result.placementSnapshot = jsonSafe(input.placementSnapshot);
  }
  return result;
}

function normalizeProvenance(
  value: ExecutionAxisMigrationEvidence["provenance"],
): { source: string; reference: string } | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return { source: "external", reference: value.trim() };
  }
  if (isRecord(value) && typeof value.source === "string" && typeof value.reference === "string") {
    const source = value.source.trim();
    const reference = value.reference.trim();
    if (source !== "" && reference !== "") {
      return { source, reference };
    }
  }
  return undefined;
}

function jsonSafe(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (isRecord(value)) {
    const object: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      object[key] = jsonSafe(value[key]);
    }
    return object;
  }
  return { invalidValueType: typeof value };
}

function parsePlacementForSource(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return jsonSafe(JSON.parse(value) as unknown);
  } catch {
    return { invalidJsonDigest: digestOf(value) };
  }
}

function sameSnapshot(
  left: RunExecutionSnapshot | undefined,
  right: RunExecutionSnapshot,
): boolean {
  return left !== undefined && canonicalJson(left) === canonicalJson(right);
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
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify({ invalidValueType: typeof value });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rowToItem(row: Record<string, unknown>): ExecutionAxisMigrationItem {
  const classification = requiredText(cell(row, "classification"), "classification");
  if (!EXECUTION_AXIS_MIGRATION_CLASSIFICATIONS.includes(classification as never)) {
    throw new Error(`unexpected execution-axis migration classification ${classification}`);
  }
  const sourceText = requiredText(cell(row, "source_json"), "source_json");
  const source = JSON.parse(sourceText) as unknown;
  if (!isRecord(source)) {
    throw new Error("execution-axis migration source_json must be an object");
  }
  return {
    runId: requiredText(cell(row, "run_id"), "run_id"),
    sourceDigest: requiredText(cell(row, "source_digest"), "source_digest"),
    classification: classification as ExecutionAxisMigrationClassification,
    reason: requiredText(cell(row, "reason"), "reason"),
    source,
    auditedAt: requiredText(cell(row, "audited_at"), "audited_at"),
  };
}
