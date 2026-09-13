import {
  CatalogService,
  MemoryCatalog,
  UseCaseError,
  isBindableTeamVersion,
  teamDtoFromCatalog,
  workerDtoFromCatalog,
  workflowDtoFromCatalog,
  workflowVersionDto,
  teamVersionDto,
  type CatalogServiceOptions,
} from "@workforce/application";
import type {
  ListWorkersInput,
  TeamDto,
  TeamVersionDto,
  WorkerDraftDto,
  WorkerDto,
  WorkerPageDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
  WorkflowDto,
  WorkflowVersionDto,
} from "@workforce/protocol";

import {
  FEATURE_DELIVERY_WORKFLOW,
  SOFTWARE_TEAM,
  SOFTWARE_TEAM_VERSION,
  TEAM_ID,
  TEAM_VERSION_ID,
  findPublishedTeam,
  findPublishedTeamVersion,
  findPublishedWorker,
  findPublishedWorkerVersion,
  findPublishedWorkflow,
  findPublishedWorkflowVersion,
  isPresetPublishedTeamVersion,
  seedPresetWorkerLibrary,
} from "../composition/catalog.js";

export function createAuthoringCatalog(options: Omit<CatalogServiceOptions, "catalog">): {
  store: MemoryCatalog;
  service: CatalogService;
} {
  const store = new MemoryCatalog();
  seedPresetWorkerLibrary(store);
  return { store, service: new CatalogService({ ...options, catalog: store }) };
}

export function listedWorkflows(service: CatalogService): WorkflowDto[] {
  const custom = service
    .listPublishedWorkflows()
    .map((record) => workflowDtoFromCatalog(service.catalog, record));
  return [FEATURE_DELIVERY_WORKFLOW, ...custom];
}

export function resolveWorkflow(service: CatalogService, id: string): WorkflowDto | null {
  const seeded = findPublishedWorkflow(id);
  if (seeded) {
    return seeded;
  }
  const record = service.getWorkflow(id);
  return record ? workflowDtoFromCatalog(service.catalog, record) : null;
}

export function resolveWorkflowVersion(
  service: CatalogService,
  id: string,
  versionId: string,
): WorkflowVersionDto | null {
  const seeded = findPublishedWorkflowVersion(id, versionId);
  if (seeded) {
    return seeded;
  }
  const record = service.getWorkflowVersion(id, versionId);
  return record ? workflowVersionDto(record) : null;
}

export function listedTeams(service: CatalogService): TeamDto[] {
  const custom = service
    .listPublishedTeams()
    .map((record) => teamDtoFromCatalog(service.catalog, record));
  return [SOFTWARE_TEAM, ...custom];
}

export function listedDraftTeams(service: CatalogService): TeamDto[] {
  return service.catalog
    .listTeams()
    .filter((item) => item.status === "draft")
    .map((record) => teamDtoFromCatalog(service.catalog, record));
}

export function resolveTeam(service: CatalogService, id: string): TeamDto | null {
  const seeded = findPublishedTeam(id);
  if (seeded) {
    return seeded;
  }
  const record = service.getTeam(id);
  return record ? teamDtoFromCatalog(service.catalog, record) : null;
}

export function resolveTeamVersion(
  service: CatalogService,
  id: string,
  versionId: string,
): TeamVersionDto | null {
  const seeded = findPublishedTeamVersion(id, versionId);
  if (seeded) {
    return seeded;
  }
  const record = service.getTeamVersion(id, versionId);
  return record ? teamVersionDto(record) : null;
}

export function listedWorkers(
  service: CatalogService,
  input: ListWorkersInput = {},
): WorkerPageDto {
  return service.listWorkers(input);
}

export function resolveWorker(service: CatalogService, id: string): WorkerDto | null {
  const seeded = findPublishedWorker(id);
  if (seeded) {
    return seeded;
  }
  const record = service.getWorker(id);
  return record ? workerDtoFromCatalog(service.catalog, record) : null;
}

export function resolveWorkerVersion(
  service: CatalogService,
  id: string,
  versionId: string,
): WorkerVersionDto | null {
  const seeded = findPublishedWorkerVersion(id, versionId);
  if (seeded) {
    return seeded;
  }
  return service.getWorkerVersion(id, versionId) ?? null;
}

export function resolveWorkerDraft(
  service: CatalogService,
  workerId: string,
  draftId: string,
): WorkerDraftDto | null {
  return service.getWorkerDraft(workerId, draftId) ?? null;
}

export function resolveWorkerVersionReferences(
  service: CatalogService,
  workerId: string,
  versionId: string,
): WorkerVersionReferencesDto | null {
  const version = resolveWorkerVersion(service, workerId, versionId);
  if (!version) {
    return null;
  }
  const fromCatalog = service.listWorkerVersionReferences(workerId, version.id);
  const presetHit = SOFTWARE_TEAM_VERSION.members.some(
    (member) => member.workerVersionId === version.id,
  );
  if (!presetHit) {
    return fromCatalog;
  }
  const seen = new Set(fromCatalog.teamVersions.map((item) => item.teamVersionId));
  if (seen.has(TEAM_VERSION_ID)) {
    return fromCatalog;
  }
  return {
    workerVersionId: version.id,
    teamVersions: [
      ...fromCatalog.teamVersions,
      { teamId: TEAM_ID, teamVersionId: TEAM_VERSION_ID, status: "published" },
    ],
  };
}

export function assertBindableTeamVersionId(service: CatalogService, versionId: string): void {
  if (isPresetPublishedTeamVersion(versionId)) {
    if (
      !isBindableTeamVersion(SOFTWARE_TEAM_VERSION, (id) => service.catalog.findWorkerVersion(id))
    ) {
      throw new UseCaseError(
        "invalid_transition",
        "TeamVersion cannot bind or start planning unless it is published and every member references a published workerVersionId",
      );
    }
    return;
  }
  service.assertBindableTeamVersion(versionId);
}

/**
 * Chat language-entry classification lives in Application. Daemon only
 * re-exports it: no second keyword detector, no IM inbox, not completion.
 */
export { classifyChatIntent, type ChatClassifyContext } from "@workforce/application";
