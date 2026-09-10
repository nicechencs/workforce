import type { ArtifactVersionStatus } from "@workforce/domain";

import type { RegistrableKind } from "./kinds.js";

/** Matches `@workforce/application` ArtifactBytes. */
export interface ArtifactBytes {
  slotId: string;
  mediaType: string;
  body: Uint8Array;
}

/** Matches `@workforce/application` StagingRef. */
export interface StagingRef {
  stagingId: string;
}

/** Matches `@workforce/application` ArtifactVersion. */
export interface ArtifactVersion {
  artifactVersionId: string;
  hash: string;
  size: number;
  status: ArtifactVersionStatus;
}

export type LineageRelation =
  "derived_from" | "transformed_from" | "combined_from" | "quoted_from" | "supersedes";

export interface LineageSource {
  artifactVersionId: string;
  relation: LineageRelation;
}

export interface StageInput extends ArtifactBytes {
  kind?: RegistrableKind;
  artifactId?: string;
  taskId?: string;
  runId?: string;
  name?: string;
  schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sources?: LineageSource[];
  expectedHash?: string;
  expectedSize?: number;
}

export interface StoredArtifactVersion extends ArtifactVersion {
  artifactId: string;
  version: number;
  mediaType: string;
  kind: RegistrableKind;
  slotId: string;
  stagingId: string;
  createdAt: string;
  availableAt?: string;
  quarantinedAt?: string;
  taskId?: string;
  runId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  supersedes?: { artifactId: string; version: number };
}

export interface StagingRecord {
  stagingId: string;
  slotId: string;
  mediaType: string;
  kind: RegistrableKind;
  hash: string;
  size: number;
  createdAt: string;
  artifactId?: string;
  taskId?: string;
  runId?: string;
  name?: string;
  schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sources?: LineageSource[];
  expectedHash?: string;
  expectedSize?: number;
}

export interface OutputBinding {
  taskId: string;
  slotId: string;
  artifactVersionId: string;
  createdAt: string;
}

export interface AcceptanceReady {
  ready: boolean;
  missing: string[];
  quarantined: string[];
  bindings: OutputBinding[];
}

export type ArtifactUsePurpose = "read" | "approval" | "input" | "browse";

export type ArtifactUseRef =
  | { artifactVersionId: string }
  | { artifactId: string; version: number }
  | { artifactId: string; latest: true };

export interface ReconcileResult {
  availableCount: number;
  stagingLeft: number;
  rebuiltIndexes: number;
  orphanStagingCleared: number;
}

export interface EvaluationRecord {
  id: string;
  artifactVersionId: string;
  method: "schema" | "test";
  verdict: "pass" | "fail" | "inconclusive";
  evidenceRefs: Array<{ artifactVersionId: string }>;
  createdAt: string;
  criterionId: string;
  scores?: Record<string, number>;
  summary?: string;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  ulid(prefix: string): string;
}
