import type { ReceiptScope } from "@workforce/protocol";
import type { Tx } from "../../ports/index.js";

import { UseCaseError } from "./errors.js";
import type { MemoryWorld } from "./store.js";

export function digestOf(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = canonicalize(nested);
    }
    return out;
  }
  return value;
}

export async function withIdempotency<T>(
  world: MemoryWorld,
  tx: Tx,
  input: {
    operationId: string;
    scope: ReceiptScope;
    digest: string;
  },
  fn: () => Promise<T>,
): Promise<{ reused: boolean; value: T }> {
  const existing = await world.receipts.get(input.scope);
  if (existing) {
    if (existing.requestDigest !== input.digest) {
      throw new UseCaseError(
        "idempotency_key_reused",
        "idempotency key reused with a different payload",
        { details: { idempotencyKey: input.scope.idempotencyKey } },
      );
    }
    if (existing.status !== "failed") {
      return { reused: true, value: existing.result as T };
    }
  }
  await world.receipts.putPending(tx, {
    operationId: input.operationId,
    status: "pending",
    scope: input.scope,
    requestDigest: input.digest,
    acceptedAt: world.nowIso(),
  });
  try {
    const value = await fn();
    await world.receipts.complete(tx, input.operationId, value);
    return { reused: false, value };
  } catch (error) {
    await world.receipts.fail(tx, input.operationId, {
      code: error instanceof UseCaseError ? error.code : "conflict",
      message: error instanceof Error ? error.message : "command failed",
      retryable: false,
    });
    throw error;
  }
}
