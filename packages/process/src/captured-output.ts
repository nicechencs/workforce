import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import type { ProcessOutput, ProcessOutputSource } from "@workforce/application/ports";

export const CAPTURED_OUTPUT_BUFFER_LIMIT = 8 * 1024 * 1024;

type AbortOutcome = { ok: true } | { ok: false; error: Error };

export interface ManagedCapturedOutput {
  readonly iterable: AsyncIterable<ProcessOutput>;
  /** Resolves only if a requested process abort fails. */
  readonly abortFailure: Promise<Error>;
  setAbortHandler(handler: () => Promise<void>): void;
}

export function captureChildOutput(child: ChildProcess): ManagedCapturedOutput {
  if (!child.stdout || !child.stderr) {
    throw new Error("captured process streams are unavailable");
  }
  return new CapturedOutputMux(child.stdout, child.stderr);
}

class CapturedOutputMux implements ManagedCapturedOutput, AsyncIterable<ProcessOutput> {
  readonly #queue: ProcessOutput[] = [];
  readonly #ended = new Set<ProcessOutputSource>();
  readonly abortFailure: Promise<Error>;
  #resolveAbortFailure!: (error: Error) => void;
  #queuedBytes = 0;
  #consumerStarted = false;
  #discarding = false;
  #stopped = false;
  #failure: Error | undefined;
  #pending: PendingNext | undefined;
  #abortHandler: (() => Promise<void>) | undefined;
  #abortRequested = false;
  #abortOutcome: Promise<AbortOutcome> | undefined;
  #resolveAbortOutcome: ((outcome: AbortOutcome) => void) | undefined;

  constructor(stdout: Readable, stderr: Readable) {
    this.abortFailure = new Promise((resolve) => {
      this.#resolveAbortFailure = resolve;
    });
    this.#drain(stdout, "stdout");
    this.#drain(stderr, "stderr");
  }

  get iterable(): AsyncIterable<ProcessOutput> {
    return this;
  }

  setAbortHandler(handler: () => Promise<void>): void {
    if (this.#abortHandler) {
      throw new Error("captured output abort handler is already set");
    }
    this.#abortHandler = handler;
    this.#startAbort();
  }

  [Symbol.asyncIterator](): AsyncIterator<ProcessOutput> {
    if (this.#consumerStarted) {
      return failedIterator(new Error("captured process output supports only one consumer"));
    }
    this.#consumerStarted = true;
    return new CapturedOutputIterator(this);
  }

  next(): Promise<IteratorResult<ProcessOutput>> {
    const next = this.#queue.shift();
    if (next) {
      this.#queuedBytes -= next.chunk.byteLength;
      return Promise.resolve({ done: false, value: next });
    }
    if (this.#failure) {
      return this.#terminalFailure();
    }
    if (this.#stopped || this.#ended.size === 2) {
      return Promise.resolve(doneResult());
    }
    if (this.#pending) {
      return Promise.reject(
        new Error("captured process output does not support concurrent next()"),
      );
    }
    return new Promise((resolve, reject) => {
      this.#pending = { resolve, reject };
    });
  }

  stop(reason?: unknown): Promise<IteratorResult<ProcessOutput>> {
    if (!this.#stopped) {
      this.#stopped = true;
      this.#discarding = true;
      this.#queue.length = 0;
      this.#queuedBytes = 0;
      this.#settlePendingDone();
      this.#requestAbort();
    }
    return this.#finishStop(reason);
  }

  #drain(stream: Readable, source: ProcessOutputSource): void {
    stream.on("data", (raw: unknown) => {
      if (this.#discarding) {
        return;
      }
      const chunk = toBytes(raw);
      if (this.#pending) {
        const pending = this.#pending;
        this.#pending = undefined;
        pending.resolve({ done: false, value: { source, chunk } });
        return;
      }
      if (this.#queuedBytes + chunk.byteLength > CAPTURED_OUTPUT_BUFFER_LIMIT) {
        this.#fail(outputOverflowError());
        return;
      }
      this.#queue.push({ source, chunk });
      this.#queuedBytes += chunk.byteLength;
    });
    stream.once("error", (error) => {
      this.#fail(error);
      this.#markEnded(source);
    });
    stream.once("end", () => {
      this.#markEnded(source);
    });
    stream.once("close", () => {
      this.#markEnded(source);
    });
  }

  #markEnded(source: ProcessOutputSource): void {
    this.#ended.add(source);
    if (this.#ended.size === 2 && this.#queue.length === 0) {
      this.#settlePendingDone();
    }
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    this.#discarding = true;
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    this.#requestAbort();
    this.#settlePendingFailure();
  }

  #requestAbort(): Promise<AbortOutcome> {
    this.#abortRequested = true;
    if (!this.#abortOutcome) {
      this.#abortOutcome = new Promise((resolve) => {
        this.#resolveAbortOutcome = resolve;
      });
    }
    this.#startAbort();
    return this.#abortOutcome;
  }

  #startAbort(): void {
    const resolve = this.#resolveAbortOutcome;
    if (!this.#abortRequested || !this.#abortHandler || !resolve) {
      return;
    }
    this.#resolveAbortOutcome = undefined;
    void Promise.resolve()
      .then(() => this.#abortHandler?.())
      .then(
        () => resolve({ ok: true }),
        (error: unknown) => {
          const normalized = toError(error);
          this.#resolveAbortFailure(normalized);
          resolve({ ok: false, error: normalized });
        },
      );
  }

  async #finishStop(reason: unknown): Promise<IteratorResult<ProcessOutput>> {
    const outcome = await this.#requestAbort();
    if (!outcome.ok) {
      if (reason !== undefined) {
        throw new AggregateError([toError(reason), outcome.error], "captured output abort failed");
      }
      throw outcome.error;
    }
    if (reason !== undefined) {
      throw reason;
    }
    return doneResult();
  }

  async #terminalFailure(): Promise<IteratorResult<ProcessOutput>> {
    const failure = this.#failure;
    if (!failure) {
      return doneResult();
    }
    const outcome = await this.#requestAbort();
    if (!outcome.ok && outcome.error !== failure) {
      throw new AggregateError([failure, outcome.error], "captured output and abort failed");
    }
    throw failure;
  }

  #settlePendingDone(): void {
    const pending = this.#pending;
    if (!pending) {
      return;
    }
    this.#pending = undefined;
    pending.resolve(doneResult());
  }

  #settlePendingFailure(): void {
    const pending = this.#pending;
    if (!pending) {
      return;
    }
    this.#pending = undefined;
    void this.#terminalFailure().then(pending.resolve, pending.reject);
  }
}

type PendingNext = {
  resolve: (result: IteratorResult<ProcessOutput>) => void;
  reject: (error: unknown) => void;
};

class CapturedOutputIterator implements AsyncIterator<ProcessOutput> {
  readonly #mux: CapturedOutputMux;

  constructor(mux: CapturedOutputMux) {
    this.#mux = mux;
  }

  next(): Promise<IteratorResult<ProcessOutput>> {
    return this.#mux.next();
  }

  return(): Promise<IteratorResult<ProcessOutput>> {
    return this.#mux.stop();
  }

  throw(error?: unknown): Promise<IteratorResult<ProcessOutput>> {
    return this.#mux.stop(error ?? new Error("captured process output iteration aborted"));
  }
}

function doneResult(): IteratorReturnResult<undefined> {
  return { done: true, value: undefined };
}

function toBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  return Buffer.from(String(raw));
}

function outputOverflowError(): Error {
  const error = new Error(
    `captured process output exceeded the ${CAPTURED_OUTPUT_BUFFER_LIMIT}-byte buffer limit`,
  );
  error.name = "ProcessOutputOverflowError";
  Object.assign(error, { code: "process_output_overflow" });
  return error;
}

function failedIterator(error: Error): AsyncIterator<ProcessOutput> {
  return {
    next: async () => Promise.reject(error),
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
