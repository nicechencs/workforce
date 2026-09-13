import {
  parseProjectProgressProjection,
  PROJECT_PROGRESS_NO_RECORDS_MESSAGE,
  protocolError,
  type ProjectProgressProjectionDto,
  type ProtocolError,
} from "@workforce/protocol";

import { isBindableTeamVersion, type WorkerVersionBindLookup } from "../catalog/index.js";
import type { AppContext } from "./context.js";
import { invalidTransition, notFound } from "./errors.js";

/** Catalog `isBindableTeamVersion` input. Members ride on the record for WV-APP-LIBRARY. */
export type BindableTeamVersion = Parameters<typeof isBindableTeamVersion>[0];

export interface BindableTeamVersionLookup {
  findTeamVersion(versionId: string): BindableTeamVersion | undefined;
  /** T10 wires catalog worker versions. Absent → member workerVersionId is required but not resolved. */
  findWorkerVersion?: WorkerVersionBindLookup;
}

const EVENT_READ_LIMIT = 10_000;

/**
 * Read-only Chat progress projection. Arrays come only from existing
 * Task / Run / Event / Artifact rows; missing rows stay empty ("还没有记录").
 * Does not write Run/Task status or append Events.
 */
export async function queryProjectProgress(
  ctx: AppContext,
  projectId: string,
): Promise<ProjectProgressProjectionDto> {
  const project = ctx.world.projects.get(projectId);
  if (!project) {
    throw notFound("project", projectId);
  }

  const tasks = ctx.world.tasksForProject(projectId).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    updatedAt: task.updatedAt,
  }));
  const runs = [...ctx.world.runs.values()]
    .filter((run) => run.projectId === projectId)
    .map((run) => ({
      id: run.id,
      taskId: run.taskId,
      status: run.status,
      updatedAt: run.updatedAt,
    }));
  const events = (
    await ctx.world.events.read({
      projectId,
      limit: EVENT_READ_LIMIT,
    })
  ).map((event) => ({
    id: event.id,
    type: event.type,
    time: event.time,
    ...(event.taskId !== undefined ? { taskId: event.taskId } : {}),
    ...(event.runId !== undefined ? { runId: event.runId } : {}),
  }));
  const artifacts = [...ctx.world.artifacts.values()]
    .filter((artifact) => artifact.projectId === projectId)
    .map((artifact) => ({
      id: artifact.artifactVersionId,
      versionId: artifact.artifactVersionId,
      ...(artifact.status !== undefined ? { status: artifact.status } : {}),
    }));

  const empty =
    tasks.length === 0 && runs.length === 0 && events.length === 0 && artifacts.length === 0;

  return parseProjectProgressProjection({
    projectId,
    generatedAt: ctx.world.nowIso(),
    empty,
    tasks,
    runs,
    events,
    artifacts,
    ...(empty ? { emptyDisplay: PROJECT_PROGRESS_NO_RECORDS_MESSAGE } : {}),
  });
}

/**
 * Bind/start-planning guard. Calls catalog `isBindableTeamVersion` (WV-APP-LIBRARY).
 * No lookup → no-op so in-memory tests without a catalog keep working; T10 wires the lookup.
 */
export function bindTeamVersionGuardError(
  versionId: string | undefined,
  lookup: BindableTeamVersionLookup | undefined,
): ProtocolError | undefined {
  if (!lookup || versionId === undefined || versionId.length === 0) {
    return undefined;
  }
  const version = lookup.findTeamVersion(versionId);
  if (!version) {
    return protocolError("not_found", `team version ${versionId} not found`, {
      details: { id: versionId },
    });
  }
  if (!isBindableTeamVersion(version, (id) => lookup.findWorkerVersion?.(id))) {
    return protocolError(
      "invalid_transition",
      "TeamVersion members must reference a published workerVersionId to bind or start planning",
      { details: { teamVersionId: versionId } },
    );
  }
  return undefined;
}

export function assertBindableTeamVersionForPlanning(
  versionId: string | undefined,
  lookup: BindableTeamVersionLookup | undefined,
): void {
  const error = bindTeamVersionGuardError(versionId, lookup);
  if (!error) {
    return;
  }
  if (error.code === "not_found") {
    throw notFound("team version", versionId ?? "");
  }
  throw invalidTransition(error.message, error.details);
}
