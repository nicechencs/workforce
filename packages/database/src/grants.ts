import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { ID_PREFIX } from "@workforce/domain";
import type { ApprovalGrant, GrantKey, GrantStore } from "@workforce/policy";

import { cell, ifPresent, optionalText, requiredText } from "./sql.js";
import type { SqliteUnitOfWork } from "./uow.js";

const GRANT_COLUMNS = `
  id, action_type, digest, resource, version, principal_id, policy_version,
  gate, expires_at, consumed_at
`;

const GRANT_IDENTITY = `
  action_type = ? AND digest = ? AND resource = ? AND version = ? AND principal_id = ? AND policy_version = ?
`;

/**
 * Durable GrantStore. Identity empty-string version matches InMemoryGrantStore.
 * Consumed rows are never cleared by put — fail-closed across restart.
 */
export class SqliteGrantStore implements GrantStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly uow: SqliteUnitOfWork,
  ) {}

  nextId(): string {
    return `${ID_PREFIX.approval}${randomBytes(10).toString("hex")}`;
  }

  async put(grant: ApprovalGrant): Promise<void> {
    await this.uow.withTransaction(async () => {
      this.insertGrant(grant);
    });
  }

  async find(key: GrantKey): Promise<ApprovalGrant | undefined> {
    const row = this.db
      .prepare(`SELECT ${GRANT_COLUMNS} FROM policy_grants WHERE ${GRANT_IDENTITY}`)
      .get(
        key.actionType,
        key.digest,
        key.resource,
        key.version ?? "",
        key.principalId,
        key.policyVersion,
      );
    return row ? rowToGrant(row) : undefined;
  }

  async consume(id: string, consumedAt: string): Promise<boolean> {
    return this.uow.withTransaction(async () => {
      const result = this.db
        .prepare(`UPDATE policy_grants SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`)
        .run(consumedAt, id);
      return Number(result.changes) === 1;
    });
  }

  private insertGrant(grant: ApprovalGrant): void {
    const version = grant.version ?? "";
    this.db
      .prepare(
        `INSERT INTO policy_grants (
           id, action_type, digest, resource, version, principal_id, policy_version,
           gate, expires_at, consumed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(action_type, digest, resource, version, principal_id, policy_version)
         DO UPDATE SET
           expires_at = excluded.expires_at
         WHERE policy_grants.consumed_at IS NULL`,
      )
      .run(
        grant.id,
        grant.actionType,
        grant.digest,
        grant.resource,
        version,
        grant.principalId,
        grant.policyVersion,
        grant.gate,
        grant.expiresAt,
        grant.consumedAt ?? null,
        new Date().toISOString(),
      );
  }
}

function rowToGrant(row: Record<string, unknown>): ApprovalGrant {
  const grant: ApprovalGrant = {
    id: requiredText(cell(row, "id"), "id"),
    actionType: requiredText(cell(row, "action_type"), "action_type"),
    digest: requiredText(cell(row, "digest"), "digest"),
    resource: requiredText(cell(row, "resource"), "resource"),
    principalId: requiredText(cell(row, "principal_id"), "principal_id"),
    policyVersion: requiredText(cell(row, "policy_version"), "policy_version"),
    gate: requiredText(cell(row, "gate"), "gate") as ApprovalGrant["gate"],
    expiresAt: requiredText(cell(row, "expires_at"), "expires_at"),
  };
  const version = requiredText(cell(row, "version"), "version");
  if (version !== "") {
    grant.version = version;
  }
  Object.assign(grant, ifPresent("consumedAt", optionalText(cell(row, "consumed_at"))));
  return grant;
}
