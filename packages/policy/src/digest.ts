import { createHash } from "node:crypto";

import type { CanonicalAction } from "./types.js";

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Canonical parameter digest. Key order does not matter; array order does. */
export function parameterDigest(params: unknown): string {
  return sha256Hex(stableJson(params));
}

export function createCanonicalAction(input: {
  type: string;
  resource: string;
  params?: unknown;
  version?: string;
}): CanonicalAction {
  const action: CanonicalAction = {
    type: input.type,
    digest: parameterDigest(input.params ?? {}),
    resource: input.resource,
  };
  if (input.version !== undefined) {
    action.version = input.version;
  }
  return action;
}

export function canonicalize(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = canonicalize(nested);
    }
    return out;
  }
  return value;
}
