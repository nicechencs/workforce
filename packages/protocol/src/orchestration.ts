import { z } from "zod";

/**
 * D18 dual execution mode. Orthogonal to D19 placement kinds
 * (`local | remote | container`) and D07 transport / placement intent.
 * Old name `executionMode` must not mean placement, and is not a synonym here.
 */
export const orchestrationModes = ["workflow_bound", "direct"] as const;
export type OrchestrationMode = (typeof orchestrationModes)[number];

/** Existing M3 Mock / fixtures omit the field; parsed output stays workflow-bound. */
export const DEFAULT_ORCHESTRATION_MODE = "workflow_bound" as const;

export const orchestrationModeSchema = z.enum(orchestrationModes);

export function isOrchestrationMode(value: string): value is OrchestrationMode {
  return (orchestrationModes as readonly string[]).includes(value);
}

export function parseOrchestrationMode(input: unknown): OrchestrationMode {
  const value = z.string().parse(input);
  if (!isOrchestrationMode(value)) {
    throw new Error(`illegal OrchestrationMode: ${value}`);
  }
  return value;
}
