import {
  CatalogService,
  MemoryCatalog,
  teamDtoFromCatalog,
  workflowDtoFromCatalog,
  workflowVersionDto,
  teamVersionDto,
  type CatalogServiceOptions,
} from "@workforce/application";
import type { TeamDto, TeamVersionDto, WorkflowDto, WorkflowVersionDto } from "@workforce/protocol";

import {
  FEATURE_DELIVERY_WORKFLOW,
  SOFTWARE_TEAM,
  findPublishedTeam,
  findPublishedTeamVersion,
  findPublishedWorkflow,
  findPublishedWorkflowVersion,
  isPresetPublishedTeamVersion,
} from "../composition/catalog.js";

export function createAuthoringCatalog(options: Omit<CatalogServiceOptions, "catalog">): {
  store: MemoryCatalog;
  service: CatalogService;
} {
  const store = new MemoryCatalog();
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

export function assertBindableTeamVersionId(service: CatalogService, versionId: string): void {
  if (isPresetPublishedTeamVersion(versionId)) {
    return;
  }
  service.assertBindableTeamVersion(versionId);
}
