import type { ReceiptScope } from "@workforce/protocol";

import type { RuntimeHostStore } from "./store.js";
import type {
  HostRuntimeEvent,
  StoredExecutionLease,
  StoredHandle,
  StoredNodeSession,
  StoredOperation,
} from "./types.js";
import { normalizeStoredNodeSession } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopeKey(scope: ReceiptScope): string {
  return [
    scope.principalId,
    scope.clientId,
    scope.canonicalOperation,
    scope.resource,
    scope.idempotencyKey,
  ].join("\u0000");
}

/**
 * In-memory fake of T04 Handle/receipt persistence. A new Host can attach to
 * the same store instance to simulate Daemon restart without sharing Host RAM.
 */
export class MemoryRuntimeHostStore implements RuntimeHostStore {
  private readonly operations = new Map<string, StoredOperation>();
  private readonly operationsByScope = new Map<string, string>();
  private readonly handles = new Map<string, StoredHandle>();
  private readonly handlesByRunId = new Map<string, string>();
  private readonly events = new Map<string, HostRuntimeEvent[]>();
  private readonly leases = new Map<string, StoredExecutionLease>();
  private readonly leasesByRunId = new Map<string, string>();
  private session: StoredNodeSession | undefined;

  async getOperation(operationId: string): Promise<StoredOperation | undefined> {
    const record = this.operations.get(operationId);
    return record ? clone(record) : undefined;
  }

  async getOperationByScope(scope: ReceiptScope): Promise<StoredOperation | undefined> {
    const operationId = this.operationsByScope.get(scopeKey(scope));
    if (!operationId) {
      return undefined;
    }
    return this.getOperation(operationId);
  }

  async putOperation(record: StoredOperation): Promise<void> {
    const stored = clone(record);
    this.operations.set(stored.operationId, stored);
    this.operationsByScope.set(scopeKey(stored.scope), stored.operationId);
  }

  async getHandle(handleId: string): Promise<StoredHandle | undefined> {
    const record = this.handles.get(handleId);
    return record ? clone(record) : undefined;
  }

  async getHandleByRunId(runId: string): Promise<StoredHandle | undefined> {
    const handleId = this.handlesByRunId.get(runId);
    if (!handleId) {
      return undefined;
    }
    return this.getHandle(handleId);
  }

  async listHandles(): Promise<StoredHandle[]> {
    return [...this.handles.values()].map((record) => clone(record));
  }

  async putHandle(record: StoredHandle): Promise<void> {
    const stored = clone(record);
    this.handles.set(stored.handle.handleId, stored);
    this.handlesByRunId.set(stored.handle.runId, stored.handle.handleId);
  }

  async appendEvent(event: HostRuntimeEvent): Promise<void> {
    const list = this.events.get(event.handleId) ?? [];
    list.push(clone(event));
    this.events.set(event.handleId, list);
  }

  async listEvents(handleId: string, afterSequence = 0): Promise<HostRuntimeEvent[]> {
    const list = this.events.get(handleId) ?? [];
    return list.filter((event) => event.sequence > afterSequence).map((event) => clone(event));
  }

  async findEventByAdapterCursor(
    handleId: string,
    adapterCursor: string,
  ): Promise<HostRuntimeEvent | undefined> {
    const list = this.events.get(handleId) ?? [];
    const found = list.find((event) => event.adapterCursor === adapterCursor);
    return found ? clone(found) : undefined;
  }

  async getNodeSession(): Promise<StoredNodeSession | undefined> {
    return this.session ? clone(this.session) : undefined;
  }

  async putNodeSession(session: StoredNodeSession): Promise<void> {
    this.session = clone(normalizeStoredNodeSession(session));
  }

  async getExecutionLease(id: string): Promise<StoredExecutionLease | undefined> {
    const record = this.leases.get(id);
    return record ? clone(record) : undefined;
  }

  async getExecutionLeaseByRunId(runId: string): Promise<StoredExecutionLease | undefined> {
    const id = this.leasesByRunId.get(runId);
    if (!id) {
      return undefined;
    }
    return this.getExecutionLease(id);
  }

  async listExecutionLeases(): Promise<StoredExecutionLease[]> {
    return [...this.leases.values()].map((record) => clone(record));
  }

  async putExecutionLease(lease: StoredExecutionLease): Promise<void> {
    const stored = clone(lease);
    this.leases.set(stored.id, stored);
    this.leasesByRunId.set(stored.runId, stored.id);
  }
}
