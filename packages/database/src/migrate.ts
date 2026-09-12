import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { applyExecutionAxisBackfill, stampExecutionAxisSwitch } from "./execution-axis-backfill.js";
import { MIGRATIONS, SCHEMA_MIGRATIONS_DDL } from "./schema.js";
import { cell, requiredText } from "./sql.js";

const MIGRATION_APPLY: Partial<Record<string, (db: DatabaseSync, now: string) => void>> = {
  "011_execution_axes_backfill": applyExecutionAxisBackfill,
  "012_execution_axes_switch": stampExecutionAxisSwitch,
};

export function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export function appliedMigrations(db: DatabaseSync): Map<string, string> {
  db.exec(SCHEMA_MIGRATIONS_DDL);
  const rows = db.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all();
  const applied = new Map<string, string>();
  for (const row of rows) {
    applied.set(
      requiredText(cell(row, "version"), "version"),
      requiredText(cell(row, "checksum"), "checksum"),
    );
  }
  return applied;
}

export function migrate(db: DatabaseSync, now: string = new Date().toISOString()): string[] {
  const applied = appliedMigrations(db);
  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    const checksum = checksumSql(migration.sql);
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing !== checksum) {
        throw new Error(
          `migration ${migration.version} checksum mismatch: stored ${existing}, expected ${checksum}`,
        );
      }
      continue;
    }

    const wasOpen = db.isTransaction;
    if (!wasOpen) {
      db.exec("BEGIN IMMEDIATE");
    }
    try {
      db.exec(migration.sql);
      MIGRATION_APPLY[migration.version]?.(db, now);
      db.prepare(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, checksum, now);
      if (!wasOpen) {
        db.exec("COMMIT");
      }
      ran.push(migration.version);
    } catch (error) {
      if (db.isTransaction && !wasOpen) {
        db.exec("ROLLBACK");
      }
      throw error;
    }
  }

  return ran;
}
