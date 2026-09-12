import { z } from "zod";

/**
 * D07 / D18: three orthogonal execution axes.
 *
 * - `orchestrationMode` — whether the Run participates in this Workflow's
 *   scheduling. It is NOT a transport and NOT a machine location.
 * - `transport` — how the Adapter reaches the Runtime (`process | sdk | http`).
 *   It is resolved from the selected RuntimeProfile/RuntimeInstallation and
 *   must never be rewritten by a client.
 * - `placement` — where the Run executes. `placementIntent` is the request-side
 *   preference; `placementSnapshot` is the resolved binding.
 *
 * The legacy name `executionMode` carries none of the three axes and is not a
 * public field.
 */
export const runtimeTransports = ["process", "sdk", "http"] as const;
export const orchestrationModes = ["workflow_bound", "direct"] as const;

export const placementIntentModes = [
  "automatic",
  "local_only",
  "remote_only",
  "specific_node",
] as const;

export const runtimeTransportSchema = z.enum(runtimeTransports);
export const orchestrationModeSchema = z.enum(orchestrationModes);

export type RuntimeTransport = z.infer<typeof runtimeTransportSchema>;
export type OrchestrationMode = z.infer<typeof orchestrationModeSchema>;

/** Existing M3 Mock / fixtures omit the field; parsed output stays workflow-bound. */
export const DEFAULT_ORCHESTRATION_MODE = "workflow_bound" as const;

export function isOrchestrationMode(value: string): value is OrchestrationMode {
  return (orchestrationModes as readonly string[]).includes(value);
}

/**
 * Request-side placement preference. Never authoritative: the Application still
 * has to pass Policy/Budget/Approval, select a Node and RuntimeInstallation,
 * take a Lease and provision a WorkspaceInstance before a Run may start.
 */
export const placementIntentSchema = z
  .object({
    mode: z.enum(placementIntentModes),
    nodeId: z.string().min(1).optional(),
    requiredLabels: z.record(z.string(), z.string()).optional(),
    preferredLabels: z.record(z.string(), z.string()).optional(),
    dataLocality: z.enum(["workspace_local", "replicated", "remote_access"]).optional(),
  })
  .strict();

export type PlacementIntent = z.infer<typeof placementIntentSchema>;

/**
 * The single resolved placement binding for one Run: Node, Node session,
 * RuntimeInstallation, WorkspaceInstance and the execution Lease/fencing token.
 *
 * A Run may not enter `starting` before this is complete. The Runtime Host
 * stores this object; do not keep a parallel NodeExecutionBinding type.
 */
export const placementSnapshotSchema = z
  .object({
    nodeId: z.string().min(1),
    nodeSessionId: z.string().min(1),
    runtimeInstallationId: z.string().min(1),
    workspaceInstanceId: z.string().min(1),
    executionLeaseId: z.string().min(1),
    fencingToken: z.number().int().nonnegative(),
    /** Set only when the snapshot was rebuilt by a backfill from an older schema. */
    legacySchemaVersion: z.string().min(1).optional(),
  })
  .strict();

export type PlacementSnapshot = z.infer<typeof placementSnapshotSchema>;

/**
 * Canonical, resolved execution facts for one Run. Written once at Run creation
 * and immutable afterwards — a retry creates a new Run with its own snapshot and
 * never rewrites the previous Run's mode.
 *
 * `workflow_bound` requires the confirmed `ProjectExecutionSnapshot` it derives
 * its WorkflowVersion/TeamVersion from; `direct` must not reference one, because
 * it never advances a WorkflowInstance or Project.
 */
export const runExecutionSnapshotSchema = z
  .object({
    orchestrationMode: orchestrationModeSchema,
    transport: runtimeTransportSchema,
    executionSnapshotId: z.string().min(1).optional(),
    placementSnapshot: placementSnapshotSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.orchestrationMode === "workflow_bound" && value.executionSnapshotId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["executionSnapshotId"],
        message: "workflow_bound execution requires executionSnapshotId",
      });
    }
    if (value.orchestrationMode === "direct" && value.executionSnapshotId !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["executionSnapshotId"],
        message: "direct execution must not reference a ProjectExecutionSnapshot",
      });
    }
  });

export type RunExecutionSnapshot = z.infer<typeof runExecutionSnapshotSchema>;

export function parsePlacementSnapshot(input: unknown): PlacementSnapshot {
  return placementSnapshotSchema.parse(input);
}

export function parseRunExecutionSnapshot(input: unknown): RunExecutionSnapshot {
  return runExecutionSnapshotSchema.parse(input);
}
