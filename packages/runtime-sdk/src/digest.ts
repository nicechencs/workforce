import { createHash } from "node:crypto";

import type { StartRunRequest } from "@workforce/protocol";

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function startRequestDigest(request: StartRunRequest): string {
  return sha256Hex(
    stableJson({
      idempotencyKey: request.idempotencyKey,
      taskId: request.taskId,
      definitionRevision: request.definitionRevision,
      generation: request.generation,
      attempt: request.attempt,
      principalId: request.principalId,
      clientId: request.clientId,
      placement: request.placement,
      runtime: request.runtime,
      snapshotRef: request.snapshotRef,
      orchestrationMode: request.orchestrationMode,
    }),
  );
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
