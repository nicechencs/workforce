import {
  DEFAULT_LOCAL_NODE_ID,
  LocalNodeHost,
  ManualScheduler,
  MemoryRuntimeHostStore,
  RecordingProcessTreeKiller,
  SequentialIdGenerator,
  type RuntimeHostStore,
} from "@workforce/runtime-sdk";

import { MockRuntimeAdapter } from "./adapter.js";

export interface MockRuntimeHarness {
  host: LocalNodeHost;
  adapter: MockRuntimeAdapter;
  store: RuntimeHostStore;
  scheduler: ManualScheduler;
  killer: RecordingProcessTreeKiller;
  ids: SequentialIdGenerator;
}

export async function createMockRuntime(
  options: {
    store?: RuntimeHostStore;
    adapter?: MockRuntimeAdapter;
    scheduler?: ManualScheduler;
    ids?: SequentialIdGenerator;
    maxConcurrentRuns?: number;
    leaseDurationMs?: number;
    cancelGraceMs?: number;
    timeoutMs?: number;
    nodeId?: string;
  } = {},
): Promise<MockRuntimeHarness> {
  const scheduler = options.scheduler ?? new ManualScheduler();
  const ids = options.ids ?? new SequentialIdGenerator();
  const store = options.store ?? new MemoryRuntimeHostStore();
  const killer = new RecordingProcessTreeKiller();
  const cancelGraceMs = options.cancelGraceMs ?? 1000;
  const adapter =
    options.adapter ??
    new MockRuntimeAdapter({
      clock: scheduler,
      scheduler,
      ids,
      cancelGraceMs,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  const host = new LocalNodeHost({
    adapter,
    store,
    clock: scheduler,
    scheduler,
    ids,
    nodeId: options.nodeId ?? DEFAULT_LOCAL_NODE_ID,
    maxConcurrentRuns: options.maxConcurrentRuns ?? 8,
    leaseDurationMs: options.leaseDurationMs ?? 60 * 60 * 1000,
    cancelGraceMs,
    processTreeKiller: killer,
  });
  return { host, adapter, store, scheduler, killer, ids };
}
