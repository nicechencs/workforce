import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

import type { ProcessOutput, ProcessOutputSource } from "@workforce/application/ports";

export const CAPTURED_OUTPUT_BUFFER_LIMIT = 8 * 1024 * 1024;

export interface ManagedCapturedOutput {
  readonly iterable: AsyncIterable<ProcessOutput>;
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
  #queuedBytes = 0;
  #consumerStarted = false;
  #discarding = false;
  #failure: Error | undefined;
  #wakeConsumer: (() => void) | undefined;
  #abortHandler: (() => Promise<void>) | undefined;
  #abortRequested = false;
  #abortPromise: Promise<void> | undefined;

  constructor(stdout: Readable, stderr: Readable) {
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
    if (this.#abortRequested) {
      void this.#abort();
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<ProcessOutput> {
    if (this.#consumerStarted) {
      return failedIterator(new Error("captured process output supports only one consumer"));
    }
    this.#consumerStarted = true;
    return this.#iterate();
  }

  async *#iterate(): AsyncGenerator<ProcessOutput> {
    let reachedEnd = false;
    try {
      while (true) {
        const next = this.#queue.shift();
        if (next) {
          this.#queuedBytes -= next.chunk.byteLength;
          yield next;
          continue;
        }
        if (this.#failure) {
          throw this.#failure;
        }
        if (this.#ended.size === 2) {
          reachedEnd = true;
          return;
        }
        await new Promise<void>((resolve) => {
          this.#wakeConsumer = resolve;
        });
        this.#wakeConsumer = undefined;
      }
    } finally {
      if (!reachedEnd && !this.#failure) {
        this.#discarding = true;
        this.#queue.length = 0;
        this.#queuedBytes = 0;
        await this.#requestAbort();
      }
    }
  }

  #drain(stream: Readable, source: ProcessOutputSource): void {
    stream.on("data", (raw: unknown) => {
      if (this.#discarding) {
        return;
      }
      const chunk = toBytes(raw);
      if (this.#queuedBytes + chunk.byteLength > CAPTURED_OUTPUT_BUFFER_LIMIT) {
        this.#fail(outputOverflowError());
        return;
      }
      this.#queue.push({ source, chunk });
      this.#queuedBytes += chunk.byteLength;
      this.#wake();
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
    this.#wake();
  }

  #fail(error: Error): void {
    if (!this.#failure) {
      this.#failure = error;
    }
    this.#discarding = true;
    this.#queue.length = 0;
    this.#queuedBytes = 0;
    this.#wake();
    void this.#requestAbort();
  }

  #wake(): void {
    this.#wakeConsumer?.();
  }

  #requestAbort(): Promise<void> {
    this.#abortRequested = true;
    return this.#abort();
  }

  #abort(): Promise<void> {
    if (this.#abortPromise) {
      return this.#abortPromise;
    }
    if (!this.#abortHandler) {
      return Promise.resolve();
    }
    this.#abortPromise = this.#abortHandler().catch((error: unknown) => {
      this.#failure ??= toError(error);
      this.#wake();
    });
    return this.#abortPromise;
  }
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
