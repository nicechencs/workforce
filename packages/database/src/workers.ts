import type { DatabaseSync } from "node:sqlite";

import type { Tx, WorkerLibraryRepository } from "@workforce/application";
import {
  parseForkWorkerVersionAccepted,
  parseListWorkersInput,
  parseWorker,
  parseWorkerCardFields,
  parseWorkerDraft,
  parseWorkerPage,
  parseWorkerVersion,
  parseWorkerVersionReferences,
  type ForkWorkerVersionAcceptedDto,
  type ListWorkersInput,
  type WorkerCardFieldsDto,
  type WorkerDraftDto,
  type WorkerDto,
  type WorkerPageDto,
  type WorkerVersionDto,
  type WorkerVersionReferencesDto,
} from "@workforce/protocol";

import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { cell, ifPresent, optionalText, requiredInt, requiredText } from "./sql.js";

const WORKER_COLUMNS = `
  id, name, description, protocol_version, status, state_revision,
  definition_revision, active_version_id, forked_from_worker_version_id,
  created_at, updated_at
`;

const VERSION_COLUMNS = `
  id, worker_id, version, status, immutable, archived, name, description, role,
  runtime_profile_id, forked_from_worker_version_id, state_revision,
  published_at, archived_at, created_at, updated_at, who, how, skills
`;

const DRAFT_COLUMNS = `
  id, worker_id, revision, status, name, description, role, runtime_profile_id,
  content_hash, updated_at, updated_by, who, how, skills
`;

const DEFAULT_LIST_LIMIT = 20;

/**
 * SQLite implementation of T02 `WorkerLibraryRepository`.
 * Does not write 001 `worker_versions` (execution stub).
 */
export class SqliteWorkerLibraryRepository implements WorkerLibraryRepository {
  constructor(private readonly db: DatabaseSync) {}

  async list(input: ListWorkersInput): Promise<WorkerPageDto> {
    const query = parseListWorkersInput(input);
    const limit = query.limit ?? DEFAULT_LIST_LIMIT;
    const includeArchived = query.includeArchived === true;
    const rows = this.selectWorkerRows(query, limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) =>
      this.toWorkerDto(
        row,
        this.listVersionsFor(requiredText(cell(row, "id"), "id"), includeArchived),
      ),
    );
    const last = pageRows.at(-1);
    return parseWorkerPage({
      items,
      page: {
        nextCursor: hasMore && last !== undefined ? requiredText(cell(last, "id"), "id") : null,
        hasMore,
      },
    });
  }

  async getWorker(workerId: string): Promise<WorkerDto | null> {
    const row = this.db
      .prepare(`SELECT ${WORKER_COLUMNS} FROM catalog_workers WHERE id = ?`)
      .get(workerId);
    if (row === undefined) {
      return null;
    }
    return this.toWorkerDto(row, this.listVersionsFor(workerId, true));
  }

  async getVersion(workerVersionId: string): Promise<WorkerVersionDto | null> {
    const row = this.db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM catalog_worker_versions WHERE id = ?`)
      .get(workerVersionId);
    return row === undefined ? null : rowToVersion(row);
  }

  async getDraft(workerDraftId: string): Promise<WorkerDraftDto | null> {
    const row = this.db
      .prepare(`SELECT ${DRAFT_COLUMNS} FROM worker_drafts WHERE id = ?`)
      .get(workerDraftId);
    return row === undefined ? null : rowToDraft(row);
  }

  async listReferences(workerVersionId: string): Promise<WorkerVersionReferencesDto> {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT tv.id AS team_version_id, tv.team_id AS team_id, tv.status AS status
           FROM catalog_team_versions tv,
                json_each(tv.definition_json, '$.members') AS member
          WHERE json_extract(member.value, '$.workerVersionId') = ?
          ORDER BY tv.team_id ASC, tv.id ASC`,
      )
      .all(workerVersionId);
    return parseWorkerVersionReferences({
      workerVersionId,
      teamVersions: rows.map((row) => ({
        teamId: requiredText(cell(row, "team_id"), "team_id"),
        teamVersionId: requiredText(cell(row, "team_version_id"), "team_version_id"),
        status: requiredText(cell(row, "status"), "status"),
      })),
    });
  }

  async insertIdentity(tx: Tx, worker: WorkerDto, draft: WorkerDraftDto): Promise<void> {
    const identity = parseWorker(worker);
    const nextDraft = parseWorkerDraft(draft);
    if (identity.id !== nextDraft.workerId) {
      throw new PersistenceError(
        "constraint",
        `worker draft ${nextDraft.id} does not belong to worker ${identity.id}`,
      );
    }
    const db = sqliteDbOf(tx);
    insertWorkerRow(db, identity, nextDraft.updatedAt);
    insertDraftRow(db, nextDraft);
  }

  async saveDraft(
    tx: Tx,
    draft: WorkerDraftDto,
    expectedRevision: number,
  ): Promise<WorkerDraftDto> {
    const next = parseWorkerDraft(draft);
    const db = sqliteDbOf(tx);
    assertWorkerExists(db, next.workerId);
    const current = currentDraftRevision(db, next.workerId);
    if (current !== expectedRevision || next.revision !== current + 1) {
      throw new PersistenceError(
        "revision_conflict",
        `worker_drafts ${next.workerId} revision changed`,
      );
    }
    insertDraftRow(db, next);
    db.prepare(
      `UPDATE catalog_workers
          SET definition_revision = definition_revision + 1,
              updated_at = ?
        WHERE id = ?`,
    ).run(next.updatedAt, next.workerId);
    return next;
  }

  async publishVersion(tx: Tx, version: WorkerVersionDto): Promise<WorkerVersionDto> {
    const published = parseWorkerVersion(version);
    if (published.status !== "published" || published.immutable !== true) {
      throw new PersistenceError(
        "constraint",
        `worker version ${published.id} must be published and immutable`,
      );
    }
    const db = sqliteDbOf(tx);
    assertWorkerExists(db, published.workerId);
    const now = published.publishedAt ?? storageNow();
    try {
      db.prepare(
        `INSERT INTO catalog_worker_versions (
           id, worker_id, version, status, immutable, archived, name, description, role,
           runtime_profile_id, forked_from_worker_version_id, state_revision,
           published_at, archived_at, created_at, updated_at, who, how, skills
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        published.id,
        published.workerId,
        published.version,
        published.status,
        1,
        published.archived ? 1 : 0,
        published.name,
        published.description ?? "",
        published.role,
        published.runtimeProfileId ?? null,
        published.forkedFromWorkerVersionId ?? null,
        published.stateRevision ?? 1,
        published.publishedAt ?? now,
        published.archived ? (published.archivedAt ?? now) : null,
        now,
        now,
        nullableCardField(published.who),
        nullableCardField(published.how),
        nullableCardField(published.skills),
      );
    } catch (error) {
      mapLibraryWriteError(error, `worker version ${published.id} already exists`);
    }
    db.prepare(
      `UPDATE catalog_workers
          SET status = 'published',
              active_version_id = ?,
              state_revision = state_revision + 1,
              definition_revision = definition_revision + 1,
              updated_at = ?
        WHERE id = ?`,
    ).run(published.id, now, published.workerId);
    const stored = await this.getVersionFrom(db, published.id);
    if (stored === null) {
      throw new PersistenceError("not_found", `worker version ${published.id} was not stored`);
    }
    return stored;
  }

  async archiveVersion(tx: Tx, workerVersionId: string): Promise<WorkerVersionDto> {
    const db = sqliteDbOf(tx);
    const existing = this.getVersionFrom(db, workerVersionId);
    if (existing === null) {
      throw new PersistenceError("not_found", `worker version ${workerVersionId} was not found`);
    }
    if (existing.archived) {
      return existing;
    }
    const archivedAt = storageNow();
    const updated = db
      .prepare(
        `UPDATE catalog_worker_versions
            SET archived = 1, archived_at = ?, updated_at = ?
          WHERE id = ? AND archived = 0`,
      )
      .run(archivedAt, archivedAt, workerVersionId);
    if (Number(updated.changes) !== 1) {
      throw new PersistenceError(
        "conflict",
        `worker version ${workerVersionId} could not be archived`,
      );
    }
    const stored = this.getVersionFrom(db, workerVersionId);
    if (stored === null) {
      throw new PersistenceError("not_found", `worker version ${workerVersionId} was not found`);
    }
    return stored;
  }

  async forkToDraft(
    tx: Tx,
    sourceWorkerVersionId: string,
    next: { worker: WorkerDto; draft: WorkerDraftDto },
  ): Promise<ForkWorkerVersionAcceptedDto> {
    const db = sqliteDbOf(tx);
    const source = this.getVersionFrom(db, sourceWorkerVersionId);
    if (source === null) {
      throw new PersistenceError(
        "not_found",
        `worker version ${sourceWorkerVersionId} was not found`,
      );
    }
    const identity = parseWorker(next.worker);
    const draft = parseWorkerDraft(next.draft);
    if (identity.id !== draft.workerId) {
      throw new PersistenceError(
        "constraint",
        `worker draft ${draft.id} does not belong to worker ${identity.id}`,
      );
    }
    if (identity.id === source.workerId) {
      throw new PersistenceError(
        "constraint",
        `fork of ${sourceWorkerVersionId} must create a new worker identity`,
      );
    }
    insertWorkerRow(db, identity, draft.updatedAt, sourceWorkerVersionId);
    insertDraftRow(db, draftWithCopiedCardFields(draft, source));
    const unchanged = this.getVersionFrom(db, sourceWorkerVersionId);
    if (unchanged === null || versionFingerprint(unchanged) !== versionFingerprint(source)) {
      throw new PersistenceError(
        "conflict",
        `fork mutated source version ${sourceWorkerVersionId}`,
      );
    }
    return parseForkWorkerVersionAccepted({
      workerId: identity.id,
      workerDraftId: draft.id,
      forkedFromWorkerVersionId: sourceWorkerVersionId,
    });
  }

  private selectWorkerRows(query: ListWorkersInput, fetchCount: number): Record<string, unknown>[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (query.status !== undefined) {
      clauses.push("w.status = ?");
      params.push(query.status);
    }
    if (query.cursor !== undefined) {
      clauses.push("w.id > ?");
      params.push(query.cursor);
    }
    if (query.q !== undefined) {
      const pattern = likePattern(query.q);
      clauses.push(`(
        w.name LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR w.description LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM catalog_worker_versions v
           WHERE v.worker_id = w.id
             AND (
               v.name LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR v.description LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR v.role LIKE ? ESCAPE '\\' COLLATE NOCASE
             )
        )
        OR EXISTS (
          SELECT 1 FROM worker_drafts d
           WHERE d.worker_id = w.id
             AND (
               d.name LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR d.description LIKE ? ESCAPE '\\' COLLATE NOCASE
               OR d.role LIKE ? ESCAPE '\\' COLLATE NOCASE
             )
        )
      )`);
      params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(fetchCount);
    return this.db
      .prepare(
        `SELECT ${WORKER_COLUMNS}
           FROM catalog_workers w
           ${where}
          ORDER BY w.id ASC
          LIMIT ?`,
      )
      .all(...params);
  }

  private listVersionsFor(workerId: string, includeArchived: boolean): WorkerVersionDto[] {
    const sql = includeArchived
      ? `SELECT ${VERSION_COLUMNS} FROM catalog_worker_versions
          WHERE worker_id = ? ORDER BY created_at ASC, id ASC`
      : `SELECT ${VERSION_COLUMNS} FROM catalog_worker_versions
          WHERE worker_id = ? AND archived = 0 ORDER BY created_at ASC, id ASC`;
    return this.db.prepare(sql).all(workerId).map(rowToVersion);
  }

  private toWorkerDto(row: Record<string, unknown>, versions: WorkerVersionDto[]): WorkerDto {
    return parseWorker({
      id: requiredText(cell(row, "id"), "id"),
      name: requiredText(cell(row, "name"), "name"),
      ...ifPresent("description", emptyToNull(optionalText(cell(row, "description")))),
      protocolVersion: "0.1",
      status: requiredText(cell(row, "status"), "status"),
      ...ifPresent("activeVersionId", optionalText(cell(row, "active_version_id"))),
      versions,
      stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
      definitionRevision: requiredInt(cell(row, "definition_revision"), "definition_revision"),
    });
  }

  private getVersionFrom(db: DatabaseSync, workerVersionId: string): WorkerVersionDto | null {
    const row = db
      .prepare(`SELECT ${VERSION_COLUMNS} FROM catalog_worker_versions WHERE id = ?`)
      .get(workerVersionId);
    return row === undefined ? null : rowToVersion(row);
  }
}

function insertWorkerRow(
  db: DatabaseSync,
  worker: WorkerDto,
  now: string,
  forkedFromWorkerVersionId?: string,
): void {
  try {
    db.prepare(
      `INSERT INTO catalog_workers (
         id, name, description, protocol_version, status, state_revision,
         definition_revision, active_version_id, forked_from_worker_version_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, '0.1', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      worker.id,
      worker.name,
      worker.description ?? "",
      worker.status,
      worker.stateRevision ?? 1,
      worker.definitionRevision ?? 1,
      worker.activeVersionId ?? null,
      forkedFromWorkerVersionId ?? null,
      now,
      now,
    );
  } catch (error) {
    mapLibraryWriteError(error, `catalog worker ${worker.id} already exists`);
  }
}

function insertDraftRow(db: DatabaseSync, draft: WorkerDraftDto): void {
  try {
    db.prepare(
      `INSERT INTO worker_drafts (
         id, worker_id, revision, status, name, description, role, runtime_profile_id,
         content_hash, updated_at, updated_by, who, how, skills
       ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      draft.id,
      draft.workerId,
      draft.revision,
      draft.name,
      draft.description ?? "",
      draft.role,
      draft.runtimeProfileId ?? null,
      draft.contentHash,
      draft.updatedAt,
      draft.updatedBy,
      nullableCardField(draft.who),
      nullableCardField(draft.how),
      nullableCardField(draft.skills),
    );
  } catch (error) {
    mapLibraryWriteError(error, `worker draft ${draft.id} already exists`);
  }
}

function assertWorkerExists(db: DatabaseSync, workerId: string): void {
  const row = db.prepare("SELECT 1 AS present FROM catalog_workers WHERE id = ?").get(workerId);
  if (row === undefined) {
    throw new PersistenceError("not_found", `catalog worker ${workerId} was not found`);
  }
}

function currentDraftRevision(db: DatabaseSync, workerId: string): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM worker_drafts WHERE worker_id = ?")
    .get(workerId) as Record<string, unknown>;
  return requiredInt(cell(row, "revision"), "revision");
}

function rowToVersion(row: Record<string, unknown>): WorkerVersionDto {
  return parseWorkerVersion({
    id: requiredText(cell(row, "id"), "id"),
    workerId: requiredText(cell(row, "worker_id"), "worker_id"),
    version: requiredText(cell(row, "version"), "version"),
    status: requiredText(cell(row, "status"), "status"),
    immutable: requiredInt(cell(row, "immutable"), "immutable") === 1,
    archived: requiredInt(cell(row, "archived"), "archived") === 1,
    name: requiredText(cell(row, "name"), "name"),
    ...ifPresent("description", emptyToNull(optionalText(cell(row, "description")))),
    role: requiredText(cell(row, "role"), "role"),
    ...ifPresent("runtimeProfileId", optionalText(cell(row, "runtime_profile_id"))),
    ...ifPresent(
      "forkedFromWorkerVersionId",
      optionalText(cell(row, "forked_from_worker_version_id")),
    ),
    stateRevision: requiredInt(cell(row, "state_revision"), "state_revision"),
    ...ifPresent("publishedAt", optionalText(cell(row, "published_at"))),
    ...ifPresent("archivedAt", optionalText(cell(row, "archived_at"))),
    ...cardFieldsFromRow(row),
  });
}

function rowToDraft(row: Record<string, unknown>): WorkerDraftDto {
  return parseWorkerDraft({
    id: requiredText(cell(row, "id"), "id"),
    workerId: requiredText(cell(row, "worker_id"), "worker_id"),
    revision: requiredInt(cell(row, "revision"), "revision"),
    status: "draft",
    name: requiredText(cell(row, "name"), "name"),
    ...ifPresent("description", emptyToNull(optionalText(cell(row, "description")))),
    role: requiredText(cell(row, "role"), "role"),
    ...ifPresent("runtimeProfileId", optionalText(cell(row, "runtime_profile_id"))),
    contentHash: requiredText(cell(row, "content_hash"), "content_hash"),
    updatedAt: requiredText(cell(row, "updated_at"), "updated_at"),
    updatedBy: requiredText(cell(row, "updated_by"), "updated_by"),
    ...cardFieldsFromRow(row),
  });
}

function cardFieldsFromRow(row: Record<string, unknown>): WorkerCardFieldsDto {
  return parseWorkerCardFields({
    ...ifPresent("who", optionalText(cell(row, "who"))),
    ...ifPresent("how", optionalText(cell(row, "how"))),
    ...ifPresent("skills", optionalText(cell(row, "skills"))),
  });
}

function cardFieldsFromVersion(version: WorkerVersionDto): WorkerCardFieldsDto {
  return parseWorkerCardFields({
    ...ifPresent("who", version.who ?? null),
    ...ifPresent("how", version.how ?? null),
    ...ifPresent("skills", version.skills ?? null),
  });
}

function draftWithCopiedCardFields(draft: WorkerDraftDto, source: WorkerVersionDto): WorkerDraftDto {
  return parseWorkerDraft({
    id: draft.id,
    workerId: draft.workerId,
    revision: draft.revision,
    status: draft.status,
    name: draft.name,
    ...ifPresent("description", draft.description ?? null),
    role: draft.role,
    ...ifPresent("runtimeProfileId", draft.runtimeProfileId ?? null),
    contentHash: draft.contentHash,
    updatedAt: draft.updatedAt,
    updatedBy: draft.updatedBy,
    ...cardFieldsFromVersion(source),
  });
}

/** Undefined stays NULL (absent). Empty string is an explicit blank cell. */
function nullableCardField(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function emptyToNull(value: string | null): string | null {
  return value === "" ? null : value;
}

function likePattern(query: string): string {
  return `%${query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function storageNow(): string {
  return new Date().toISOString();
}

function versionFingerprint(version: WorkerVersionDto): string {
  return JSON.stringify(version);
}

function mapLibraryWriteError(error: unknown, conflictMessage: string): never {
  if (isConstraintError(error)) {
    throw new PersistenceError("conflict", conflictMessage);
  }
  throw error;
}
