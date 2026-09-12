import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { parseRunExecutionSnapshot, type RunExecutionSnapshot } from "@workforce/protocol";

import { cell, optionalText, requiredInt, requiredText } from "./sql.js";

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
}

export interface ExecutionAxisMigrationItem {
  auditSequence: number;
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
  provenance?: { source: string; referenceDigest: string };
  axisFields?: string[];
  axisDigest?: string;
}

interface ClassificationResult {
  classification: ExecutionAxisMigrationClassification;
  reason: string;
  snapshot?: RunExecutionSnapshot;
}

interface AuditContext {
  /**
   * The first quarantined observation in the unresolved chain. Keeping this
   * opaque value in later source identities prevents an older, harmless
   * source digest from reviving a pre-quarantine classification.
   */
  quarantineOriginDigest?: string;
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
    if (this.db.isTransaction) {
      throw new Error("execution-axis audit requires its own transaction");
    }
    this.db.exec("BEGIN IMMEDIATE");

    try {
      const runs = this.listRunFacts();
      const results: ExecutionAxisMigrationItem[] = [];
      for (const run of runs) {
        const evidence = evidenceByRun.get(run.runId);
        const prior = this.latest(run.runId);
        const base = classify(run, evidence);
        const sourceWithoutContext = sourceFor(run, evidence);
        const auditContext = quarantineContextFor(prior, base, sourceWithoutContext);
        const source = sourceFor(run, evidence, auditContext);
        const sourceDigest = digestOf(source);
        const classification =
          prior?.classification === "quarantined" && base.classification !== "quarantined"
            ? "quarantined"
            : base.classification;
        const reason =
          classification === "quarantined" &&
          prior?.classification === "quarantined" &&
          base.classification !== "quarantined"
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

      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      if (this.db.isTransaction) {
        this.db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  get(runId: string, sourceDigest: string): ExecutionAxisMigrationItem | null {
    const row = this.db
      .prepare(
        `SELECT audit_sequence, run_id, source_digest, classification, reason, source_json, audited_at
           FROM execution_axis_migration_items
          WHERE run_id = ? AND source_digest = ?`,
      )
      .get(runId, sourceDigest);
    return row ? rowToItem(row) : null;
  }

  list(): ExecutionAxisMigrationItem[] {
    return this.db
      .prepare(
        `SELECT audit_sequence, run_id, source_digest, classification, reason, source_json, audited_at
           FROM execution_axis_migration_items
          ORDER BY audit_sequence ASC`,
      )
      .all()
      .map(rowToItem);
  }

  latest(runId: string): ExecutionAxisMigrationItem | null {
    const row = this.db
      .prepare(
        `SELECT audit_sequence, run_id, source_digest, classification, reason, source_json, audited_at
           FROM execution_axis_migration_items
          WHERE run_id = ?
          ORDER BY audit_sequence DESC
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
  auditContext: AuditContext = {},
): Record<string, unknown> {
  const databaseAxisValues = {
    orchestrationMode: run.orchestrationMode,
    transport: run.transport,
    executionSnapshotId: run.executionSnapshotId,
    placementSnapshotJson: run.placementSnapshotJson,
  };
  const databaseAxisFields = Object.entries(databaseAxisValues)
    .filter(([, value]) => value !== null)
    .map(([key]) => key);
  return {
    runId: run.runId,
    database: {
      axisFields: databaseAxisFields,
      axisDigest: digestOf(databaseAxisValues),
      placementSnapshotDigest:
        run.placementSnapshotJson === null ? null : digestOf(run.placementSnapshotJson),
    },
    evidence: evidence === undefined ? null : sanitizeEvidence(evidence),
    ...(auditContext.quarantineOriginDigest === undefined
      ? {}
      : { quarantineContext: { originDigest: auditContext.quarantineOriginDigest } }),
  };
}

function quarantineContextFor(
  prior: ExecutionAxisMigrationItem | null,
  base: ClassificationResult,
  sourceWithoutContext: Record<string, unknown>,
): AuditContext {
  if (base.classification !== "quarantined" && prior?.classification !== "quarantined") {
    return {};
  }
  return {
    quarantineOriginDigest:
      prior?.classification === "quarantined"
        ? (priorQuarantineOrigin(prior) ?? prior.sourceDigest)
        : digestOf(sourceWithoutContext),
  };
}

function priorQuarantineOrigin(item: ExecutionAxisMigrationItem): string | undefined {
  const context = item.source.quarantineContext;
  if (!isRecord(context) || typeof context.originDigest !== "string") {
    return undefined;
  }
  return context.originDigest;
}

function classify(
  run: RunAxisFacts,
  input: ExecutionAxisMigrationEvidence | undefined,
): ClassificationResult {
  const database = classifyDatabaseFacts(run);
  const evidence = input === undefined ? undefined : sanitizeEvidence(input);
  const evidenceHasAxes = evidence !== undefined && hasAnyEvidenceAxis(evidence);

  if (database.classification === "already_canonical") {
    return database;
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

  return {
    classification: "repair_required",
    reason:
      "external execution-axis evidence is recorded only as a digest; verified project, transport, and placement relations are required before eligibility",
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

function hasAnyEvidenceAxis(evidence: SanitizedEvidence): boolean {
  return (evidence.axisFields?.length ?? 0) > 0;
}

function sanitizeEvidence(input: ExecutionAxisMigrationEvidence): SanitizedEvidence {
  const result: SanitizedEvidence = {};
  const provenance = normalizeProvenance(input.provenance);
  if (provenance !== undefined) {
    result.provenance = provenance;
  }
  const axisValues: Record<string, unknown> = {};
  for (const key of [
    "orchestrationMode",
    "transport",
    "executionSnapshotId",
    "placementSnapshot",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      axisValues[key] = input[key];
    }
  }
  const axisFields = Object.keys(axisValues);
  if (axisFields.length > 0) {
    result.axisFields = axisFields;
    result.axisDigest = digestOf(axisValues);
  }
  return result;
}

function normalizeProvenance(
  value: ExecutionAxisMigrationEvidence["provenance"],
): { source: string; referenceDigest: string } | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return { source: "external", referenceDigest: digestOf(value.trim()) };
  }
  if (isRecord(value) && typeof value.source === "string" && typeof value.reference === "string") {
    const source = value.source.trim();
    const reference = value.reference.trim();
    if (source !== "" && reference !== "") {
      return {
        source: allowedProvenanceSource(source) ? source : "external",
        referenceDigest: digestOf(reference),
      };
    }
  }
  return undefined;
}

function allowedProvenanceSource(
  value: string,
): value is "operator" | "runtime_handle" | "scheduling_record" | "sidecar_handle" {
  return ["operator", "runtime_handle", "scheduling_record", "sidecar_handle"].includes(value);
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
    auditSequence: requiredInt(cell(row, "audit_sequence"), "audit_sequence"),
    runId: requiredText(cell(row, "run_id"), "run_id"),
    sourceDigest: requiredText(cell(row, "source_digest"), "source_digest"),
    classification: classification as ExecutionAxisMigrationClassification,
    reason: requiredText(cell(row, "reason"), "reason"),
    source,
    auditedAt: requiredText(cell(row, "audited_at"), "audited_at"),
  };
}
