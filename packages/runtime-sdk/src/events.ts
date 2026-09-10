import type { RuntimeEvent } from "@workforce/runtime-spi";

import type { HostRuntimeEvent } from "./types.js";

export class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    try {
      while (true) {
        const next = this.items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (this.closed) {
          return;
        }
        const result = await new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
        if (result.done) {
          return;
        }
        yield result.value;
      }
    } finally {
      this.close();
    }
  }
}

export function toRuntimeEvent(event: HostRuntimeEvent): RuntimeEvent {
  const data: Record<string, unknown> = {
    ...event.data,
    sequence: event.sequence,
    auditOnly: event.auditOnly,
  };
  const runtimeEvent: RuntimeEvent = {
    type: event.type,
    time: event.time,
    data,
  };
  if (event.sourceCursor) {
    runtimeEvent.sourceCursor = event.sourceCursor;
  }
  return runtimeEvent;
}
