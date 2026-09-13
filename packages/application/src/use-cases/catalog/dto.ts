import { protocolVersion } from "@workforce/protocol";
import type {
  TeamDto,
  TeamRoleDto,
  TeamVersionDto,
  WorkerDto,
  WorkerVersionDto,
  WorkflowDto,
  WorkflowVersionDto,
} from "@workforce/protocol";

import type { MemoryCatalog } from "./store.js";
import type {
  TeamDefinitionRecord,
  TeamVersionRecord,
  WorkflowDefinitionRecord,
  WorkflowVersionRecord,
} from "./types.js";

export function workflowVersionDto(record: WorkflowVersionRecord): WorkflowVersionDto {
  const dto: WorkflowVersionDto = {
    id: record.id,
    workflowId: record.workflowId,
    version: record.version,
    status: record.status,
    immutable: record.immutable,
    stateRevision: record.stateRevision,
  };
  if (record.entry !== undefined) {
    dto.entry = record.entry;
  }
  if (record.steps.length > 0) {
    dto.steps = record.steps;
  }
  if (record.nodes.length > 0) {
    dto.nodes = record.nodes;
  }
  if (record.edges.length > 0) {
    dto.edges = record.edges;
  }
  if (record.publishedAt !== undefined) {
    dto.publishedAt = record.publishedAt;
  }
  return dto;
}

export function workflowDto(
  record: WorkflowDefinitionRecord,
  versions: readonly WorkflowVersionRecord[],
): WorkflowDto {
  const dto: WorkflowDto = {
    id: record.id,
    name: record.name,
    description: record.description,
    protocolVersion,
    status: record.status,
    versions: versions.map(workflowVersionDto),
    stateRevision: record.stateRevision,
    definitionRevision: record.definitionRevision,
  };
  if (record.activeVersionId !== undefined) {
    dto.activeVersionId = record.activeVersionId;
  }
  return dto;
}

export function teamVersionDto(record: TeamVersionRecord): TeamVersionDto {
  const dto: TeamVersionDto = {
    id: record.id,
    teamId: record.teamId,
    version: record.version,
    status: record.status,
    immutable: record.immutable,
    members: record.members,
    stateRevision: record.stateRevision,
  };
  if (record.publishedAt !== undefined) {
    dto.publishedAt = record.publishedAt;
  }
  return dto;
}

export function teamRolesFromVersion(version: TeamVersionRecord | undefined): TeamRoleDto[] {
  if (!version) {
    return [];
  }
  return version.members.map((member) => ({
    id: member.id ?? member.role,
    role: member.role,
    version: version.version,
  }));
}

export function teamDto(
  record: TeamDefinitionRecord,
  versions: readonly TeamVersionRecord[],
): TeamDto {
  const active =
    versions.find((item) => item.id === record.activeVersionId) ??
    versions.find((item) => item.status === "published") ??
    versions.at(-1);
  const dto: TeamDto = {
    id: record.id,
    name: record.name,
    version: active?.version ?? "",
    status: record.status,
    protocolVersion,
    roles: teamRolesFromVersion(active),
    versions: versions.map(teamVersionDto),
    stateRevision: record.stateRevision,
    definitionRevision: record.definitionRevision,
  };
  if (record.description.length > 0) {
    dto.description = record.description;
  }
  if (record.activeVersionId !== undefined) {
    dto.activeVersionId = record.activeVersionId;
  }
  return dto;
}

export function workflowDtoFromCatalog(
  catalog: MemoryCatalog,
  record: WorkflowDefinitionRecord,
): WorkflowDto {
  return workflowDto(record, catalog.listWorkflowVersions(record.id));
}

export function teamDtoFromCatalog(catalog: MemoryCatalog, record: TeamDefinitionRecord): TeamDto {
  return teamDto(record, catalog.listTeamVersions(record.id));
}

export function workerVersionDto(record: WorkerVersionDto): WorkerVersionDto {
  return record;
}

export function workerDto(record: WorkerDto, versions: readonly WorkerVersionDto[]): WorkerDto {
  const dto: WorkerDto = {
    id: record.id,
    name: record.name,
    protocolVersion,
    status: record.status,
    versions: versions.map(workerVersionDto),
  };
  if (record.description !== undefined) {
    dto.description = record.description;
  }
  if (record.activeVersionId !== undefined) {
    dto.activeVersionId = record.activeVersionId;
  }
  if (record.stateRevision !== undefined) {
    dto.stateRevision = record.stateRevision;
  }
  if (record.definitionRevision !== undefined) {
    dto.definitionRevision = record.definitionRevision;
  }
  return dto;
}

export function workerDtoFromCatalog(catalog: MemoryCatalog, record: WorkerDto): WorkerDto {
  return workerDto(record, catalog.listWorkerVersions(record.id));
}
