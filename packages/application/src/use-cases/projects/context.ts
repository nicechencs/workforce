import type { EnginePort } from "./engine-port.js";
import type { MemoryWorld } from "./store.js";
import type { RuntimeHostPort } from "../runs/host.js";
import { revisionConflict } from "./errors.js";

export interface AppContext {
  world: MemoryWorld;
  engine: EnginePort;
  host: RuntimeHostPort;
  principalId: string;
  clientId: string;
}

export function expectRevision(
  record: { id: string; stateRevision: number },
  expected?: number,
): void {
  if (expected !== undefined && record.stateRevision !== expected) {
    throw revisionConflict(record.id, expected, record.stateRevision);
  }
}

export function touch(record: { stateRevision: number; updatedAt?: string }, now: string): void {
  record.stateRevision += 1;
  if (Object.prototype.hasOwnProperty.call(record, "updatedAt")) {
    record.updatedAt = now;
  }
}

export const DEFAULT_GRAPH_ID = "wfv_m3";
