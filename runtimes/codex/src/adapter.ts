import { TextDecoder } from "node:util";

import type { CapturedProcess, ProcessController, ProcessHandle } from "@workforce/process";
import { UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS } from "@workforce/process";
import type { StartRunRequest } from "@workforce/protocol";
import {
  RuntimeSdkError,
  SequentialIdGenerator,
  SystemClock,
  isTerminalStatus,
  type Clock,
  type IdGenerator,
} from "@workforce/runtime-sdk";
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
  RuntimeStatus,
  RuntimeStatusName,
  ValidationResult,
} from "@workforce/runtime-spi";

import { buildCodexExecArgv } from "./command.js";
import { detectCodex, type CodexDetection } from "./detect.js";
import { CodexJsonlDecoder } from "./jsonl.js";
import { parseCodexResolvedStartContext, type ResolveCodexStartContext } from "./start-context.js";

export const CODEX_ADAPTER_ID = "codex";
export const CODEX_ADAPTER_VERSION = "0.1.0";

export interface CodexRuntimeAdapterOptions {
  detect?: () => CodexDetection;
  process?: ProcessController;
  resolveStart?: ResolveCodexStartContext;
  clock?: Clock;
  ids?: IdGenerator;
  platform?: NodeJS.Platform;
}

interface CodexSession {
  handle: RuntimeHandle;
  operationId: string;
  processHandle: ProcessHandle;
  captured: CapturedProcess;
  events: RuntimeEvent[];
  status: RuntimeStatusName;
  lastTrustedFactAt?: string;
  closed: boolean;
  cancelRequested: boolean;
  decoder: CodexJsonlDecoder;
  textDecoder: TextDecoder;
  waiters: Array<() => void>;
  lastSequence: number;
  stderrObserved: boolean;
}

export class CodexRuntimeAdapter implements RuntimeAdapter {
  private readonly detectFn: () => CodexDetection;
  private readonly process: ProcessController | undefined;
  private readonly resolveStart: ResolveCodexStartContext | undefined;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly platform: NodeJS.Platform;
  private readonly byHandle = new Map<string, CodexSession>();
  private readonly byOperation = new Map<string, CodexSession>();

  constructor(options: CodexRuntimeAdapterOptions = {}) {
    this.detectFn = options.detect ?? (() => detectCodex());
    this.process = options.process;
    this.resolveStart = options.resolveStart;
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new SequentialIdGenerator();
    this.platform = options.platform ?? process.platform;
  }

  async describe(): Promise<RuntimeDescriptor> {
    const detection = this.detectFn();
    const startReady = this.canAttemptStart(detection);
    return {
      adapter: {
        id: CODEX_ADAPTER_ID,
        name: "Codex Runtime",
        version: CODEX_ADAPTER_VERSION,
        protocolVersions: ["0.1"],
      },
      runtime: {
        id: CODEX_ADAPTER_ID,
        displayName: "OpenAI Codex CLI",
        ...(detection.version ? { version: detection.version } : {}),
        transport: "process",
      },
      platforms: ["windows", "macos", "linux"],
      capabilities: [
        {
          name: "lifecycle.start",
          version: "0.1",
          available: startReady,
          constraints: {
            reason: startReady
              ? "start_via_captured_process_when_validate_allows"
              : this.startBlockReason(detection),
            liveExec: "untested",
          },
        },
        { name: "lifecycle.pause", version: "0.1", available: false },
        { name: "event.resume", version: "0.1", available: false },
        {
          name: "lifecycle.cancel",
          version: "0.1",
          available: this.process !== undefined && this.capturedProcessSupported(),
          constraints: {
            reason: "cancel_via_process_tree_kill",
          },
        },
        {
          name: "usage.reporting",
          version: "0.1",
          available: startReady,
          constraints: {
            tokenCounts: "jsonl_when_streamed",
            monetaryCost: "unknown",
            liveExec: "untested",
          },
        },
        {
          name: "authoring.proposal",
          version: "0.1",
          available: false,
          constraints: {
            reason: "no_explicit_structured_authoring_proposal_jsonl_item",
            textInference: false,
          },
        },
      ],
    };
  }

  async validate(config: RuntimeConfig): Promise<ValidationResult> {
    const detection =
      config.executable !== undefined
        ? detectCodex({ configuredExecutable: config.executable })
        : this.detectFn();
    const adapterOk = config.adapterId === CODEX_ADAPTER_ID;
    const found = detection.found;
    const processOk = this.process !== undefined;
    const contextOk = this.resolveStart !== undefined;
    const captureOk = this.capturedProcessSupported();
    const checks: ValidationResult["checks"] = [
      {
        name: "adapterId",
        ok: adapterOk,
        ...(adapterOk ? {} : { detail: `expected ${CODEX_ADAPTER_ID}` }),
      },
      {
        name: "executable",
        ok: found,
        detail: found
          ? (detection.executable ?? "codex executable detected")
          : "codex executable not detected",
      },
      {
        name: "process_port",
        ok: processOk,
        detail: processOk
          ? "captured Process port injected"
          : "captured Process port is not injected",
      },
      {
        name: "start_context",
        ok: contextOk,
        detail: contextOk
          ? "resolveStart factory injected"
          : "resolved Workspace/Policy/context factory is not injected",
      },
      {
        name: "captured_process",
        ok: captureOk,
        detail: captureOk
          ? "captured Process supported on this platform"
          : `captured Process unsupported on ${this.platform}`,
      },
    ];
    return {
      valid: adapterOk && found && processOk && contextOk && captureOk,
      ...(detection.version ? { runtimeVersion: detection.version } : {}),
      checks,
    };
  }

  async start(request: StartRunRequest): Promise<RuntimeHandle> {
    const existing = this.byOperation.get(request.operationId);
    if (existing) {
      return existing.handle;
    }

    if (request.runtime.adapterId !== CODEX_ADAPTER_ID) {
      throw new RuntimeSdkError("validation_failed", "adapter id does not match Codex", {
        details: { expected: CODEX_ADAPTER_ID, actual: request.runtime.adapterId },
      });
    }

    // The Codex CLI transport currently has no safe way to receive a
    // Workforce authoring message after `start` has been accepted: the
    // Process port only supports one-shot stdin at spawn time, while the
    // public StartRunRequest deliberately does not carry raw authoring text.
    // Reject authoring starts before resolving context or spawning a process
    // instead of accidentally running the ordinary prompt and then failing
    // the subsequent Host handoff.
    if (isAuthoringSnapshotRef(request.snapshotRef)) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex authoring input handoff is unsupported by the current process transport",
        {
          details: {
            capability: "authoring.proposal",
            inputTransport: "spawn_stdin_only",
            structuredProposal: false,
          },
        },
      );
    }

    const detection = this.detectFn();
    if (!detection.found || detection.executable === undefined) {
      throw new RuntimeSdkError("validation_failed", "Codex CLI was not detected", {
        details: { capability: "detect", runtime: CODEX_ADAPTER_ID },
      });
    }
    if (this.process === undefined) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex start requires an injected captured Process port",
        { details: { capability: "lifecycle.start", runtime: CODEX_ADAPTER_ID } },
      );
    }
    if (this.resolveStart === undefined) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex start requires an injected resolveStart factory for Workspace/Policy/context",
        { details: { capability: "lifecycle.start", runtime: CODEX_ADAPTER_ID } },
      );
    }
    if (!this.capturedProcessSupported()) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        `captured Process is unsupported on ${this.platform}`,
        { details: { capability: "process.capture", platform: this.platform } },
      );
    }

    const resolved = parseCodexResolvedStartContext(await this.resolveStart(request));
    if (resolved === undefined) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex start requires a complete resolved Workspace/Policy/context",
        { details: { capability: "lifecycle.start", runtime: CODEX_ADAPTER_ID } },
      );
    }

    const argv = buildCodexExecArgv({
      executable: detection.executable,
      cwd: resolved.cwd,
      sandbox: resolved.sandbox,
      approval: resolved.approval,
    });
    const stdin = new TextEncoder().encode(resolved.prompt);
    const spawnRequest = {
      argv,
      cwd: resolved.cwd,
      stdin,
      ...(resolved.environment ? { env: resolved.environment } : {}),
    };

    let captured: CapturedProcess;
    try {
      captured = await this.process.spawnCaptured(spawnRequest);
    } catch (error) {
      if (isUnsupportedCapability(error)) {
        throw new RuntimeSdkError(
          "unsupported_capability",
          error instanceof Error ? error.message : "captured Process spawn is unsupported",
          { details: { capability: "process.capture", runtime: CODEX_ADAPTER_ID } },
        );
      }
      throw error;
    }

    const createdAt = this.clock.now().toISOString();
    const handle: RuntimeHandle = {
      handleId: this.ids.ulid("hdl_"),
      runId: this.ids.ulid("run_"),
      adapterId: CODEX_ADAPTER_ID,
      createdAt,
      process: {
        pid: captured.handle.pid,
        startIdentity: captured.handle.startIdentity,
      },
    };
    const session: CodexSession = {
      handle,
      operationId: request.operationId,
      processHandle: captured.handle,
      captured,
      events: [],
      status: "starting",
      lastTrustedFactAt: createdAt,
      closed: false,
      cancelRequested: false,
      decoder: new CodexJsonlDecoder({ now: () => this.clock.now() }),
      textDecoder: new TextDecoder("utf-8"),
      waiters: [],
      lastSequence: 0,
      stderrObserved: false,
    };
    this.byHandle.set(handle.handleId, session);
    this.byOperation.set(request.operationId, session);
    void this.consume(session);
    return handle;
  }

  async sendInput(): Promise<InputReceipt> {
    throw new RuntimeSdkError("unsupported_capability", "Codex mid-run input is untested", {
      details: { capability: "input" },
    });
  }

  async pause(): Promise<OperationReceipt> {
    throw new RuntimeSdkError("unsupported_capability", "Codex has no pause command", {
      details: { capability: "lifecycle.pause" },
    });
  }

  async resume(): Promise<OperationReceipt> {
    throw new RuntimeSdkError(
      "unsupported_capability",
      "Codex resume restores a session, not an event cursor",
      { details: { capability: "event.resume" } },
    );
  }

  async cancel(handle: RuntimeHandleRef, reason?: string): Promise<OperationReceipt> {
    void reason;
    const session = this.byHandle.get(handle.handleId);
    if (this.process === undefined) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex cancel requires an injected captured Process port",
        { details: { capability: "lifecycle.cancel" } },
      );
    }
    if (!session) {
      throw new RuntimeSdkError("not_found", "runtime handle not found", {
        details: { handleId: handle.handleId },
      });
    }
    if (!session.cancelRequested && !isTerminalStatus(session.status)) {
      session.cancelRequested = true;
      await this.process.cancel(session.processHandle, "force");
    }
    return { operationId: `cancel:${handle.handleId}`, accepted: true };
  }

  async inspect(handle: RuntimeHandleRef): Promise<RuntimeStatus> {
    const session = this.byHandle.get(handle.handleId);
    if (!session) {
      return { handle, status: "unknown" };
    }
    if (!isTerminalStatus(session.status) && this.process) {
      try {
        const live = await this.process.inspect(session.processHandle);
        if (!live.alive && !isTerminalStatus(session.status) && !session.cancelRequested) {
          session.status = "unknown";
        }
      } catch {
        // Identity mismatch or inspect failure stays unknown; do not invent a terminal.
        if (!isTerminalStatus(session.status)) {
          session.status = "unknown";
        }
      }
    }
    return {
      handle: { handleId: session.handle.handleId, runId: session.handle.runId },
      status: session.status,
      ...(session.lastTrustedFactAt ? { lastTrustedFactAt: session.lastTrustedFactAt } : {}),
    };
  }

  async *stream(handle: RuntimeHandleRef, cursor?: EventCursor): AsyncIterable<RuntimeEvent> {
    if (cursor) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex event cursor resume is unsupported",
        { details: { capability: "event.resume" } },
      );
    }
    if (this.process === undefined) {
      throw new RuntimeSdkError(
        "unsupported_capability",
        "Codex event streaming requires an injected captured Process port",
        { details: { capability: "event.stream" } },
      );
    }
    const session = this.byHandle.get(handle.handleId);
    if (!session) {
      throw new RuntimeSdkError("not_found", "runtime handle not found", {
        details: { handleId: handle.handleId },
      });
    }
    let index = 0;
    while (true) {
      while (index < session.events.length) {
        const event = session.events[index];
        if (event) {
          yield event;
        }
        index += 1;
      }
      if (session.closed) {
        return;
      }
      await this.waitForMore(session, index);
    }
  }

  async reconcile(handle: RuntimeHandle): Promise<ReconciliationResult> {
    const session = this.byHandle.get(handle.handleId);
    if (!session) {
      return {
        attached: false,
        status: { handle: { handleId: handle.handleId, runId: handle.runId }, status: "unknown" },
      };
    }
    const expected = session.handle.process?.startIdentity;
    const provided = handle.process?.startIdentity;
    if (expected && provided && expected !== provided) {
      return {
        attached: false,
        status: {
          handle: { handleId: handle.handleId, runId: handle.runId },
          status: "orphaned",
          ...(session.lastTrustedFactAt ? { lastTrustedFactAt: session.lastTrustedFactAt } : {}),
        },
      };
    }
    const status = await this.inspect(handle);
    return {
      attached: !isTerminalStatus(status.status) && status.status !== "unknown",
      status,
    };
  }

  private canAttemptStart(detection: CodexDetection): boolean {
    return (
      detection.found &&
      this.process !== undefined &&
      this.resolveStart !== undefined &&
      this.capturedProcessSupported()
    );
  }

  private startBlockReason(detection: CodexDetection): string {
    if (!detection.found) {
      return "codex executable not detected";
    }
    if (this.process === undefined) {
      return "captured Process port is not injected";
    }
    if (this.resolveStart === undefined) {
      return "resolved Workspace/Policy/context factory is not injected";
    }
    if (!this.capturedProcessSupported()) {
      return `captured Process unsupported on ${this.platform}`;
    }
    return "start blocked";
  }

  private capturedProcessSupported(): boolean {
    return !(UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS as readonly string[]).includes(this.platform);
  }

  private async consume(session: CodexSession): Promise<void> {
    try {
      for await (const item of session.captured.output) {
        if (item.source === "stderr") {
          if (item.chunk.byteLength > 0 && !session.stderrObserved) {
            session.stderrObserved = true;
            this.emitLocal(session, "runtime.message", {
              level: "error",
              stream: "stderr",
              contentRedacted: true,
            });
          }
          continue;
        }
        const text = session.textDecoder.decode(item.chunk, { stream: true });
        if (text.length > 0) {
          this.applyDecoded(session, session.decoder.push(text));
        }
      }
      const tail = session.textDecoder.decode();
      if (tail.length > 0) {
        this.applyDecoded(session, session.decoder.push(tail));
      }
      this.applyDecoded(session, session.decoder.flush());
    } catch (error) {
      if (!isTerminalStatus(session.status)) {
        this.emitLocal(session, "runtime.failed", {
          reason: "codex_stream_failed",
          contentRedacted: true,
          ...(error instanceof RuntimeSdkError ? { code: error.code } : {}),
        });
        session.status = "failed";
      }
    }

    let exit: { exitCode: number | null; signal: string | null } | undefined;
    try {
      exit = await session.captured.wait();
    } catch {
      exit = undefined;
    }
    this.finish(session, exit);
  }

  private finish(
    session: CodexSession,
    exit: { exitCode: number | null; signal: string | null } | undefined,
  ): void {
    if (isTerminalStatus(session.status)) {
      session.closed = true;
      this.notify(session);
      return;
    }
    if (session.cancelRequested) {
      session.status = "cancelled";
      this.emitLocal(session, "runtime.cancelled", {});
      session.closed = true;
      this.notify(session);
      return;
    }
    session.status = "failed";
    this.emitLocal(session, "runtime.failed", {
      reason:
        exit && exit.exitCode !== 0 ? "codex_process_exit" : "codex_exited_without_terminal_event",
      ...(exit ? { exitCode: exit.exitCode, signal: exit.signal } : {}),
      contentRedacted: true,
    });
    session.closed = true;
    this.notify(session);
  }

  private applyDecoded(session: CodexSession, events: RuntimeEvent[]): void {
    for (const event of events) {
      session.events.push(event);
      session.lastTrustedFactAt = event.time;
      const sequence = event.data["adapterSequence"];
      if (typeof sequence === "number" && sequence > session.lastSequence) {
        session.lastSequence = sequence;
      }
      this.noteStatus(session, event.type);
      this.notify(session);
    }
  }

  private emitLocal(session: CodexSession, type: string, data: Record<string, unknown>): void {
    session.lastSequence += 1;
    const time = this.clock.now().toISOString();
    session.lastTrustedFactAt = time;
    session.events.push({
      type,
      time,
      data: { ...data, adapterSequence: session.lastSequence },
      sourceCursor: `codex-local:${session.lastSequence}`,
    });
    this.noteStatus(session, type);
    this.notify(session);
  }

  private noteStatus(session: CodexSession, type: string): void {
    if (type === "runtime.started" && session.status === "starting") {
      session.status = "running";
    }
    if (type === "runtime.completed") {
      session.status = "succeeded";
    }
    if (type === "runtime.failed") {
      session.status = "failed";
    }
    if (type === "runtime.cancelled") {
      session.status = "cancelled";
    }
  }

  private waitForMore(session: CodexSession, seen: number): Promise<void> {
    if (session.events.length > seen || session.closed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      session.waiters.push(resolve);
    });
  }

  private notify(session: CodexSession): void {
    const waiters = session.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}

export function createCodexRuntime(options?: CodexRuntimeAdapterOptions): CodexRuntimeAdapter {
  return new CodexRuntimeAdapter(options);
}

function isUnsupportedCapability(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "unsupported_capability"
  );
}

function isAuthoringSnapshotRef(snapshotRef: string): boolean {
  return snapshotRef === "authoring:proposal" || snapshotRef.startsWith("authoring:");
}
