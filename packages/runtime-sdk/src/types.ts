import type { PlacementSnapshot, ReceiptScope, StartRunRequest } from "@workforce/protocol";
import type { RuntimeHandle, RuntimeStatusName } from "@workforce/runtime-spi";

export type { PlacementSnapshot };
/** @deprecated Use PlacementSnapshot. Identity alias only — not a second shape. */
export type NodeExecutionBinding = PlacementSnapshot;

export interface StoredOperation {
  operationId: string;
  status: "pending" | "committed" | "failed";
  scope: ReceiptScope;
  requestDigest: string;
  acceptedAt: string;
  handleId?: string;
  error?: { code: string; message: string };
}

/**
 * Safe on-disk marker for an authoring prompt handoff.
 *
 * The prompt itself is deliberately absent. `digest` is present only for a
 * pending or delivered handoff and is never a reference that can be resolved
 * back to the original content.
 */
export interface StoredAuthoringInput {
  status: "none" | "pending" | "delivered";
  digest?: string;
}

export interface StoredHandle {
  handle: RuntimeHandle;
  binding: PlacementSnapshot;
  status: RuntimeStatusName;
  terminal: boolean;
  request: StartRunRequest;
  auditOnly: boolean;
  /** Safe handoff state; legacy records may omit this field and mean `none`. */
  authoringInput?: StoredAuthoringInput;
  lastTrustedFactAt?: string;
  cancelAcceptedAt?: string;
  eventGap?: boolean;
}

/**
 * Online identity of one Execution Node process. This is not a Run lease and
 * must not carry a fencing token: one node session hosts many concurrent Runs.
 */
export interface StoredNodeSession {
  nodeId: string;
  nodeSessionId: string;
  startedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  maxConcurrentRuns: number;
  /** Monotonic counter used to mint unique per-run fencing tokens. */
  nextFencingToken: number;
}

/** Control-plane / Host copy of the exclusive execution right for one Run. */
export interface StoredExecutionLease {
  id: string;
  runId: string;
  nodeId: string;
  nodeSessionId: string;
  fencingToken: number;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
}

/** Lease identity assigned by Application before Runtime start. */
export interface AssignedExecutionLease {
  id: string;
  fencingToken: number;
  nodeSessionId: string;
  runId?: string;
}

export function normalizeStoredNodeSession(value: StoredNodeSession): StoredNodeSession {
  const legacy = value as StoredNodeSession & {
    acquiredAt?: string;
    fencingToken?: number;
  };
  const nextFencingToken =
    value.nextFencingToken ??
    (typeof legacy.fencingToken === "number" ? legacy.fencingToken + 1 : 1);
  const session: StoredNodeSession = {
    nodeId: value.nodeId,
    nodeSessionId: value.nodeSessionId,
    startedAt: value.startedAt ?? legacy.acquiredAt ?? new Date(0).toISOString(),
    maxConcurrentRuns: value.maxConcurrentRuns,
    nextFencingToken,
  };
  if (value.expiresAt !== undefined) {
    session.expiresAt = value.expiresAt;
  }
  if (value.revokedAt !== undefined) {
    session.revokedAt = value.revokedAt;
  }
  return session;
}

export interface HostRuntimeEvent {
  id: string;
  type: string;
  time: string;
  data: Record<string, unknown>;
  handleId: string;
  runId: string;
  sequence: number;
  fencingToken: number;
  auditOnly: boolean;
  sourceCursor?: string;
  adapterCursor?: string;
}

export interface ProcessTreeKiller {
  forceKillTree(process: {
    pid: number;
    startIdentity: string;
  }): Promise<"killed" | "identity_mismatch" | "not_found">;
}

export class RecordingProcessTreeKiller implements ProcessTreeKiller {
  readonly calls: Array<{ pid: number; startIdentity: string }> = [];

  async forceKillTree(process: {
    pid: number;
    startIdentity: string;
  }): Promise<"killed" | "identity_mismatch" | "not_found"> {
    this.calls.push(process);
    return "killed";
  }
}

export const ACTIVE_RUNTIME_STATUSES: readonly RuntimeStatusName[] = [
  "starting",
  "running",
  "waiting_input",
  "paused",
  "unknown",
  "orphaned",
];

export const TERMINAL_RUNTIME_STATUSES: readonly RuntimeStatusName[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: RuntimeStatusName): boolean {
  return (TERMINAL_RUNTIME_STATUSES as readonly string[]).includes(status);
}

export function isActiveStatus(status: RuntimeStatusName): boolean {
  return (ACTIVE_RUNTIME_STATUSES as readonly string[]).includes(status);
}

export function hostEventCursor(sequence: number): string {
  return `host:${sequence}`;
}

export function parseHostEventCursor(sourceCursor: string): number | undefined {
  const match = /^host:(\d+)$/.exec(sourceCursor);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1] ?? "", 10);
}
