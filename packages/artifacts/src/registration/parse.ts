import { ArtifactError } from "../errors.js";
import { isRegistrableKind, type RegistrableKind } from "../kinds.js";
import type {
  EvaluationRecord,
  LineageRelation,
  LineageSource,
  OutputBinding,
  StagingRecord,
  StoredArtifactVersion,
} from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reqString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${label}.${key} missing`);
  }
  return value;
}

function optString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${key} must be a string`);
  }
  return value;
}

function reqNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${label}.${key} missing`);
  }
  return value;
}

function optRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `${key} must be an object`);
  }
  return value;
}

const RELATIONS: readonly LineageRelation[] = [
  "derived_from",
  "transformed_from",
  "combined_from",
  "quoted_from",
  "supersedes",
];

function parseSources(value: unknown): LineageSource[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "sources must be an array");
  }
  const sources: LineageSource[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "lineage source must be an object");
    }
    const relation = item.relation;
    if (typeof relation !== "string" || !RELATIONS.includes(relation as LineageRelation)) {
      throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "invalid lineage relation");
    }
    sources.push({
      artifactVersionId: reqString(item, "artifactVersionId", "source"),
      relation: relation as LineageRelation,
    });
  }
  return sources;
}

const STATUSES = ["staging", "available", "quarantined", "archived"] as const;

export function parseStagingRecord(value: unknown): StagingRecord {
  if (!isRecord(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "staging metadata is not an object");
  }
  const kind = reqString(value, "kind", "staging");
  if (!isRegistrableKind(kind)) {
    throw new ArtifactError("ARTIFACT_KIND_UNSUPPORTED", `unsupported kind ${kind}`);
  }
  const record: StagingRecord = {
    stagingId: reqString(value, "stagingId", "staging"),
    slotId: reqString(value, "slotId", "staging"),
    mediaType: reqString(value, "mediaType", "staging"),
    kind,
    hash: reqString(value, "hash", "staging"),
    size: reqNumber(value, "size", "staging"),
    createdAt: reqString(value, "createdAt", "staging"),
  };
  const artifactId = optString(value, "artifactId");
  if (artifactId !== undefined) {
    record.artifactId = artifactId;
  }
  const taskId = optString(value, "taskId");
  if (taskId !== undefined) {
    record.taskId = taskId;
  }
  const runId = optString(value, "runId");
  if (runId !== undefined) {
    record.runId = runId;
  }
  const name = optString(value, "name");
  if (name !== undefined) {
    record.name = name;
  }
  const schema = optRecord(value, "schema");
  if (schema !== undefined) {
    record.schema = schema;
  }
  const metadata = optRecord(value, "metadata");
  if (metadata !== undefined) {
    record.metadata = metadata;
  }
  const sources = parseSources(value.sources);
  if (sources !== undefined) {
    record.sources = sources;
  }
  const expectedHash = optString(value, "expectedHash");
  if (expectedHash !== undefined) {
    record.expectedHash = expectedHash;
  }
  if (value.expectedSize !== undefined) {
    record.expectedSize = reqNumber(value, "expectedSize", "staging");
  }
  return record;
}

export function parseStoredVersion(value: unknown): StoredArtifactVersion {
  if (!isRecord(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "version metadata is not an object");
  }
  const kind = reqString(value, "kind", "version") as RegistrableKind;
  if (!isRegistrableKind(kind)) {
    throw new ArtifactError("ARTIFACT_KIND_UNSUPPORTED", `unsupported kind ${kind}`);
  }
  const status = reqString(value, "status", "version");
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", `invalid version status ${status}`);
  }
  const record: StoredArtifactVersion = {
    artifactVersionId: reqString(value, "artifactVersionId", "version"),
    artifactId: reqString(value, "artifactId", "version"),
    version: reqNumber(value, "version", "version"),
    hash: reqString(value, "hash", "version"),
    size: reqNumber(value, "size", "version"),
    status: status as StoredArtifactVersion["status"],
    mediaType: reqString(value, "mediaType", "version"),
    kind,
    slotId: reqString(value, "slotId", "version"),
    stagingId: reqString(value, "stagingId", "version"),
    createdAt: reqString(value, "createdAt", "version"),
  };
  const availableAt = optString(value, "availableAt");
  if (availableAt !== undefined) {
    record.availableAt = availableAt;
  }
  const quarantinedAt = optString(value, "quarantinedAt");
  if (quarantinedAt !== undefined) {
    record.quarantinedAt = quarantinedAt;
  }
  const taskId = optString(value, "taskId");
  if (taskId !== undefined) {
    record.taskId = taskId;
  }
  const runId = optString(value, "runId");
  if (runId !== undefined) {
    record.runId = runId;
  }
  const name = optString(value, "name");
  if (name !== undefined) {
    record.name = name;
  }
  const metadata = optRecord(value, "metadata");
  if (metadata !== undefined) {
    record.metadata = metadata;
  }
  const schema = optRecord(value, "schema");
  if (schema !== undefined) {
    record.schema = schema;
  }
  if (isRecord(value.supersedes)) {
    record.supersedes = {
      artifactId: reqString(value.supersedes, "artifactId", "supersedes"),
      version: reqNumber(value.supersedes, "version", "supersedes"),
    };
  }
  return record;
}

export function parseOutputBinding(value: unknown): OutputBinding {
  if (!isRecord(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "output binding is not an object");
  }
  return {
    taskId: reqString(value, "taskId", "binding"),
    slotId: reqString(value, "slotId", "binding"),
    artifactVersionId: reqString(value, "artifactVersionId", "binding"),
    createdAt: reqString(value, "createdAt", "binding"),
  };
}

export function parseEvaluationRecord(value: unknown): EvaluationRecord {
  if (!isRecord(value)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "evaluation is not an object");
  }
  const method = reqString(value, "method", "evaluation");
  if (method !== "schema" && method !== "test") {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "evaluation.method invalid");
  }
  const verdict = reqString(value, "verdict", "evaluation");
  if (verdict !== "pass" && verdict !== "fail" && verdict !== "inconclusive") {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "evaluation.verdict invalid");
  }
  const evidenceRaw = value.evidenceRefs;
  if (!Array.isArray(evidenceRaw)) {
    throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "evaluation.evidenceRefs missing");
  }
  const evidenceRefs: Array<{ artifactVersionId: string }> = [];
  for (const item of evidenceRaw) {
    if (!isRecord(item)) {
      throw new ArtifactError("ARTIFACT_SCHEMA_INVALID", "evidence ref must be an object");
    }
    evidenceRefs.push({ artifactVersionId: reqString(item, "artifactVersionId", "evidence") });
  }
  const record: EvaluationRecord = {
    id: reqString(value, "id", "evaluation"),
    artifactVersionId: reqString(value, "artifactVersionId", "evaluation"),
    method,
    verdict,
    evidenceRefs,
    createdAt: reqString(value, "createdAt", "evaluation"),
    criterionId: reqString(value, "criterionId", "evaluation"),
  };
  if (isRecord(value.scores)) {
    const scores: Record<string, number> = {};
    for (const [key, score] of Object.entries(value.scores)) {
      if (typeof score === "number") {
        scores[key] = score;
      }
    }
    record.scores = scores;
  }
  const summary = optString(value, "summary");
  if (summary !== undefined) {
    record.summary = summary;
  }
  return record;
}

export function parseLineageSources(value: unknown): LineageSource[] {
  return parseSources(value) ?? [];
}
