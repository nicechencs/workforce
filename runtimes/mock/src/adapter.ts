import type {
  EventCursor,
  InputReceipt,
  OperationReceipt,
  ReconciliationResult,
  RuntimeAdapter,
  RuntimeCapability,
  RuntimeConfig,
  RuntimeDescriptor,
  RuntimeEvent,
  RuntimeHandle,
  RuntimeHandleRef,
  RuntimeInput,
  RuntimeStatus,
  RuntimeStatusName,
  ValidationResult,
} from "@workforce/runtime-spi";
import {
  isTerminalStatus,
  RuntimeSdkError,
  type Clock,
  type IdGenerator,
  type Scheduler,
  SequentialIdGenerator,
  SystemClock,
  TimeoutScheduler,
  sha256Hex,
  stableJson,
} from "@workforce/runtime-sdk";

export const MOCK_ADAPTER_ID = "mock";
export const MOCK_ADAPTER_VERSION = "0.1.0";

export type MockScenarioName =
  | "success"
  | "failure"
  | "waiting_input"
  | "timeout"
  | "authoring_proposal"
  | "authoring_proposal_secret_summary"
  | "authoring_proposal_invalid";

export function parseMockScenario(snapshotRef: string): MockScenarioName {
  if (snapshotRef === "authoring:proposal") {
    return "authoring_proposal";
  }
  const prefixed = snapshotRef.startsWith("mock:")
    ? snapshotRef.slice("mock:".length)
    : snapshotRef;
  const name = prefixed.split(":")[0];
  if (
    name === "success" ||
    name === "failure" ||
    name === "waiting_input" ||
    name === "timeout" ||
    name === "authoring_proposal" ||
    name === "authoring_proposal_secret_summary" ||
    name === "authoring_proposal_invalid"
  ) {
    return name;
  }
  return "success";
}

export interface MockRuntimeAdapterOptions {
  clock?: Clock;
  scheduler?: Scheduler;
  ids?: IdGenerator;
  cancelGraceMs?: number;
  completeAfterMs?: number;
  timeoutMs?: number;
  /** Test-only failure injection for the transient authoring handoff. */
  rejectAuthoringInput?: boolean;
}

type StartRequest = Parameters<RuntimeAdapter["start"]>[0];

export class MockRuntimeAdapter implements RuntimeAdapter {
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly ids: IdGenerator;
  private readonly cancelGraceMs: number;
  private readonly completeAfterMs: number;
  private readonly timeoutMs: number;
  private readonly rejectAuthoringInput: boolean;
  private readonly byHandle = new Map<string, MockExecution>();
  private readonly byOperation = new Map<string, MockExecution>();
  private nextPid = 4100;

  constructor(options: MockRuntimeAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.scheduler = options.scheduler ?? new TimeoutScheduler();
    this.ids = options.ids ?? new SequentialIdGenerator();
    this.cancelGraceMs = options.cancelGraceMs ?? 1000;
    this.completeAfterMs = options.completeAfterMs ?? 0;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.rejectAuthoringInput = options.rejectAuthoringInput ?? false;
  }

  async describe(): Promise<RuntimeDescriptor> {
    return {
      adapter: {
        id: MOCK_ADAPTER_ID,
        name: "Mock Runtime",
        version: MOCK_ADAPTER_VERSION,
        protocolVersions: ["0.1"],
      },
      runtime: {
        id: MOCK_ADAPTER_ID,
        displayName: "Mock Runtime",
        version: MOCK_ADAPTER_VERSION,
        transport: "sdk",
      },
      platforms: ["windows", "macos", "linux"],
      capabilities: mockCapabilities(),
    };
  }

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const adapterOk = config.adapterId === MOCK_ADAPTER_ID;
    const checks: ValidationResult["checks"] = [
      {
        name: "adapterId",
        ok: adapterOk,
        ...(adapterOk ? {} : { detail: `expected ${MOCK_ADAPTER_ID}` }),
      },
    ];
    return {
      valid: adapterOk,
      runtimeVersion: MOCK_ADAPTER_VERSION,
      checks,
    };
  }

  async start(request: StartRequest): Promise<RuntimeHandle> {
    const existing = this.byOperation.get(request.operationId);
    if (existing) {
      return existing.handle;
    }

    const createdAt = this.clock.now().toISOString();
    const pid = this.nextPid;
    this.nextPid += 1;
    const handle: RuntimeHandle = {
      handleId: this.ids.ulid("hdl_"),
      runId: this.ids.ulid("run_"),
      adapterId: MOCK_ADAPTER_ID,
      createdAt,
      process: {
        pid,
        startIdentity: `mock:${pid}:${createdAt}`,
      },
    };
    const execution = new MockExecution({
      handle,
      operationId: request.operationId,
      scenario: parseMockScenario(request.snapshotRef),
      clock: this.clock,
      scheduler: this.scheduler,
      completeAfterMs: this.completeAfterMs,
      timeoutMs: this.timeoutMs,
      cancelGraceMs: this.cancelGraceMs,
      rejectAuthoringInput: this.rejectAuthoringInput,
    });
    this.byHandle.set(handle.handleId, execution);
    this.byOperation.set(request.operationId, execution);
    execution.begin();
    return handle;
  }

  async sendInput(handle: RuntimeHandleRef, input: RuntimeInput): Promise<InputReceipt> {
    const execution = this.require(handle.handleId);
    return { operationId: input.operationId, accepted: execution.acceptInput(input) };
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
    const execution = this.require(handle.handleId);
    execution.requestCancel(reason);
    return { operationId: `cancel:${handle.handleId}`, accepted: true };
  }

  async inspect(handle: RuntimeHandleRef): Promise<RuntimeStatus> {
    const execution = this.require(handle.handleId);
    return execution.inspect();
  }

  async *stream(handle: RuntimeHandleRef, cursor?: EventCursor): AsyncIterable<RuntimeEvent> {
    if (cursor) {
      throw new RuntimeSdkError("unsupported_capability", "event cursor resume is unsupported", {
        details: { capability: "event.resume" },
      });
    }
    const execution = this.require(handle.handleId);
    let index = 0;
    while (true) {
      while (index < execution.events.length) {
        const event = execution.events[index];
        if (event) {
          yield event;
        }
        index += 1;
      }
      if (execution.closed) {
        return;
      }
      await execution.waitForMore(index);
    }
  }

  async reconcile(handle: RuntimeHandle): Promise<ReconciliationResult> {
    const execution = this.byHandle.get(handle.handleId);
    if (!execution) {
      return {
        attached: false,
        status: {
          handle: { handleId: handle.handleId, runId: handle.runId },
          status: "unknown",
        },
      };
    }
    const expected = execution.handle.process?.startIdentity;
    const provided = handle.process?.startIdentity;
    if (expected && provided && expected !== provided) {
      return {
        attached: false,
        status: {
          handle: { handleId: handle.handleId, runId: handle.runId },
          status: "orphaned",
          ...(execution.lastTrustedFactAt
            ? { lastTrustedFactAt: execution.lastTrustedFactAt }
            : {}),
        },
      };
    }
    const status = execution.inspect();
    return {
      attached: !isTerminalStatus(status.status),
      status,
    };
  }

  async dispose(): Promise<void> {
    for (const execution of this.byHandle.values()) {
      execution.dispose();
    }
    this.byHandle.clear();
    this.byOperation.clear();
  }

  private require(handleId: string): MockExecution {
    const execution = this.byHandle.get(handleId);
    if (!execution) {
      throw new RuntimeSdkError("not_found", "runtime handle not found", { details: { handleId } });
    }
    return execution;
  }
}

interface MockExecutionOptions {
  handle: RuntimeHandle;
  operationId: string;
  scenario: MockScenarioName;
  clock: Clock;
  scheduler: Scheduler;
  completeAfterMs: number;
  timeoutMs: number;
  cancelGraceMs: number;
  rejectAuthoringInput: boolean;
}

class MockExecution {
  readonly handle: RuntimeHandle;
  readonly operationId: string;
  readonly scenario: MockScenarioName;
  readonly events: RuntimeEvent[] = [];
  status: RuntimeStatusName = "starting";
  lastTrustedFactAt?: string;
  closed = false;
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly completeAfterMs: number;
  private readonly timeoutMs: number;
  private readonly cancelGraceMs: number;
  private readonly rejectAuthoringInput: boolean;
  private adapterSequence = 0;
  private readonly waiters: Array<() => void> = [];
  private cancelRequested = false;
  private started = false;
  private authoringInputDigest?: string;

  constructor(options: MockExecutionOptions) {
    this.handle = options.handle;
    this.operationId = options.operationId;
    this.scenario = options.scenario;
    this.clock = options.clock;
    this.scheduler = options.scheduler;
    this.completeAfterMs = options.completeAfterMs;
    this.timeoutMs = options.timeoutMs;
    this.cancelGraceMs = options.cancelGraceMs;
    this.rejectAuthoringInput = options.rejectAuthoringInput;
  }

  begin(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.emit("runtime.starting");
    this.status = "running";
    this.emit("runtime.started");
    switch (this.scenario) {
      case "success":
        this.scheduler.schedule(this.completeAfterMs, () => this.succeed());
        break;
      case "authoring_proposal":
      case "authoring_proposal_secret_summary":
      case "authoring_proposal_invalid":
        this.status = "waiting_input";
        this.emit("runtime.input.requested", { kind: "text" });
        break;
      case "failure":
        this.scheduler.schedule(this.completeAfterMs, () => this.fail("mock_failure"));
        break;
      case "timeout":
        this.scheduler.schedule(this.timeoutMs, () => this.fail("timeout"));
        break;
      case "waiting_input":
        this.status = "waiting_input";
        this.emit("runtime.input.requested", { kind: "text" });
        break;
    }
  }

  inspect(): RuntimeStatus {
    return {
      handle: { handleId: this.handle.handleId, runId: this.handle.runId },
      status: this.status,
      ...(this.lastTrustedFactAt ? { lastTrustedFactAt: this.lastTrustedFactAt } : {}),
    };
  }

  acceptInput(input: RuntimeInput): boolean {
    if (this.isAuthoringScenario() && this.rejectAuthoringInput) {
      this.emit("runtime.message", {
        inputOperationId: input.operationId,
        accepted: false,
      });
      return false;
    }
    this.emit("runtime.message", {
      inputOperationId: input.operationId,
      accepted: true,
    });
    if (this.status !== "waiting_input" || this.cancelRequested) {
      return false;
    }
    if (this.isAuthoringScenario()) {
      this.authoringInputDigest = sha256Hex(stableJson(input));
    }
    this.status = "running";
    this.emit("runtime.started", { resumedFrom: "waiting_input" });
    this.scheduler.schedule(this.completeAfterMs, () => this.succeed());
    return true;
  }

  requestCancel(reason?: string): void {
    if (this.cancelRequested || isTerminalStatus(this.status)) {
      return;
    }
    this.cancelRequested = true;
    this.emit("runtime.message", { cancelAccepted: true, ...(reason ? { reason } : {}) });
    this.scheduler.schedule(this.cancelGraceMs, () => this.markCancelled());
  }

  waitForMore(seen: number): Promise<void> {
    if (this.events.length > seen || this.closed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  dispose(): void {
    this.closed = true;
    this.notify();
  }

  private succeed(): void {
    if (this.cancelRequested || isTerminalStatus(this.status)) {
      return;
    }
    this.emit("runtime.usage.updated", { tokens: 12 });
    if (this.scenario === "authoring_proposal") {
      this.emit("runtime.authoring.proposal", {
        proposal: {
          id: `apr_${this.handle.handleId}`,
          projectId: "prj_mock_authoring",
          sourceRunId: "run_mock_authoring",
          summary: "Mock authoring proposal",
          targets: [
            {
              targetType: "workflow",
              targetId: "wf_mock_authoring",
              expectedRevision: 1,
              patchRef: this.authoringPatchRef(),
            },
          ],
        },
      });
    }
    if (this.scenario === "authoring_proposal_secret_summary") {
      this.emit("runtime.authoring.proposal", {
        proposal: {
          id: `apr_${this.handle.handleId}`,
          projectId: "prj_mock_authoring",
          sourceRunId: "run_mock_authoring",
          summary: "secret: must-not-reach-host-storage",
          targets: [
            {
              targetType: "workflow",
              targetId: "wf_mock_authoring",
              expectedRevision: 1,
              patchRef: this.authoringPatchRef(),
            },
          ],
        },
      });
    }
    if (this.scenario === "authoring_proposal_invalid") {
      this.emit("runtime.authoring.proposal", {
        proposal: { rawPrompt: "must-not-reach-host-storage" },
      });
    }
    this.emit(
      "runtime.message",
      this.isAuthoringScenario() ? { completed: true } : { text: "mock completed" },
    );
    this.status = "succeeded";
    this.emit("runtime.completed", { outcome: "succeeded" });
    this.closed = true;
    this.notify();
  }

  private fail(reason: string): void {
    if (this.cancelRequested || isTerminalStatus(this.status)) {
      return;
    }
    this.status = "failed";
    this.emit("runtime.failed", { reason });
    this.closed = true;
    this.notify();
  }

  private markCancelled(): void {
    if (isTerminalStatus(this.status)) {
      return;
    }
    this.status = "cancelled";
    this.emit("runtime.cancelled");
    this.closed = true;
    this.notify();
  }

  private emit(type: string, data: Record<string, unknown> = {}): void {
    this.adapterSequence += 1;
    const time = this.clock.now().toISOString();
    this.lastTrustedFactAt = time;
    this.events.push({
      type,
      time,
      data: { ...data, adapterSequence: this.adapterSequence },
      sourceCursor: `mock:${this.handle.handleId}:${this.adapterSequence}`,
    });
    this.notify();
  }

  private isAuthoringScenario(): boolean {
    return (
      this.scenario === "authoring_proposal" ||
      this.scenario === "authoring_proposal_secret_summary" ||
      this.scenario === "authoring_proposal_invalid"
    );
  }

  private authoringPatchRef(): string {
    const digest = this.authoringInputDigest ?? "missing-input";
    return `arv_mock_authoring_${digest.slice(0, 16)}`;
  }

  private notify(): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}

function mockCapabilities(): RuntimeCapability[] {
  return [
    { name: "coding", version: "1.0", available: true },
    { name: "interactive_input", version: "1.0", available: true },
    {
      name: "usage.reporting",
      version: "1.0",
      available: true,
      constraints: { money: false, tokens: true },
    },
    {
      name: "authoring.proposal",
      version: "0.1",
      available: true,
      constraints: { structured: true, rawIntent: false },
    },
    { name: "lifecycle.pause", version: "1.0", available: false },
    { name: "event.resume", version: "1.0", available: false },
  ];
}
