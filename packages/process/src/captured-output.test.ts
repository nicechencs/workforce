import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { captureChildOutput } from "./captured-output.js";

describe("captured output mux", () => {
  it("retains fast output from both sources until the consumer attaches", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    captured.setAbortHandler(async () => undefined);

    stdout.end("out");
    stderr.end("err");

    const events = [];
    for await (const event of captured.iterable) {
      events.push({ source: event.source, text: Buffer.from(event.chunk).toString("utf8") });
    }
    expect(events).toEqual([
      { source: "stdout", text: "out" },
      { source: "stderr", text: "err" },
    ]);
  });

  it("surfaces a source error and requests force cancellation", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    const abort = vi.fn(async () => undefined);
    captured.setAbortHandler(abort);
    const consuming = consume(captured.iterable);

    stdout.destroy(new Error("stdout failed"));

    await expect(consuming).rejects.toThrow("stdout failed");
    expect(abort).toHaveBeenCalledTimes(1);
    stderr.end();
  });

  it("rejects a second consumer", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    captured.setAbortHandler(async () => undefined);
    const first = captured.iterable[Symbol.asyncIterator]();
    const second = captured.iterable[Symbol.asyncIterator]();

    await expect(second.next()).rejects.toThrow("only one consumer");
    stdout.end();
    stderr.end();
    await expect(first.next()).resolves.toMatchObject({ done: true });
  });

  it("return before the first next aborts immediately and only once", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    const abort = vi.fn(async () => undefined);
    captured.setAbortHandler(abort);
    const iterator = captured.iterable[Symbol.asyncIterator]();

    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
    expect(abort).toHaveBeenCalledTimes(1);
    stdout.end();
    stderr.end();
  });

  it("return wakes a pending next without waiting for abort completion", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    let finishAbort: (() => void) | undefined;
    const abort = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAbort = resolve;
        }),
    );
    captured.setAbortHandler(abort);
    const iterator = captured.iterable[Symbol.asyncIterator]();

    const pending = iterator.next();
    const returning = iterator.return?.();
    await expect(pending).resolves.toMatchObject({ done: true });
    expect(abort).toHaveBeenCalledTimes(1);
    finishAbort?.();
    await expect(returning).resolves.toMatchObject({ done: true });
    stdout.end();
    stderr.end();
  });

  it("surfaces abort failure through return, wait-race signal, and repeated return", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    const failure = new Error("cancel failed");
    const abort = vi.fn(async () => Promise.reject(failure));
    captured.setAbortHandler(abort);
    const iterator = captured.iterable[Symbol.asyncIterator]();

    await expect(iterator.return?.()).rejects.toBe(failure);
    await expect(iterator.return?.()).rejects.toBe(failure);
    await expect(captured.abortFailure).resolves.toBe(failure);
    expect(abort).toHaveBeenCalledTimes(1);
    stdout.end();
    stderr.end();
  });

  it("throw aborts, wakes a pending next, and rejects with the caller error", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const captured = captureChildOutput({ stdout, stderr } as unknown as ChildProcess);
    const abort = vi.fn(async () => undefined);
    captured.setAbortHandler(abort);
    const iterator = captured.iterable[Symbol.asyncIterator]();
    const pending = iterator.next();
    const failure = new Error("consumer failed");

    await expect(iterator.throw?.(failure)).rejects.toBe(failure);
    await expect(pending).resolves.toMatchObject({ done: true });
    expect(abort).toHaveBeenCalledTimes(1);
    stdout.end();
    stderr.end();
  });
});

async function consume(output: AsyncIterable<unknown>): Promise<void> {
  for await (const event of output) {
    void event;
    // Drain only; assertions concern terminal behavior.
  }
}
