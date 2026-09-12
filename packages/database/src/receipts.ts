import type { DatabaseSync } from "node:sqlite";

import type { CommandReceiptRepository, Tx } from "@workforce/application";

import { PersistenceError } from "./errors.js";
import { sqliteDbOf } from "./session.js";
import { asJsonText, cell, optionalText, parseJson, requiredText } from "./sql.js";

type Receipt = Parameters<CommandReceiptRepository["putPending"]>[1];
type ReceiptScope = Parameters<CommandReceiptRepository["get"]>[0];
type FailError = Parameters<CommandReceiptRepository["fail"]>[2];

export class SqliteCommandReceiptRepository implements CommandReceiptRepository {
  constructor(private readonly db: DatabaseSync) {}

  async get(scope: ReceiptScope): Promise<Receipt | null> {
    const row = this.db
      .prepare(
        `SELECT operation_id, status, principal_id, client_id, canonical_operation,
                resource, idempotency_key, request_digest, accepted_at, result_json, error_json
           FROM command_receipts
          WHERE principal_id = ?
            AND client_id = ?
            AND canonical_operation = ?
            AND resource = ?
            AND idempotency_key = ?`,
      )
      .get(
        scope.principalId,
        scope.clientId,
        scope.canonicalOperation,
        scope.resource,
        scope.idempotencyKey,
      );
    return row ? rowToReceipt(row) : null;
  }

  async getByOperationId(operationId: string): Promise<Receipt | null> {
    const row = this.db
      .prepare(
        `SELECT operation_id, status, principal_id, client_id, canonical_operation,
                resource, idempotency_key, request_digest, accepted_at, result_json, error_json
           FROM command_receipts
          WHERE operation_id = ?`,
      )
      .get(operationId);
    return row ? rowToReceipt(row) : null;
  }

  listAll(): Receipt[] {
    return this.db
      .prepare(
        `SELECT operation_id, status, principal_id, client_id, canonical_operation,
                resource, idempotency_key, request_digest, accepted_at, result_json, error_json
           FROM command_receipts
          ORDER BY accepted_at ASC, operation_id ASC`,
      )
      .all()
      .map(rowToReceipt);
  }

  async putPending(tx: Tx, receipt: Receipt): Promise<void> {
    const db = sqliteDbOf(tx);
    db.prepare(
      `INSERT INTO command_receipts (
         operation_id, status, principal_id, client_id, canonical_operation,
         resource, idempotency_key, request_digest, accepted_at, result_json, error_json
       ) VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      receipt.operationId,
      receipt.scope.principalId,
      receipt.scope.clientId,
      receipt.scope.canonicalOperation,
      receipt.scope.resource,
      receipt.scope.idempotencyKey,
      receipt.requestDigest,
      receipt.acceptedAt,
      receipt.result === undefined ? null : asJsonText(receipt.result),
    );
  }

  async complete(tx: Tx, operationId: string, result: unknown): Promise<void> {
    const db = sqliteDbOf(tx);
    const changes = db
      .prepare(
        `UPDATE command_receipts
            SET status = 'committed', result_json = ?, error_json = NULL
          WHERE operation_id = ? AND status = 'pending'`,
      )
      .run(asJsonText(result), operationId);
    if (Number(changes.changes) === 0) {
      throw new PersistenceError("not_found", `no pending receipt ${operationId}`);
    }
  }

  async fail(tx: Tx, operationId: string, error: FailError): Promise<void> {
    const db = sqliteDbOf(tx);
    const changes = db
      .prepare(
        `UPDATE command_receipts
            SET status = 'failed', error_json = ?
          WHERE operation_id = ? AND status = 'pending'`,
      )
      .run(asJsonText(error), operationId);
    if (Number(changes.changes) === 0) {
      throw new PersistenceError("not_found", `no pending receipt ${operationId}`);
    }
  }
}

function rowToReceipt(row: Record<string, unknown>): Receipt {
  const resultJson = optionalText(cell(row, "result_json"));
  const errorJson = optionalText(cell(row, "error_json"));
  const status = requiredText(cell(row, "status"), "status") as Receipt["status"];
  const receipt: Receipt = {
    operationId: requiredText(cell(row, "operation_id"), "operation_id"),
    status,
    scope: {
      principalId: requiredText(cell(row, "principal_id"), "principal_id"),
      clientId: requiredText(cell(row, "client_id"), "client_id"),
      canonicalOperation: requiredText(cell(row, "canonical_operation"), "canonical_operation"),
      resource: requiredText(cell(row, "resource"), "resource"),
      idempotencyKey: requiredText(cell(row, "idempotency_key"), "idempotency_key"),
    },
    requestDigest: requiredText(cell(row, "request_digest"), "request_digest"),
    acceptedAt: requiredText(cell(row, "accepted_at"), "accepted_at"),
  };
  if (status === "failed" && errorJson !== null) {
    return { ...receipt, result: parseJson(errorJson, "error_json") };
  }
  if (resultJson !== null) {
    return { ...receipt, result: parseJson(resultJson, "result_json") };
  }
  return receipt;
}
