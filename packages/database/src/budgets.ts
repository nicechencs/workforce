import type { DatabaseSync } from "node:sqlite";

import type { BudgetRecord, ReservationRecord, Tx } from "@workforce/application";

import { organizationIdOfProject } from "./ensure.js";
import { PersistenceError, isConstraintError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, ifPresent, optionalText, requiredInt, requiredText } from "./sql.js";

const BUDGET_COLUMNS = `
  id, project_id, currency, limit_minor, reserved_minor, settled_minor, authorization_version
`;

const RESERVATION_COLUMNS = `
  id, budget_id, run_id, amount_minor
`;

export class SqliteBudgetRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): BudgetRecord | null {
    const row = this.db.prepare(`SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = ?`).get(id);
    return row ? rowToBudget(row) : null;
  }

  listAll(): BudgetRecord[] {
    return this.db
      .prepare(`SELECT ${BUDGET_COLUMNS} FROM budgets ORDER BY created_at ASC, id ASC`)
      .all()
      .map(rowToBudget);
  }

  insert(tx: Tx, record: BudgetRecord, at: string): void {
    const db = sqliteDbOf(tx);
    const organizationId = organizationIdOfProject(db, record.projectId);
    try {
      db.prepare(
        `INSERT INTO budgets (
           id, organization_id, scope_type, scope_id, currency, limits_json, created_at,
           project_id, limit_minor, reserved_minor, settled_minor, authorization_version, updated_at
         ) VALUES (?, ?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        organizationId,
        record.projectId,
        record.currency,
        limitsJson(record),
        at,
        record.projectId,
        record.limitMinor,
        record.reservedMinor,
        record.settledMinor,
        record.authorizationVersion,
        at,
      );
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PersistenceError("conflict", `budget ${record.id} already exists`);
      }
      throw error;
    }
  }

  update(tx: Tx, record: BudgetRecord, at: string): void {
    const result = sqliteDbOf(tx)
      .prepare(
        `UPDATE budgets
            SET project_id = ?,
                scope_type = 'project',
                scope_id = ?,
                currency = ?,
                limits_json = ?,
                limit_minor = ?,
                reserved_minor = ?,
                settled_minor = ?,
                authorization_version = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(
        record.projectId,
        record.projectId,
        record.currency,
        limitsJson(record),
        record.limitMinor,
        record.reservedMinor,
        record.settledMinor,
        record.authorizationVersion,
        at,
        record.id,
      );
    if (Number(result.changes) === 0) {
      throw new PersistenceError("not_found", `budget ${record.id}`);
    }
  }

  upsert(tx: Tx, record: BudgetRecord, at: string): void {
    if (this.get(record.id)) {
      this.update(tx, record, at);
      return;
    }
    this.insert(tx, record, at);
  }
}

export class SqliteReservationRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(id: string): ReservationRecord | null {
    const row = this.db
      .prepare(
        `SELECT ${RESERVATION_COLUMNS} FROM budget_reservations
          WHERE id = ? AND status = 'active'`,
      )
      .get(id);
    return row ? rowToReservation(row) : null;
  }

  listActive(): ReservationRecord[] {
    return this.db
      .prepare(
        `SELECT ${RESERVATION_COLUMNS} FROM budget_reservations
          WHERE status = 'active'
          ORDER BY created_at ASC, id ASC`,
      )
      .all()
      .map(rowToReservation);
  }

  upsertActive(tx: Tx, record: ReservationRecord, at: string): void {
    sqliteDbOf(tx)
      .prepare(
        `INSERT INTO budget_reservations (
           id, budget_id, run_id, status, amount_minor, created_at
         ) VALUES (?, ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           budget_id = excluded.budget_id,
           run_id = excluded.run_id,
           status = 'active',
           amount_minor = excluded.amount_minor`,
      )
      .run(record.id, record.budgetId, record.runId ?? null, record.amountMinor, at);
  }

  /**
   * Persist the in-memory reservation map: upsert actives, release rows that
   * disappeared from the snapshot (application deletes on release).
   */
  syncActive(tx: Tx, records: ReservationRecord[], at: string): void {
    const keep = new Set(records.map((record) => record.id));
    for (const record of records) {
      this.upsertActive(tx, record, at);
    }
    const db = sqliteDbOf(tx);
    if (keep.size === 0) {
      db.prepare(
        `UPDATE budget_reservations SET status = 'released' WHERE status = 'active'`,
      ).run();
      return;
    }
    const placeholders = [...keep].map(() => "?").join(", ");
    db.prepare(
      `UPDATE budget_reservations
          SET status = 'released'
        WHERE status = 'active' AND id NOT IN (${placeholders})`,
    ).run(...keep);
  }
}

function limitsJson(record: BudgetRecord): string {
  return asJsonText({
    limitMinor: record.limitMinor,
    reservedMinor: record.reservedMinor,
    settledMinor: record.settledMinor,
    authorizationVersion: record.authorizationVersion,
  });
}

function rowToBudget(row: Record<string, unknown>): BudgetRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    projectId: requiredText(cell(row, "project_id"), "project_id"),
    currency: requiredText(cell(row, "currency"), "currency"),
    limitMinor: requiredInt(cell(row, "limit_minor"), "limit_minor"),
    reservedMinor: requiredInt(cell(row, "reserved_minor"), "reserved_minor"),
    settledMinor: requiredInt(cell(row, "settled_minor"), "settled_minor"),
    authorizationVersion: requiredInt(cell(row, "authorization_version"), "authorization_version"),
  };
}

function rowToReservation(row: Record<string, unknown>): ReservationRecord {
  return {
    id: requiredText(cell(row, "id"), "id"),
    budgetId: requiredText(cell(row, "budget_id"), "budget_id"),
    amountMinor: requiredInt(cell(row, "amount_minor"), "amount_minor"),
    ...ifPresent("runId", optionalText(cell(row, "run_id"))),
  };
}
