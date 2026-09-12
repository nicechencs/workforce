import {
  parseAuthoringProposal,
  parseStartRunRequest,
  type ReceiptScope,
  type StartRunRequest,
} from "@workforce/protocol";
import type {
  EventCursor,
  InputReceipt,
  OperationReceipt,
  ReconciliationResult,
  RuntimeAdapter,
  RuntimeConfig,
  RuntimeDescriptor,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeHandleRef,
  RuntimeInput,
  RuntimeStatus,
  ValidationResult,
} from "@workforce/runtime-spi";

import type { Clock, Scheduler } from "./clock.js";
import { SystemClock, TimeoutScheduler } from "./clock.js";
import { startRequestDigest } from "./digest.js";
import { RuntimeSdkError } from "./errors.js";
import { AsyncEventQueue, toRuntimeEvent } from "./events.js";
import type { IdGenerator } from "./ids.js";
import { SequentialIdGenerator } from "./ids.js";
import type { RuntimeHostStore } from "./store.js";
import {
  hostEventCursor,
  isActiveStatus,
  isTerminalStatus,
  parseHostEventCursor,
  type HostRuntimeEvent,
  type PlacementSnapshot,
  type ProcessTreeKiller,
  RecordingProcessTreeKiller,
  type StoredHandle,
  type StoredNodeSession,
} from "./types.js";

export interface LocalNodeHostOptions {
  adapter: RuntimeAdapter;
  store: RuntimeHostStore;
  clock?: Clock;
  scheduler?: Scheduler;
  ids?: IdGenerator;
  nodeId?: string;
  maxConcurrentRuns?: number;
  leaseDurationMs?: number;
  cancelGraceMs?: number;
  processTreeKiller?: ProcessTreeKiller;
}

export class LocalNodeHost implements RuntimeAdapter {
  private readonly adapter: RuntimeAdapter;
  private readonly store: RuntimeHostStore;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly ids: IdGenerator;
  private readonly nodeId: string;
  private readonly maxConcurrentRuns: number;
  private readonly leaseDurationMs: number;
  private readonly cancelGraceMs: number;
  private readonly processTreeKiller: ProcessTreeKiller;
  private readonly liveTails = new Map<string, Set<AsyncEventQueue<HostRuntimeEvent>>>();
  private readonly pumps = new Map<string, Promise<void>>();
  private readonly forceKilled = new Set<string>();
  private writeChain: Promise<void> = Promise.resolve();
  private sessionPromise: Promise<StoredNodeSession> | undefined;
  private disposed = false;

  constructor(options: LocalNodeHostOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.clock = options.clock ?? new SystemClock();
    this.scheduler = options.scheduler ?? new TimeoutScheduler();
    this.ids = options.ids ?? new SequentialIdGenerator();
    this.nodeId = options.nodeId ?? "ndl_local";
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 8;
    this.leaseDurationMs = options.leaseDurationMs ?? 60 * 60 * 1000;
    this.cancelGraceMs = options.cancelGraceMs ?? 1000;
    this.processTreeKiller = options.processTreeKiller ?? new RecordingProcessTreeKiller();
  }

  async describe(): Promise<RuntimeDescriptor> {
    return this.adapter.describe();
  }

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    return this.adapter.validate(config);
  }

  async start(request: StartRunRequest): Promise<RuntimeHandle> {
    await this.ensureSession();
    const parsed = parseStartRunRequest(request);
    this.assertProtocol(parsed);
    this.assertNode(parsed);
    await this.assertAdapterId(parsed);

    const digest = startRequestDigest(parsed);
    const scope = startScope(parsed);

    const byOperation = await this.store.getOperation(parsed.operationId);
    if (byOperation) {
      if (byOperation.requestDigest !== digest) {
        throw new RuntimeSdkError(
          "conflict",
          "start operation payload does not match the original request",
          { details: { operationId: parsed.operationId } },
        );
      }
      const existing = await this.handleFromOperation(byOperation.handleId);
      if (existing) {
        return existing;
      }
    }

    const byScope = await this.store.getOperationByScope(scope);
    if (byScope && byScope.operationId !== parsed.operationId) {
      if (byScope.requestDigest !== digest) {
        throw new RuntimeSdkError(
          "idempotency_key_reused",
          "idempotency key was reused with a different start payload",
          { details: { idempotencyKey: parsed.idempotencyKey } },
        );
      }
      const existing = await this.handleFromOperation(byScope.handleId);
      if (existing) {
        return existing;
      }
    }

    await this.assertLeaseAllowsMutation();
    await this.assertCapacity();

    const acceptedAt = this.nowIso();
    await this.store.putOperation({
      operationId: parsed.operationId,
      status: "pending",
      scope,
      requestDigest: digest,
      acceptedAt,
    });

    let handle: RuntimeHandle;
    try {
      handle = await this.adapter.start(parsed);
    } catch (error) {
      await this.store.putOperation({
        operationId: parsed.operationId,
        status: "failed",
        scope,
        requestDigest: digest,
        acceptedAt,
        error: {
          code: error instanceof RuntimeSdkError ? error.code : "conflict",
          message: error instanceof Error ? error.message : "start failed",
        },
      });
      throw error;
    }

    const session = await this.requireSession();
    const binding = this.bindingFor(parsed, session);
    const inspected = await this.adapter.inspect(handle);
    await this.store.putHandle({
      handle,
      binding,
      status: inspected.status,
      terminal: isTerminalStatus(inspected.status),
      request: parsed,
      auditOnly: false,
      ...(inspected.lastTrustedFactAt ? { lastTrustedFactAt: inspected.lastTrustedFactAt } : {}),
    });
    await this.store.putOperation({
      operationId: parsed.operationId,
      status: "committed",
      scope,
      requestDigest: digest,
      acceptedAt,
      handleId: handle.handleId,
    });
    this.ensurePump(handle);
    return handle;
  }

  async sendInput(handle: RuntimeHandleRef, input: RuntimeInput): Promise<InputReceipt> {
    await this.ensureSession();
    const stored = await this.requireStoredHandle(handle.handleId);
    await this.assertLeaseAllowsMutation(stored.binding);
    return this.adapter.sendInput(handle, input);
  }

  async pause(handle: RuntimeHandleRef): Promise<OperationReceipt> {
    void handle;
    throw new RuntimeSdkError("unsupported_capability", "lifecycle.pause is unsupported", {
      details: { capability: "lifecycle.pause" },
    });
  }

  async resume(handle: RuntimeHandleRef): Promise<OperationReceipt> {
    void handle;
    throw new RuntimeSdkError("unsupported_capability", "lifecycle.pause is unsupported", {
      details: { capability: "lifecycle.pause" },
    });
  }

  async cancel(handle: RuntimeHandleRef, reason?: string): Promise<OperationReceipt> {
    await this.ensureSession();
    const receipt = await this.adapter.cancel(handle, reason);
    await this.enqueueWrite(async () => {
      const stored = await this.requireStoredHandle(handle.handleId);
      if (stored.cancelAcceptedAt) {
        return;
      }
      await this.store.putHandle({
        ...stored,
        cancelAcceptedAt: this.nowIso(),
      });
      this.scheduler.schedule(this.cancelGraceMs, () => {
        void this.forceCancel(stored.handle);
      });
    });
    return receipt;
  }

  async inspect(handle: RuntimeHandleRef): Promise<RuntimeStatus> {
    await this.ensureSession();
    const stored = await this.store.getHandle(handle.handleId);
    if (!stored) {
      throw new RuntimeSdkError("not_found", "runtime handle not found", {
        details: { handleId: handle.handleId },
      });
    }
    const session = await this.requireSession();
    if (stored.auditOnly || !this.isBindingCurrent(stored.binding, session)) {
      return storedStatus(stored);
    }
    try {
      const live = await this.adapter.inspect(handle);
      await this.store.putHandle({
        ...stored,
        status: live.status,
        terminal: isTerminalStatus(live.status),
        ...(live.lastTrustedFactAt ? { lastTrustedFactAt: live.lastTrustedFactAt } : {}),
      });
      return live;
    } catch {
      return storedStatus(stored);
    }
  }

  async *stream(handle: RuntimeHandleRef, cursor?: EventCursor): AsyncIterable<RuntimeEvent> {
    await this.ensureSession();
    const stored = await this.requireStoredHandle(handle.handleId);
    this.ensurePump(stored.handle);
    const afterSequence = this.decodeHostCursor(cursor);
    const tail = new AsyncEventQueue<HostRuntimeEvent>();
    let tails = this.liveTails.get(handle.handleId);
    if (!tails) {
      tails = new Set();
      this.liveTails.set(handle.handleId, tails);
    }
    tails.add(tail);
    try {
      const replay = await this.store.listEvents(handle.handleId, afterSequence);
      const seen = new Set<number>();
      let sawTerminal = stored.terminal;
      for (const event of replay) {
        seen.add(event.sequence);
        yield toRuntimeEvent(event);
        if (!event.auditOnly && isTerminalLifecycle(event.type)) {
          sawTerminal = true;
        }
      }
      if (sawTerminal) {
        return;
      }
      for await (const event of tail) {
        if (seen.has(event.sequence)) {
          continue;
        }
        seen.add(event.sequence);
        yield toRuntimeEvent(event);
        if (!event.auditOnly && isTerminalLifecycle(event.type)) {
          return;
        }
      }
    } finally {
      tails.delete(tail);
      tail.close();
    }
  }

  async reconcile(handle: RuntimeHandle): Promise<ReconciliationResult> {
    await this.ensureSession();
    const stored = await this.store.getHandle(handle.handleId);
    if (!stored) {
      return {
        attached: false,
        status: {
          handle: { handleId: handle.handleId, runId: handle.runId },
          status: "unknown",
        },
      };
    }

    const session = await this.requireSession();
    if (stored.auditOnly || !this.isBindingCurrent(stored.binding, session)) {
      return {
        attached: false,
        status: storedStatus(stored),
      };
    }

    const storedIdentity = stored.handle.process?.startIdentity;
    const providedIdentity = handle.process?.startIdentity;
    if (storedIdentity && providedIdentity && storedIdentity !== providedIdentity) {
      const status: RuntimeStatus = {
        handle: { handleId: handle.handleId, runId: handle.runId },
        status: "orphaned",
        ...(stored.lastTrustedFactAt ? { lastTrustedFactAt: stored.lastTrustedFactAt } : {}),
      };
      return { attached: false, status };
    }

    try {
      const result = await this.adapter.reconcile(handle);
      await this.store.putHandle({
        ...stored,
        status: result.status.status,
        terminal: isTerminalStatus(result.status.status),
        ...(result.status.lastTrustedFactAt
          ? { lastTrustedFactAt: result.status.lastTrustedFactAt }
          : {}),
      });
      if (result.attached) {
        this.ensurePump(stored.handle);
      }
      return {
        attached: result.attached,
        status: result.status,
      };
    } catch {
      return {
        attached: false,
        status: storedStatus(stored),
      };
    }
  }

  async recover(): Promise<ReconciliationResult[]> {
    await this.ensureSession();
    const handles = await this.store.listHandles();
    const results: ReconciliationResult[] = [];
    for (const stored of handles) {
      if (stored.terminal) {
        continue;
      }
      results.push(await this.reconcile(stored.handle));
    }
    return results;
  }

  async getBinding(handleId: string): Promise<PlacementSnapshot> {
    const stored = await this.requireStoredHandle(handleId);
    return stored.binding;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const tails of this.liveTails.values()) {
      for (const tail of tails) {
        tail.close();
      }
    }
    this.liveTails.clear();
  }

  private async forceCancel(handle: RuntimeHandle): Promise<void> {
    if (this.disposed || this.forceKilled.has(handle.handleId)) {
      return;
    }
    this.forceKilled.add(handle.handleId);
    const stored = await this.store.getHandle(handle.handleId);
    if (!stored) {
      return;
    }
    const live = await this.adapter.reconcile(stored.handle);
    if (live.status.status === "orphaned" || live.status.status === "unknown") {
      return;
    }
    if (stored.handle.process) {
      await this.processTreeKiller.forceKillTree(stored.handle.process);
    }
  }

  private async handleFromOperation(
    handleId: string | undefined,
  ): Promise<RuntimeHandle | undefined> {
    if (!handleId) {
      return undefined;
    }
    const stored = await this.store.getHandle(handleId);
    return stored?.handle;
  }

  private async requireStoredHandle(handleId: string): Promise<StoredHandle> {
    const stored = await this.store.getHandle(handleId);
    if (!stored) {
      throw new RuntimeSdkError("not_found", "runtime handle not found", { details: { handleId } });
    }
    return stored;
  }

  private async assertCapacity(): Promise<void> {
    const handles = await this.store.listHandles();
    const active = handles.filter((record) => isActiveStatus(record.status)).length;
    if (active >= this.maxConcurrentRuns) {
      throw new RuntimeSdkError("resource_exhausted", "local node capacity exhausted", {
        retryable: true,
        details: { maxConcurrentRuns: this.maxConcurrentRuns, active },
      });
    }
  }

  private async assertLeaseAllowsMutation(binding?: PlacementSnapshot): Promise<StoredNodeSession> {
    const session = await this.requireSession();
    if (Date.parse(session.expiresAt) <= this.clock.now().getTime()) {
      throw new RuntimeSdkError("lease_expired", "execution lease expired", {
        retryable: true,
        details: { executionLeaseId: session.executionLeaseId },
      });
    }
    if (
      binding &&
      (binding.nodeId !== session.nodeId ||
        binding.nodeSessionId !== session.nodeSessionId ||
        binding.executionLeaseId !== session.executionLeaseId ||
        binding.fencingToken !== session.fencingToken)
    ) {
      throw new RuntimeSdkError("lease_expired", "execution lease is no longer current", {
        retryable: true,
        details: {
          executionLeaseId: binding.executionLeaseId,
          fencingToken: binding.fencingToken,
          currentExecutionLeaseId: session.executionLeaseId,
          currentFencingToken: session.fencingToken,
        },
      });
    }
    return session;
  }

  private assertProtocol(request: StartRunRequest): void {
    const major = Number.parseInt(request.runtime.protocolVersion.split(".")[0] ?? "", 10);
    if (major !== 0) {
      throw new RuntimeSdkError(
        "unsupported_protocol",
        `unsupported protocol major version ${request.runtime.protocolVersion}`,
        { details: { protocolVersion: request.runtime.protocolVersion } },
      );
    }
  }

  private assertNode(request: StartRunRequest): void {
    if (request.placement.executionNodeId !== this.nodeId) {
      throw new RuntimeSdkError("validation_failed", "start request targets a different node", {
        details: {
          expected: this.nodeId,
          actual: request.placement.executionNodeId,
        },
      });
    }
  }

  private async assertAdapterId(request: StartRunRequest): Promise<void> {
    const descriptor = await this.adapter.describe();
    if (request.runtime.adapterId !== descriptor.adapter.id) {
      throw new RuntimeSdkError("validation_failed", "adapter id does not match this host", {
        details: {
          expected: descriptor.adapter.id,
          actual: request.runtime.adapterId,
        },
      });
    }
  }

  private bindingFor(request: StartRunRequest, session: StoredNodeSession): PlacementSnapshot {
    return {
      nodeId: request.placement.executionNodeId,
      nodeSessionId: session.nodeSessionId,
      runtimeInstallationId: request.placement.runtimeInstallationId,
      executionLeaseId: session.executionLeaseId,
      fencingToken: session.fencingToken,
      workspaceInstanceId: request.placement.workspaceInstanceId,
    };
  }

  private decodeHostCursor(cursor?: EventCursor): number {
    if (!cursor) {
      return 0;
    }
    const sequence = parseHostEventCursor(cursor.sourceCursor);
    if (sequence === undefined) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "event cursor resume is unsupported; Host only replays its own buffer",
        { details: { capability: "event.resume", sourceCursor: cursor.sourceCursor } },
      );
    }
    return sequence;
  }

  private ensurePump(handle: RuntimeHandle): void {
    if (this.disposed || this.pumps.has(handle.handleId)) {
      return;
    }
    this.pumps.set(handle.handleId, this.pump(handle));
  }

  private async pump(handle: RuntimeHandle): Promise<void> {
    try {
      for await (const event of this.adapter.stream(handle)) {
        if (this.disposed) {
          return;
        }
        await this.ingest(handle, event);
      }
    } catch {
      // Live status is recovered through inspect/reconcile, never by rerunning.
    }
  }

  private async ingest(handle: RuntimeHandle, event: RuntimeEvent): Promise<void> {
    const sanitized = sanitizeRuntimeEvent(event);
    const hostEvent = await this.enqueueWrite(async () => {
      const stored = await this.store.getHandle(handle.handleId);
      if (!stored) {
        return undefined;
      }
      if (sanitized.sourceCursor) {
        const duplicate = await this.store.findEventByAdapterCursor(
          handle.handleId,
          sanitized.sourceCursor,
        );
        if (duplicate) {
          return undefined;
        }
      }

      const existing = await this.store.listEvents(handle.handleId);
      const last = existing[existing.length - 1];
      const adapterSequence = asNumber(sanitized.data["adapterSequence"]);
      const eventGap =
        stored.eventGap === true ||
        (last !== undefined &&
          adapterSequence !== undefined &&
          asNumber(last.data["adapterSequence"]) !== undefined &&
          adapterSequence !== (asNumber(last.data["adapterSequence"]) ?? 0) + 1);

      const session = await this.requireSession();
      const auditOnly = stored.auditOnly || !this.isBindingCurrent(stored.binding, session);
      const sequence = (last?.sequence ?? 0) + 1;
      const nextEvent: HostRuntimeEvent = {
        id: this.ids.ulid("evt_"),
        type: sanitized.type,
        time: sanitized.time,
        data: sanitized.data,
        handleId: handle.handleId,
        runId: handle.runId,
        sequence,
        fencingToken: stored.binding.fencingToken,
        auditOnly,
        sourceCursor: hostEventCursor(sequence),
        ...(sanitized.sourceCursor ? { adapterCursor: sanitized.sourceCursor } : {}),
      };
      await this.store.appendEvent(nextEvent);

      const nextStatus = auditOnly
        ? stored.status
        : (statusFromEvent(sanitized.type) ?? stored.status);
      await this.store.putHandle({
        ...stored,
        status: nextStatus,
        terminal: auditOnly ? stored.terminal : isTerminalStatus(nextStatus),
        auditOnly,
        ...(auditOnly
          ? {}
          : {
              lastTrustedFactAt: sanitized.time,
            }),
        ...(eventGap ? { eventGap: true } : {}),
        ...(stored.cancelAcceptedAt ? { cancelAcceptedAt: stored.cancelAcceptedAt } : {}),
      });
      return nextEvent;
    });

    if (!hostEvent) {
      return;
    }
    const tails = this.liveTails.get(handle.handleId);
    if (tails) {
      for (const tail of tails) {
        tail.push(hostEvent);
        if (!hostEvent.auditOnly && isTerminalLifecycle(sanitized.type)) {
          tail.close();
        }
      }
    }
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async ensureSession(): Promise<StoredNodeSession> {
    this.sessionPromise ??= this.openSession();
    return this.sessionPromise;
  }

  private async requireSession(): Promise<StoredNodeSession> {
    const session = await this.store.getNodeSession();
    if (!session) {
      return this.ensureSession();
    }
    return session;
  }

  private isBindingCurrent(binding: PlacementSnapshot, session: StoredNodeSession): boolean {
    return (
      binding.nodeId === session.nodeId &&
      binding.nodeSessionId === session.nodeSessionId &&
      binding.executionLeaseId === session.executionLeaseId &&
      binding.fencingToken === session.fencingToken
    );
  }

  private async openSession(): Promise<StoredNodeSession> {
    const existing = await this.store.getNodeSession();
    const now = this.clock.now();
    const session: StoredNodeSession = {
      nodeId: this.nodeId,
      nodeSessionId: this.ids.ulid("ses_"),
      executionLeaseId: this.ids.ulid("lse_"),
      fencingToken: (existing?.fencingToken ?? 0) + 1,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.leaseDurationMs).toISOString(),
      maxConcurrentRuns: this.maxConcurrentRuns,
    };
    await this.store.putNodeSession(session);
    if (existing) {
      const handles = await this.store.listHandles();
      for (const handle of handles) {
        if (!this.isBindingCurrent(handle.binding, session)) {
          await this.store.putHandle({ ...handle, auditOnly: true });
        }
      }
    }
    return session;
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }
}

/** Validate before persistence so generic RuntimeEvent data cannot smuggle raw authoring input. */
function sanitizeRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  if (event.type !== "runtime.authoring.proposal") {
    return event;
  }
  const adapterSequence = asNumber(event.data["adapterSequence"]);
  try {
    const proposal = parseAuthoringProposal(event.data["proposal"]);
    return {
      type: event.type,
      time: event.time,
      ...(event.sourceCursor ? { sourceCursor: event.sourceCursor } : {}),
      data: {
        proposal,
        ...(adapterSequence === undefined ? {} : { adapterSequence }),
      },
    };
  } catch {
    return {
      type: "runtime.authoring.proposal.rejected",
      time: event.time,
      ...(event.sourceCursor ? { sourceCursor: event.sourceCursor } : {}),
      data: {
        reason: "invalid_authoring_proposal",
        ...(adapterSequence === undefined ? {} : { adapterSequence }),
      },
    };
  }
}

function startScope(request: StartRunRequest): ReceiptScope {
  return {
    principalId: request.principalId,
    clientId: request.clientId,
    canonicalOperation: "runtime.start",
    resource: `task:${request.taskId}:definitionRevision:${request.definitionRevision}:generation:${request.generation}:attempt:${request.attempt}`,
    idempotencyKey: request.idempotencyKey,
  };
}

function storedStatus(stored: StoredHandle): RuntimeStatus {
  return {
    handle: { handleId: stored.handle.handleId, runId: stored.handle.runId },
    status: stored.status,
    ...(stored.lastTrustedFactAt ? { lastTrustedFactAt: stored.lastTrustedFactAt } : {}),
  };
}

function statusFromEvent(type: string): StoredHandle["status"] | undefined {
  switch (type) {
    case "runtime.starting":
      return "starting";
    case "runtime.started":
    case "runtime.resumed":
      return "running";
    case "runtime.input.requested":
      return "waiting_input";
    case "runtime.paused":
      return "paused";
    case "runtime.completed":
      return "succeeded";
    case "runtime.failed":
      return "failed";
    case "runtime.cancelled":
      return "cancelled";
    case "runtime.orphaned":
      return "orphaned";
    default:
      return undefined;
  }
}

function isTerminalLifecycle(type: string): boolean {
  return type === "runtime.completed" || type === "runtime.failed" || type === "runtime.cancelled";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
