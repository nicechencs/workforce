import { validationFailed } from "./errors.js";
import type { WorkflowGraph } from "./engine-port.js";
import { digestOf } from "./idempotency.js";
import type {
  ProjectExecutionSnapshotRecord,
  ProjectRecord,
  TaskRecord,
  WorkflowInstanceRecord,
} from "./store.js";

export function cloneWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  return JSON.parse(JSON.stringify(graph)) as WorkflowGraph;
}

/**
 * Confirm/start read the published catalog only. `world.workflowVersions` is
 * that catalog for the in-memory slice (SQLite `workflow_versions` after persist).
 * A request-body graph may first-publish into the catalog insert-once; it is
 * never the live instance graph.
 */
export function resolvePublishedExecutionGraph(
  published: Map<string, WorkflowGraph>,
  versionId: string,
  offered?: WorkflowGraph,
): WorkflowGraph {
  const existing = published.get(versionId);
  if (existing) {
    if (existing.id !== versionId) {
      throw validationFailed(`published workflow version ${versionId} definition id mismatch`);
    }
    if (offered && digestOf(existing) !== digestOf(offered)) {
      throw validationFailed(`workflow version ${versionId} is immutable`);
    }
    return cloneWorkflowGraph(existing);
  }
  if (!offered) {
    throw validationFailed(`unpublished workflow version ${versionId} is not executable`);
  }
  if (offered.id !== versionId) {
    throw validationFailed(`published workflow version ${versionId} definition id mismatch`);
  }
  const graph = cloneWorkflowGraph(offered);
  published.set(graph.id, graph);
  return cloneWorkflowGraph(graph);
}

export function requirePublishedExecutionGraph(
  published: Map<string, WorkflowGraph>,
  versionId: string,
): WorkflowGraph {
  const existing = published.get(versionId);
  if (!existing) {
    throw validationFailed(`unpublished workflow version ${versionId} is not executable`);
  }
  if (existing.id !== versionId) {
    throw validationFailed(`published workflow version ${versionId} definition id mismatch`);
  }
  return cloneWorkflowGraph(existing);
}

export function assertExecutionBinding(input: {
  project: ProjectRecord;
  snapshot: ProjectExecutionSnapshotRecord;
  workflow?: WorkflowInstanceRecord;
  task?: TaskRecord;
}): void {
  if (input.project.organizationId.trim() === "") {
    throw validationFailed("project organization is required");
  }
  if (input.snapshot.projectId !== input.project.id) {
    throw validationFailed(
      `execution snapshot ${input.snapshot.id} does not belong to project ${input.project.id}`,
    );
  }
  if (input.workflow && input.workflow.projectId !== input.project.id) {
    throw validationFailed(`workflow instance does not belong to project ${input.project.id}`);
  }
  if (input.workflow && input.workflow.executionSnapshotId !== input.snapshot.id) {
    throw validationFailed("workflow instance must use the project's execution snapshot");
  }
  if (input.task && input.task.projectId !== input.project.id) {
    throw validationFailed(`task does not belong to project ${input.project.id}`);
  }
}
