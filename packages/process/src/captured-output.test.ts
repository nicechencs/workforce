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
});

async function consume(output: AsyncIterable<unknown>): Promise<void> {
  for await (const event of output) {
    void event;
    // Drain only; assertions concern terminal behavior.
  }
}
