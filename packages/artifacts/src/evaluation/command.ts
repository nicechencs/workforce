import { ProcessControllerError, type CapturedProcess, type ProcessExitResult } from "@workforce/process";

const PREVIEW_LIMIT = 2048;

export interface DrainedCapturedOutput {
  byteLength: number;
  preview: string;
}

/**
 * Consumes captured stdout/stderr to EOF so `wait()` can prove terminal
 * output handling. The preview is truncated and is never treated as an exit code.
 */
export async function drainCapturedOutput(
  output: CapturedProcess["output"],
): Promise<DrainedCapturedOutput> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let byteLength = 0;
  let preview = "";
  for await (const item of output) {
    byteLength += item.chunk.byteLength;
    if (preview.length < PREVIEW_LIMIT) {
      preview += decoder.decode(item.chunk, { stream: true });
      if (preview.length > PREVIEW_LIMIT) {
        preview = preview.slice(0, PREVIEW_LIMIT);
      }
    }
  }
  const tail = decoder.decode();
  if (preview.length < PREVIEW_LIMIT && tail.length > 0) {
    preview = `${preview}${tail}`.slice(0, PREVIEW_LIMIT);
  }
  return { byteLength, preview };
}

export async function waitCapturedExit(captured: CapturedProcess): Promise<ProcessExitResult> {
  const drained = drainCapturedOutput(captured.output);
  const [exit] = await Promise.all([captured.wait(), drained]);
  return exit;
}

export function isProcessControllerError(error: unknown): error is ProcessControllerError {
  return error instanceof ProcessControllerError;
}

export function commandCriterionPassed(exit: ProcessExitResult): boolean {
  return exit.exitCode === 0 && exit.signal === null;
}

export function describeProcessExit(exit: ProcessExitResult): string {
  return `exitCode=${exit.exitCode === null ? "null" : String(exit.exitCode)} signal=${exit.signal ?? "null"}`;
}
