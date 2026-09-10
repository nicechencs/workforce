import type { Tx } from "@workforce/application";

import { PersistenceError } from "./errors.js";
import type { SqliteCommandReceiptRepository } from "./receipts.js";
import type { SqliteRunRepository, StartRunInput } from "./runs.js";

export interface StartRunCommand {
  run: StartRunInput;
  scope: {
    principalId: string;
    clientId: string;
    canonicalOperation: string;
    resource: string;
    idempotencyKey: string;
  };
  requestDigest: string;
  acceptedAt: string;
}

export interface StartRunResult {
  runId: string;
  reused: boolean;
}

/**
 * Idempotent Run start inside an open transaction.
 * Same key + digest returns the original Run; same key + different digest conflicts.
 * Does not spawn. Handle persistence is a later short transaction (T05).
 */
export async function startRunIdempotent(
  tx: Tx,
  deps: { runs: SqliteRunRepository; receipts: SqliteCommandReceiptRepository },
  command: StartRunCommand,
): Promise<StartRunResult> {
  const existing = await deps.receipts.get(command.scope);
  if (existing) {
    if (existing.requestDigest !== command.requestDigest) {
      throw new PersistenceError(
        "idempotency_key_reused",
        "idempotency key reused with a different request digest",
      );
    }
    const runId = runIdFromReceipt(existing.result) ?? existing.operationId;
    return { runId, reused: true };
  }

  await deps.receipts.putPending(tx, {
    operationId: command.run.operationId,
    status: "pending",
    scope: command.scope,
    requestDigest: command.requestDigest,
    acceptedAt: command.acceptedAt,
    result: { runId: command.run.runId },
  });
  deps.runs.insertPending(tx, command.run);
  await deps.receipts.complete(tx, command.run.operationId, { runId: command.run.runId });
  return { runId: command.run.runId, reused: false };
}

function runIdFromReceipt(result: unknown): string | undefined {
  if (result !== null && typeof result === "object" && "runId" in result) {
    const runId = (result as { runId: unknown }).runId;
    return typeof runId === "string" ? runId : undefined;
  }
  return undefined;
}
