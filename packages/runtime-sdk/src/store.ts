import type { ReceiptScope } from "@workforce/protocol";

import type {
  HostRuntimeEvent,
  StoredHandle,
  StoredNodeSession,
  StoredOperation,
} from "./types.js";

/**
 * Persistence port for Local Node Host. T04 can replace the in-memory
 * implementation without changing Host call sites.
 */
export interface RuntimeHostStore {
  getOperation(operationId: string): Promise<StoredOperation | undefined>;
  getOperationByScope(scope: ReceiptScope): Promise<StoredOperation | undefined>;
  putOperation(record: StoredOperation): Promise<void>;

  getHandle(handleId: string): Promise<StoredHandle | undefined>;
  getHandleByRunId(runId: string): Promise<StoredHandle | undefined>;
  listHandles(): Promise<StoredHandle[]>;
  putHandle(record: StoredHandle): Promise<void>;

  appendEvent(event: HostRuntimeEvent): Promise<void>;
  listEvents(handleId: string, afterSequence?: number): Promise<HostRuntimeEvent[]>;
  findEventByAdapterCursor(
    handleId: string,
    adapterCursor: string,
  ): Promise<HostRuntimeEvent | undefined>;

  getNodeSession(): Promise<StoredNodeSession | undefined>;
  putNodeSession(session: StoredNodeSession): Promise<void>;
}
