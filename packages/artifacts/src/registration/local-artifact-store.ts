import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ID_PREFIX } from "@workforce/domain";

import { ArtifactError } from "../errors.js";
import { copyBytes, sha256Hex } from "../hash.js";
import { inferKind, verifyKindContent } from "../kinds.js";
import { detectLineageCycle } from "../lineage/graph.js";
import { requireArtifactVersionId } from "../refs.js";
import {
  blobKeyPath,
  ensureDir,
  listDirs,
  listFiles,
  pathExists,
  readBinaryFile,
  readJsonFile,
  removePath,
  writeAtomic,
  writeJsonAtomic,
} from "../storage/fs.js";
import type {
  AcceptanceReady,
  ArtifactUsePurpose,
  ArtifactUseRef,
  ArtifactVersion,
  Clock,
  EvaluationRecord,
  IdGenerator,
  LineageSource,
  OutputBinding,
  ReconcileResult,
  StageInput,
  StagingRecord,
  StagingRef,
  StoredArtifactVersion,
} from "../types.js";
import {
  parseEvaluationRecord,
  parseLineageSources,
  parseOutputBinding,
  parseStagingRecord,
  parseStoredVersion,
} from "./parse.js";

class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

class RandomUuidIdGenerator implements IdGenerator {
  ulid(prefix: string): string {
    return `${prefix}${randomUUID().replaceAll("-", "")}`;
  }
}

export interface LocalArtifactStoreOptions {
  root?: string;
  clock?: Clock;
  ids?: IdGenerator;
}

interface ArtifactIndex {
  artifactId: string;
  kind: StoredArtifactVersion["kind"];
  versionIds: string[];
}

/**
 * Filesystem artifact store. Metadata commit is the available transition.
 * Content may land in staging/CAS before metadata; reconcile never invents available versions.
 */
export class LocalArtifactStore {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly versions = new Map<string, StoredArtifactVersion>();
  private readonly staging = new Map<string, StagingRecord>();
  private readonly artifacts = new Map<string, ArtifactIndex>();
  private readonly bindings = new Map<string, OutputBinding>();
  private readonly evaluations = new Map<string, EvaluationRecord>();
  private readonly lineage = new Map<string, LineageSource[]>();
  private readonly committedStaging = new Map<string, string>();

  private constructor(
    readonly root: string,
    clock: Clock,
    ids: IdGenerator,
  ) {
    this.clock = clock;
    this.ids = ids;
  }

  static async open(options: LocalArtifactStoreOptions = {}): Promise<LocalArtifactStore> {
    const root = options.root ?? (await mkdtemp(path.join(os.tmpdir(), "wf-art-")));
    await ensureDir(root);
    const store = new LocalArtifactStore(
      root,
      options.clock ?? new SystemClock(),
      options.ids ?? new RandomUuidIdGenerator(),
    );
    await store.reconcile();
    return store;
  }

  async stage(bytes: StageInput): Promise<StagingRef> {
    const body = copyBytes(bytes.body);
    const kind = inferKind({
      mediaType: bytes.mediaType,
      slotId: bytes.slotId,
      ...(bytes.kind !== undefined ? { kind: bytes.kind } : {}),
    });
    const hash = sha256Hex(body);
    const stagingId = this.ids.ulid("stg_");
    const now = this.clock.now().toISOString();
    const record: StagingRecord = {
      stagingId,
      slotId: bytes.slotId,
      mediaType: bytes.mediaType,
      kind,
      hash,
      size: body.byteLength,
      createdAt: now,
    };
    if (bytes.artifactId !== undefined) {
      record.artifactId = bytes.artifactId;
    }
    if (bytes.taskId !== undefined) {
      record.taskId = bytes.taskId;
    }
    if (bytes.runId !== undefined) {
      record.runId = bytes.runId;
    }
    if (bytes.name !== undefined) {
      record.name = bytes.name;
    }
    if (bytes.schema !== undefined) {
      record.schema = bytes.schema;
    }
    if (bytes.metadata !== undefined) {
      record.metadata = bytes.metadata;
    }
    if (bytes.sources !== undefined) {
      record.sources = bytes.sources;
    }
    if (bytes.expectedHash !== undefined) {
      record.expectedHash = bytes.expectedHash;
    }
    if (bytes.expectedSize !== undefined) {
      record.expectedSize = bytes.expectedSize;
    }

    const dir = this.stagingDir(stagingId);
    await ensureDir(dir);
    await writeAtomic(path.join(dir, "body"), body);
    await writeJsonAtomic(path.join(dir, "meta.json"), record);
    this.staging.set(stagingId, record);
    return { stagingId };
  }

  async commit(staging: StagingRef): Promise<ArtifactVersion> {
    const existingId = this.committedStaging.get(staging.stagingId);
    if (existingId !== undefined) {
      return this.toPort(this.requireVersion(existingId));
    }

    const meta = await this.loadStaging(staging.stagingId);
    const body = await readBinaryFile(path.join(this.stagingDir(staging.stagingId), "body"));
    const hash = sha256Hex(body);
    const size = body.byteLength;
    const now = this.clock.now().toISOString();

    const integrityOk =
      hash === meta.hash &&
      size === meta.size &&
      (meta.expectedHash === undefined || meta.expectedHash === hash) &&
      (meta.expectedSize === undefined || meta.expectedSize === size);

    const artifactVersionId = this.ids.ulid(ID_PREFIX.artifactVersion);
    const artifactId = meta.artifactId ?? this.ids.ulid(ID_PREFIX.artifact);
    const previous = this.artifacts.get(artifactId);
    const versionNumber = (previous?.versionIds.length ?? 0) + 1;
    const supersedes =
      previous !== undefined && previous.versionIds.length > 0
        ? this.versions.get(previous.versionIds[previous.versionIds.length - 1] ?? "")
        : undefined;

    if (integrityOk) {
      try {
        verifyKindContent({
          kind: meta.kind,
          body,
          ...(meta.metadata !== undefined ? { metadata: meta.metadata } : {}),
          ...(meta.schema !== undefined ? { schema: meta.schema } : {}),
        });
      } catch (error) {
        if (error instanceof ArtifactError) {
          throw error;
        }
        throw error;
      }
    }

    const sources = meta.sources ?? [];
    for (const source of sources) {
      const src = this.versions.get(source.artifactVersionId);
      if (!src) {
        throw new ArtifactError(
          "ARTIFACT_NOT_FOUND",
          `lineage source ${source.artifactVersionId} not found`,
          {
            details: { artifactVersionId: source.artifactVersionId },
          },
        );
      }
      if (source.artifactVersionId === artifactVersionId) {
        throw new ArtifactError("ARTIFACT_LINEAGE_CYCLE", "lineage cannot reference self");
      }
    }
    detectLineageCycle({
      outputArtifactVersionId: artifactVersionId,
      sources,
      edges: this.lineage,
    });

    const stored: StoredArtifactVersion = {
      artifactVersionId,
      artifactId,
      version: versionNumber,
      hash,
      size,
      status: integrityOk ? "available" : "quarantined",
      mediaType: meta.mediaType,
      kind: meta.kind,
      slotId: meta.slotId,
      stagingId: meta.stagingId,
      createdAt: now,
    };
    if (integrityOk) {
      stored.availableAt = now;
    } else {
      stored.quarantinedAt = now;
    }
    if (meta.taskId !== undefined) {
      stored.taskId = meta.taskId;
    }
    if (meta.runId !== undefined) {
      stored.runId = meta.runId;
    }
    if (meta.name !== undefined) {
      stored.name = meta.name;
    }
    if (meta.metadata !== undefined) {
      stored.metadata = meta.metadata;
    }
    if (meta.schema !== undefined) {
      stored.schema = meta.schema;
    }
    if (supersedes !== undefined) {
      stored.supersedes = { artifactId: supersedes.artifactId, version: supersedes.version };
    }

    const blobPath = blobKeyPath(this.root, hash);
    if (!(await pathExists(blobPath))) {
      await writeAtomic(blobPath, body);
    }
    await writeJsonAtomic(this.versionPath(artifactVersionId), stored);
    if (sources.length > 0) {
      await writeJsonAtomic(this.lineagePath(artifactVersionId), sources);
    }

    this.versions.set(artifactVersionId, stored);
    this.committedStaging.set(meta.stagingId, artifactVersionId);
    this.lineage.set(artifactVersionId, sources);
    this.upsertArtifactIndex(stored);

    if (meta.taskId !== undefined && stored.status === "available") {
      await this.writeBinding({
        taskId: meta.taskId,
        slotId: meta.slotId,
        artifactVersionId,
        createdAt: now,
      });
    }

    await this.persistArtifactIndex(artifactId);
    await removePath(this.stagingDir(meta.stagingId));
    this.staging.delete(meta.stagingId);

    if (!integrityOk) {
      throw new ArtifactError("ARTIFACT_INTEGRITY_MISMATCH", "staged content hash/size mismatch", {
        details: { artifactVersionId, hash, expectedHash: meta.hash },
      });
    }

    return this.toPort(stored);
  }

  async get(artifactVersionId: string): Promise<ArtifactVersion> {
    return this.toPort(this.requireVersion(artifactVersionId));
  }

  async getStored(artifactVersionId: string): Promise<StoredArtifactVersion> {
    return { ...this.requireVersion(artifactVersionId) };
  }

  async *read(artifactVersionId: string): AsyncIterable<Uint8Array> {
    const stored = this.requireVersion(artifactVersionId);
    if (stored.status === "staging") {
      throw new ArtifactError("ARTIFACT_NOT_AVAILABLE", "staging content cannot be read", {
        details: { artifactVersionId },
      });
    }
    if (stored.status === "quarantined") {
      throw new ArtifactError("ARTIFACT_QUARANTINED", "quarantined artifact cannot be read", {
        details: { artifactVersionId },
      });
    }
    const verified = await this.verifyStored(stored);
    if (verified.status === "quarantined") {
      throw new ArtifactError("ARTIFACT_QUARANTINED", "content failed integrity check", {
        details: { artifactVersionId },
      });
    }
    yield await this.readBlob(stored.hash);
  }

  async verify(artifactVersionId: string): Promise<ArtifactVersion> {
    const stored = this.requireVersion(artifactVersionId);
    return this.toPort(await this.verifyStored(stored));
  }

  async archive(artifactVersionId: string): Promise<ArtifactVersion> {
    const stored = this.requireVersion(artifactVersionId);
    if (stored.status !== "available") {
      throw new ArtifactError("ARTIFACT_NOT_AVAILABLE", "only available versions can be archived", {
        details: { artifactVersionId, status: stored.status },
      });
    }
    stored.status = "archived";
    await writeJsonAtomic(this.versionPath(artifactVersionId), stored);
    return this.toPort(stored);
  }

  async reconcile(): Promise<ReconcileResult> {
    this.versions.clear();
    this.staging.clear();
    this.artifacts.clear();
    this.bindings.clear();
    this.evaluations.clear();
    this.lineage.clear();
    this.committedStaging.clear();

    let rebuiltIndexes = 0;
    const versionFiles = await listFiles(path.join(this.root, "versions"));
    for (const file of versionFiles) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const stored = parseStoredVersion(await readJsonFile(file));
      this.versions.set(stored.artifactVersionId, stored);
      this.committedStaging.set(stored.stagingId, stored.artifactVersionId);
      this.upsertArtifactIndex(stored);
      rebuiltIndexes += 1;
    }

    for (const file of await listFiles(path.join(this.root, "lineage"))) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const artifactVersionId = path.basename(file, ".json");
      this.lineage.set(artifactVersionId, parseLineageSources(await readJsonFile(file)));
    }

    for (const file of await listFiles(path.join(this.root, "bindings"))) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const binding = parseOutputBinding(await readJsonFile(file));
      this.bindings.set(bindingKey(binding.taskId, binding.slotId), binding);
    }

    for (const file of await listFiles(path.join(this.root, "evaluations"))) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const evaluation = parseEvaluationRecord(await readJsonFile(file));
      this.evaluations.set(evaluation.id, evaluation);
    }

    let stagingLeft = 0;
    let orphanStagingCleared = 0;
    for (const dir of await listDirs(path.join(this.root, "staging"))) {
      const stagingId = path.basename(dir);
      const committed = this.committedStaging.get(stagingId);
      if (committed !== undefined) {
        await removePath(dir);
        orphanStagingCleared += 1;
        continue;
      }
      const metaPath = path.join(dir, "meta.json");
      if (!(await pathExists(metaPath))) {
        continue;
      }
      const record = parseStagingRecord(await readJsonFile(metaPath));
      this.staging.set(record.stagingId, record);
      stagingLeft += 1;
    }

    for (const artifactId of this.artifacts.keys()) {
      await this.persistArtifactIndex(artifactId);
    }

    return {
      availableCount: [...this.versions.values()].filter(
        (version) => version.status === "available",
      ).length,
      stagingLeft,
      rebuiltIndexes,
      orphanStagingCleared,
    };
  }

  async browseLatest(artifactId: string): Promise<ArtifactVersion | null> {
    const index = this.artifacts.get(artifactId);
    if (!index || index.versionIds.length === 0) {
      return null;
    }
    const latestId = index.versionIds[index.versionIds.length - 1];
    if (latestId === undefined) {
      return null;
    }
    return this.toPort(this.requireVersion(latestId));
  }

  async resolveForUse(
    ref: ArtifactUseRef,
    purpose: ArtifactUsePurpose,
  ): Promise<StoredArtifactVersion> {
    const resolved = requireArtifactVersionId(ref, purpose);
    if (typeof resolved === "string") {
      return this.requireVersion(resolved);
    }
    if ("latest" in resolved) {
      const latest = await this.browseLatest(resolved.artifactId);
      if (!latest) {
        throw new ArtifactError("ARTIFACT_NOT_FOUND", `no versions for ${resolved.artifactId}`);
      }
      return this.requireVersion(latest.artifactVersionId);
    }
    const index = this.artifacts.get(resolved.artifactId);
    if (!index) {
      throw new ArtifactError("ARTIFACT_NOT_FOUND", `unknown artifact ${resolved.artifactId}`);
    }
    const match = index.versionIds
      .map((id) => this.versions.get(id))
      .find((version) => version?.version === resolved.version);
    if (!match) {
      throw new ArtifactError(
        "ARTIFACT_NOT_FOUND",
        `artifact ${resolved.artifactId} version ${resolved.version} not found`,
      );
    }
    return match;
  }

  async bindOutput(input: {
    taskId: string;
    slotId: string;
    artifactVersionId: string;
  }): Promise<OutputBinding> {
    const stored = this.requireVersion(input.artifactVersionId);
    if (stored.status !== "available") {
      throw new ArtifactError(
        "ARTIFACT_NOT_AVAILABLE",
        "output binding requires an available version",
        {
          details: { artifactVersionId: input.artifactVersionId, status: stored.status },
        },
      );
    }
    const binding: OutputBinding = {
      taskId: input.taskId,
      slotId: input.slotId,
      artifactVersionId: input.artifactVersionId,
      createdAt: this.clock.now().toISOString(),
    };
    await this.writeBinding(binding);
    return binding;
  }

  async getOutputBinding(taskId: string, slotId: string): Promise<OutputBinding | null> {
    return this.bindings.get(bindingKey(taskId, slotId)) ?? null;
  }

  async acceptanceReady(input: {
    taskId: string;
    requiredSlotIds: string[];
  }): Promise<AcceptanceReady> {
    const missing: string[] = [];
    const quarantined: string[] = [];
    const bindings: OutputBinding[] = [];
    for (const slotId of input.requiredSlotIds) {
      const binding = this.bindings.get(bindingKey(input.taskId, slotId));
      if (!binding) {
        missing.push(slotId);
        continue;
      }
      const stored = this.versions.get(binding.artifactVersionId);
      if (!stored || stored.status !== "available") {
        if (stored?.status === "quarantined") {
          quarantined.push(slotId);
        } else {
          missing.push(slotId);
        }
        continue;
      }
      const verified = await this.verifyStored(stored);
      if (verified.status === "quarantined") {
        quarantined.push(slotId);
        continue;
      }
      bindings.push(binding);
    }
    return {
      ready: missing.length === 0 && quarantined.length === 0,
      missing,
      quarantined,
      bindings,
    };
  }

  async recordEvaluation(evaluation: EvaluationRecord): Promise<void> {
    this.requireVersion(evaluation.artifactVersionId);
    this.evaluations.set(evaluation.id, evaluation);
    await writeJsonAtomic(this.evaluationPath(evaluation.id), evaluation);
  }

  async listEvaluations(artifactVersionId: string): Promise<EvaluationRecord[]> {
    return [...this.evaluations.values()]
      .filter((evaluation) => evaluation.artifactVersionId === artifactVersionId)
      .map((evaluation) => ({
        ...evaluation,
        evidenceRefs: evaluation.evidenceRefs.map((ref) => ({ ...ref })),
      }));
  }

  async lineageOf(artifactVersionId: string): Promise<LineageSource[]> {
    this.requireVersion(artifactVersionId);
    return [...(this.lineage.get(artifactVersionId) ?? [])];
  }

  async listAvailable(): Promise<StoredArtifactVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.status === "available")
      .map((version) => ({ ...version }));
  }

  async register(input: StageInput): Promise<StoredArtifactVersion> {
    const staging = await this.stage(input);
    const committed = await this.commit(staging);
    return this.getStored(committed.artifactVersionId);
  }

  private async verifyStored(stored: StoredArtifactVersion): Promise<StoredArtifactVersion> {
    if (stored.status === "quarantined") {
      return stored;
    }
    let body: Uint8Array;
    try {
      body = await this.readBlob(stored.hash);
    } catch (cause) {
      return this.quarantine(stored, cause);
    }
    const hash = sha256Hex(body);
    if (hash !== stored.hash || body.byteLength !== stored.size) {
      return this.quarantine(stored);
    }
    return stored;
  }

  private async quarantine(
    stored: StoredArtifactVersion,
    cause?: unknown,
  ): Promise<StoredArtifactVersion> {
    stored.status = "quarantined";
    stored.quarantinedAt = this.clock.now().toISOString();
    await writeJsonAtomic(this.versionPath(stored.artifactVersionId), stored);
    if (cause instanceof ArtifactError) {
      throw cause;
    }
    return stored;
  }

  private async readBlob(hash: string): Promise<Uint8Array> {
    const file = blobKeyPath(this.root, hash);
    try {
      return await readBinaryFile(file);
    } catch (cause) {
      throw new ArtifactError("ARTIFACT_NOT_FOUND", `blob missing for ${hash}`, { cause });
    }
  }

  private async loadStaging(stagingId: string): Promise<StagingRecord> {
    const cached = this.staging.get(stagingId);
    if (cached) {
      return cached;
    }
    const metaPath = path.join(this.stagingDir(stagingId), "meta.json");
    if (!(await pathExists(metaPath))) {
      throw new ArtifactError("ARTIFACT_STAGING_MISSING", `staging ${stagingId} not found`, {
        details: { stagingId },
      });
    }
    const record = parseStagingRecord(await readJsonFile(metaPath));
    this.staging.set(stagingId, record);
    return record;
  }

  private requireVersion(artifactVersionId: string): StoredArtifactVersion {
    const stored = this.versions.get(artifactVersionId);
    if (!stored) {
      throw new ArtifactError(
        "ARTIFACT_NOT_FOUND",
        `artifact version ${artifactVersionId} not found`,
        {
          details: { artifactVersionId },
        },
      );
    }
    return stored;
  }

  private upsertArtifactIndex(stored: StoredArtifactVersion): void {
    const index = this.artifacts.get(stored.artifactId) ?? {
      artifactId: stored.artifactId,
      kind: stored.kind,
      versionIds: [],
    };
    if (!index.versionIds.includes(stored.artifactVersionId)) {
      index.versionIds.push(stored.artifactVersionId);
      index.versionIds.sort((left, right) => {
        const l = this.versions.get(left)?.version ?? 0;
        const r = this.versions.get(right)?.version ?? 0;
        return l - r;
      });
    }
    this.artifacts.set(stored.artifactId, index);
  }

  private async persistArtifactIndex(artifactId: string): Promise<void> {
    const index = this.artifacts.get(artifactId);
    if (!index) {
      return;
    }
    await writeJsonAtomic(path.join(this.root, "artifacts", `${artifactId}.json`), index);
  }

  private async writeBinding(binding: OutputBinding): Promise<void> {
    this.bindings.set(bindingKey(binding.taskId, binding.slotId), binding);
    await writeJsonAtomic(this.bindingPath(binding.taskId, binding.slotId), binding);
  }

  private toPort(stored: StoredArtifactVersion): ArtifactVersion {
    return {
      artifactVersionId: stored.artifactVersionId,
      hash: stored.hash,
      size: stored.size,
      status: stored.status,
    };
  }

  private stagingDir(stagingId: string): string {
    return path.join(this.root, "staging", stagingId);
  }

  private versionPath(artifactVersionId: string): string {
    return path.join(this.root, "versions", `${artifactVersionId}.json`);
  }

  private lineagePath(artifactVersionId: string): string {
    return path.join(this.root, "lineage", `${artifactVersionId}.json`);
  }

  private bindingPath(taskId: string, slotId: string): string {
    return path.join(this.root, "bindings", `${taskId}__${slotId}.json`);
  }

  private evaluationPath(id: string): string {
    return path.join(this.root, "evaluations", `${id}.json`);
  }
}

function bindingKey(taskId: string, slotId: string): string {
  return `${taskId}\u0000${slotId}`;
}
