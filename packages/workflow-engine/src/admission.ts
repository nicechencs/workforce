import type { WorkflowGraph } from "./types.js";

export type AdmissionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Confirm/start/Run admission: Project, tenant, ProjectExecutionSnapshot and
 * WorkflowInstance must name the same Project. Versions are read from the
 * snapshot, never from a separately supplied graph.
 */
export function checkExecutionBinding(input: {
  organizationId: string;
  projectId: string;
  snapshotId: string;
  snapshotProjectId: string;
  instanceProjectId?: string;
  instanceSnapshotId?: string;
  taskProjectId?: string;
}): AdmissionCheck {
  if (input.organizationId.trim() === "") {
    return { ok: false, reason: "project organization is required" };
  }
  if (input.snapshotProjectId !== input.projectId) {
    return {
      ok: false,
      reason: `execution snapshot ${input.snapshotId} does not belong to project ${input.projectId}`,
    };
  }
  if (input.instanceProjectId !== undefined && input.instanceProjectId !== input.projectId) {
    return {
      ok: false,
      reason: `workflow instance does not belong to project ${input.projectId}`,
    };
  }
  if (input.instanceSnapshotId !== undefined && input.instanceSnapshotId !== input.snapshotId) {
    return {
      ok: false,
      reason: "workflow instance must use the project's execution snapshot",
    };
  }
  if (input.taskProjectId !== undefined && input.taskProjectId !== input.projectId) {
    return {
      ok: false,
      reason: `task does not belong to project ${input.projectId}`,
    };
  }
  return { ok: true };
}

/**
 * The published catalog is the only executable graph. A missing version is
 * unpublished and must not be instantiated.
 */
export function requirePublishedWorkflowGraph(
  published: ReadonlyMap<string, WorkflowGraph> | { get(id: string): WorkflowGraph | undefined },
  workflowVersionId: string,
): { ok: true; graph: WorkflowGraph } | { ok: false; reason: string } {
  const graph = published.get(workflowVersionId);
  if (!graph) {
    return {
      ok: false,
      reason: `unpublished workflow version ${workflowVersionId} is not executable`,
    };
  }
  if (graph.id !== workflowVersionId) {
    return {
      ok: false,
      reason: `published workflow version ${workflowVersionId} definition id mismatch`,
    };
  }
  return { ok: true, graph };
}

export function cloneWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}
