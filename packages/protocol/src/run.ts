import { RUN_STATUSES, isRunStatus, type RunStatus } from "@workforce/domain";
import { z } from "zod";

export const runStatusSchema = z.enum(RUN_STATUSES);

export function parseRunStatus(input: unknown): RunStatus {
  const status = z.string().parse(input);
  if (!isRunStatus(status)) {
    throw new Error(`illegal RunStatus: ${status}`);
  }
  return status;
}

export { isRunStatus };
