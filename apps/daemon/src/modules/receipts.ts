import type { CommandReceipt, ReceiptScope } from "@workforce/protocol";

export interface StoredReceipt {
  receipt: CommandReceipt;
  httpStatus: number;
  body: unknown;
  etag?: string;
}

function scopeKey(scope: ReceiptScope): string {
  return [
    scope.principalId,
    scope.clientId,
    scope.canonicalOperation,
    scope.resource,
    scope.idempotencyKey,
  ].join("\0");
}

export class MemoryReceiptStore {
  private readonly byScope = new Map<string, StoredReceipt>();
  private readonly byOperation = new Map<string, StoredReceipt>();

  get(scope: ReceiptScope): StoredReceipt | null {
    return this.byScope.get(scopeKey(scope)) ?? null;
  }

  getByOperationId(operationId: string): StoredReceipt | null {
    return this.byOperation.get(operationId) ?? null;
  }

  put(stored: StoredReceipt): void {
    this.byScope.set(scopeKey(stored.receipt.scope), stored);
    this.byOperation.set(stored.receipt.operationId, stored);
  }
}
