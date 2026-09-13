import { ID_PREFIX } from "@workforce/domain";
import { protocolVersion } from "@workforce/protocol";
import type {
  CreateTeamInput,
  CreateTeamVersionInput,
  CreateWorkerInput,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  ForkWorkerVersionAcceptedDto,
  ListWorkersInput,
  PatchTeamInput,
  PatchTeamVersionInput,
  PatchWorkerInput,
  PatchWorkflowInput,
  PatchWorkflowVersionInput,
  TeamMemberDto,
  WorkerCardFieldsDto,
  WorkerDraftDto,
  WorkerDraftWrite,
  WorkerDto,
  WorkerPageDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
} from "@workforce/protocol";

import { sha256CanonicalDigest } from "../authoring/canonical-digest.js";
import type { EnginePort } from "../projects/engine-port.js";
import {
  invalidTransition,
  notFound,
  revisionConflict,
  validationFailed,
} from "../projects/errors.js";
import { assignWorkerCardFields, workerCardFieldsFrom, workerDto } from "./dto.js";
import {
  isBindableTeamVersion,
  isExecutableWorkflowVersion,
  teamMembersHaveSelectableWorkerVersions,
} from "./executable.js";
import { deriveEntryNodeIds, deriveStepsFromGraph, toEngineGraph } from "./graph.js";
import type { MemoryCatalog } from "./store.js";
import type {
  CreatedWorker,
  TeamDefinitionRecord,
  TeamVersionRecord,
  WorkflowDefinitionRecord,
  WorkflowVersionRecord,
} from "./types.js";

export interface CatalogServiceOptions {
  catalog: MemoryCatalog;
  ids: { ulid(prefix: string): string };
  now: () => string;
  validateWorkflowGraph: EnginePort["validateWorkflowGraph"];
  updatedBy?: string;
}

const DEFAULT_WORKER_PAGE_LIMIT = 50;

function nextVersionLabel(existing: { version: string }[]): string {
  const numbers = existing
    .map((item) => Number.parseInt(item.version, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  return String(next);
}

function expectRevision(actual: number, expected: number | undefined, id: string): void {
  if (expected !== undefined && expected !== actual) {
    throw revisionConflict(id, expected, actual);
  }
}

export class CatalogService {
  readonly catalog: MemoryCatalog;

  constructor(private readonly deps: CatalogServiceOptions) {
    this.catalog = deps.catalog;
  }

  listPublishedWorkflows(): WorkflowDefinitionRecord[] {
    return this.deps.catalog.listWorkflows().filter((item) => item.status === "published");
  }

  getWorkflow(id: string): WorkflowDefinitionRecord | undefined {
    return this.deps.catalog.workflows.get(id);
  }

  getWorkflowVersion(workflowId: string, versionId: string): WorkflowVersionRecord | undefined {
    return this.deps.catalog.getWorkflowVersion(workflowId, versionId);
  }

  createWorkflow(input: CreateWorkflowInput): WorkflowDefinitionRecord {
    const now = this.deps.now();
    const record: WorkflowDefinitionRecord = {
      id: this.deps.ids.ulid(ID_PREFIX.workflowDefinition),
      name: input.name.trim(),
      description: input.description ?? "",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (record.name.length === 0) {
      throw validationFailed("workflow name is required");
    }
    this.deps.catalog.workflows.set(record.id, record);
    return record;
  }

  patchWorkflow(
    id: string,
    input: PatchWorkflowInput,
    expectedStateRevision?: number,
  ): WorkflowDefinitionRecord {
    const workflow = this.requireWorkflow(id);
    expectRevision(workflow.stateRevision, expectedStateRevision, id);
    if (workflow.status !== "draft") {
      throw invalidTransition("published workflow metadata is immutable; create a new version");
    }
    if (input.name !== undefined) {
      workflow.name = input.name.trim();
    }
    if (input.description !== undefined) {
      workflow.description = input.description;
    }
    if (workflow.name.length === 0) {
      throw validationFailed("workflow name is required");
    }
    workflow.stateRevision += 1;
    workflow.definitionRevision += 1;
    workflow.updatedAt = this.deps.now();
    return workflow;
  }

  createWorkflowVersion(
    workflowId: string,
    input: CreateWorkflowVersionInput,
    expectedStateRevision?: number,
  ): WorkflowVersionRecord {
    const workflow = this.requireWorkflow(workflowId);
    expectRevision(workflow.stateRevision, expectedStateRevision, workflowId);
    const existing = this.deps.catalog.listWorkflowVersions(workflowId);
    const now = this.deps.now();
    const version: WorkflowVersionRecord = {
      id: this.deps.ids.ulid(ID_PREFIX.workflowVersion),
      workflowId,
      version: input.version ?? nextVersionLabel(existing),
      status: "draft",
      immutable: false,
      stateRevision: 1,
      steps: input.steps ?? [],
      nodes: input.nodes ?? [],
      edges: input.edges ?? [],
      createdAt: now,
      updatedAt: now,
    };
    if (input.entry !== undefined) {
      version.entry = input.entry;
    }
    this.deps.catalog.workflowVersions.set(version.id, version);
    if (workflow.activeVersionId === undefined) {
      workflow.activeVersionId = version.id;
    }
    workflow.stateRevision += 1;
    workflow.definitionRevision += 1;
    workflow.updatedAt = now;
    return version;
  }

  patchWorkflowVersion(
    workflowId: string,
    versionId: string,
    input: PatchWorkflowVersionInput,
    expectedStateRevision?: number,
  ): WorkflowVersionRecord {
    this.requireWorkflow(workflowId);
    const version = this.requireWorkflowVersion(workflowId, versionId);
    expectRevision(version.stateRevision, expectedStateRevision, version.id);
    if (version.immutable || version.status === "published") {
      throw invalidTransition("published WorkflowVersion is immutable; create a new version");
    }
    if (input.version !== undefined) {
      version.version = input.version;
    }
    if (input.entry !== undefined) {
      version.entry = input.entry;
    }
    if (input.steps !== undefined) {
      version.steps = input.steps;
    }
    if (input.nodes !== undefined) {
      version.nodes = input.nodes;
    }
    if (input.edges !== undefined) {
      version.edges = input.edges;
    }
    version.stateRevision += 1;
    version.updatedAt = this.deps.now();
    return version;
  }

  publishWorkflowVersion(
    workflowId: string,
    versionId: string,
    expectedStateRevision?: number,
  ): WorkflowVersionRecord {
    const workflow = this.requireWorkflow(workflowId);
    const version = this.requireWorkflowVersion(workflowId, versionId);
    expectRevision(version.stateRevision, expectedStateRevision, version.id);
    if (version.status === "published" && version.immutable) {
      return version;
    }
    if (version.nodes.length === 0) {
      throw validationFailed("publish requires a finite DAG with nodes");
    }
    const graphInput: Parameters<typeof toEngineGraph>[0] = {
      id: version.id,
      workflowId: version.workflowId,
      versionLabel: version.version,
      nodes: version.nodes,
      edges: version.edges,
    };
    if (version.entry !== undefined) {
      graphInput.entry = version.entry;
    }
    const graph = toEngineGraph(graphInput);
    const dag = this.deps.validateWorkflowGraph(graph);
    if (!dag.ok) {
      throw validationFailed(dag.reason);
    }
    const now = this.deps.now();
    version.status = "published";
    version.immutable = true;
    version.publishedAt = now;
    version.stateRevision += 1;
    version.updatedAt = now;
    const derivedEntry = version.entry ?? deriveEntryNodeIds(version.nodes, version.edges)[0];
    if (derivedEntry !== undefined) {
      version.entry = derivedEntry;
    }
    if (version.steps.length === 0) {
      version.steps = deriveStepsFromGraph(version.nodes);
    }
    workflow.status = "published";
    workflow.activeVersionId = version.id;
    workflow.stateRevision += 1;
    workflow.definitionRevision += 1;
    workflow.updatedAt = now;
    return version;
  }

  assertExecutableWorkflowVersion(workflowId: string, versionId: string): WorkflowVersionRecord {
    const version = this.requireWorkflowVersion(workflowId, versionId);
    if (!isExecutableWorkflowVersion(version)) {
      throw invalidTransition("unpublished workflow version is not executable");
    }
    return version;
  }

  listPublishedTeams(): TeamDefinitionRecord[] {
    return this.deps.catalog.listTeams().filter((item) => item.status === "published");
  }

  getTeam(id: string): TeamDefinitionRecord | undefined {
    return this.deps.catalog.teams.get(id);
  }

  getTeamVersion(teamId: string, versionId: string): TeamVersionRecord | undefined {
    return this.deps.catalog.getTeamVersion(teamId, versionId);
  }

  createTeam(input: CreateTeamInput): TeamDefinitionRecord {
    const now = this.deps.now();
    const record: TeamDefinitionRecord = {
      id: this.deps.ids.ulid(ID_PREFIX.teamDefinition),
      name: input.name.trim(),
      description: input.description ?? "",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (record.name.length === 0) {
      throw validationFailed("team name is required");
    }
    this.deps.catalog.teams.set(record.id, record);
    return record;
  }

  patchTeam(
    id: string,
    input: PatchTeamInput,
    expectedStateRevision?: number,
  ): TeamDefinitionRecord {
    const team = this.requireTeam(id);
    expectRevision(team.stateRevision, expectedStateRevision, id);
    if (team.status !== "draft") {
      throw invalidTransition("published team metadata is immutable; create a new version");
    }
    if (input.name !== undefined) {
      team.name = input.name.trim();
    }
    if (input.description !== undefined) {
      team.description = input.description;
    }
    if (team.name.length === 0) {
      throw validationFailed("team name is required");
    }
    team.stateRevision += 1;
    team.definitionRevision += 1;
    team.updatedAt = this.deps.now();
    return team;
  }

  createTeamVersion(
    teamId: string,
    input: CreateTeamVersionInput,
    expectedStateRevision?: number,
  ): TeamVersionRecord {
    const team = this.requireTeam(teamId);
    expectRevision(team.stateRevision, expectedStateRevision, teamId);
    const existing = this.deps.catalog.listTeamVersions(teamId);
    const now = this.deps.now();
    const version: TeamVersionRecord = {
      id: this.deps.ids.ulid(ID_PREFIX.teamVersion),
      teamId,
      version: input.version ?? nextVersionLabel(existing),
      status: "draft",
      immutable: false,
      stateRevision: 1,
      members: normalizeMembers(input.members, this.deps.ids),
      createdAt: now,
      updatedAt: now,
    };
    this.deps.catalog.teamVersions.set(version.id, version);
    if (team.activeVersionId === undefined) {
      team.activeVersionId = version.id;
    }
    team.stateRevision += 1;
    team.definitionRevision += 1;
    team.updatedAt = now;
    return version;
  }

  patchTeamVersion(
    teamId: string,
    versionId: string,
    input: PatchTeamVersionInput,
    expectedStateRevision?: number,
  ): TeamVersionRecord {
    this.requireTeam(teamId);
    const version = this.requireTeamVersion(teamId, versionId);
    expectRevision(version.stateRevision, expectedStateRevision, version.id);
    if (version.immutable || version.status === "published") {
      throw invalidTransition("published TeamVersion is immutable; create a new version");
    }
    if (input.version !== undefined) {
      version.version = input.version;
    }
    version.members = normalizeMembers(input.members, this.deps.ids);
    version.stateRevision += 1;
    version.updatedAt = this.deps.now();
    return version;
  }

  publishTeamVersion(
    teamId: string,
    versionId: string,
    expectedStateRevision?: number,
  ): TeamVersionRecord {
    const team = this.requireTeam(teamId);
    const version = this.requireTeamVersion(teamId, versionId);
    expectRevision(version.stateRevision, expectedStateRevision, version.id);
    if (version.status === "published" && version.immutable) {
      return version;
    }
    if (version.members.length === 0) {
      throw validationFailed("publish requires at least one team member");
    }
    if (
      !teamMembersHaveSelectableWorkerVersions(version.members, (id) =>
        this.deps.catalog.findWorkerVersion(id),
      )
    ) {
      throw validationFailed(
        "publish requires every member to reference a published, non-archived workerVersionId",
      );
    }
    const now = this.deps.now();
    version.status = "published";
    version.immutable = true;
    version.publishedAt = now;
    version.stateRevision += 1;
    version.updatedAt = now;
    team.status = "published";
    team.activeVersionId = version.id;
    team.stateRevision += 1;
    team.definitionRevision += 1;
    team.updatedAt = now;
    return version;
  }

  assertBindableTeamVersion(versionId: string): TeamVersionRecord {
    const version = this.deps.catalog.findTeamVersion(versionId);
    if (!version) {
      throw notFound("team version", versionId);
    }
    if (!isBindableTeamVersion(version, (id) => this.deps.catalog.findWorkerVersion(id))) {
      throw invalidTransition(
        "TeamVersion cannot bind or start planning unless it is published and every member references a published workerVersionId",
      );
    }
    return version;
  }

  listWorkers(input: ListWorkersInput = {}): WorkerPageDto {
    const includeArchived = input.includeArchived === true;
    const query = input.q?.trim().toLowerCase();
    const limit = input.limit ?? DEFAULT_WORKER_PAGE_LIMIT;
    const matched: WorkerDto[] = [];
    for (const worker of this.deps.catalog.listWorkers()) {
      if (input.status !== undefined && worker.status !== input.status) {
        continue;
      }
      if (input.cursor !== undefined && worker.id <= input.cursor) {
        continue;
      }
      let versions = this.deps.catalog.listWorkerVersions(worker.id);
      if (!includeArchived) {
        versions = versions.filter((item) => item.archived === false);
      }
      const draft = this.deps.catalog.findWorkerDraftByWorker(worker.id);
      if (
        query !== undefined &&
        query.length > 0 &&
        !workerMatchesQuery(worker, versions, draft, query)
      ) {
        continue;
      }
      matched.push(workerDto(worker, versions, draft));
    }
    const items = matched.slice(0, limit);
    const last = items.at(-1);
    const hasMore = matched.length > limit;
    return {
      items,
      page: {
        nextCursor: hasMore && last !== undefined ? last.id : null,
        hasMore,
      },
    };
  }

  getWorker(id: string): WorkerDto | undefined {
    return this.deps.catalog.workers.get(id);
  }

  getWorkerVersion(workerId: string, versionId: string): WorkerVersionDto | undefined {
    return this.deps.catalog.getWorkerVersion(workerId, versionId);
  }

  getWorkerDraft(workerId: string, draftId: string): WorkerDraftDto | undefined {
    const draft = this.deps.catalog.findWorkerDraft(draftId);
    if (!draft || draft.workerId !== workerId) {
      return undefined;
    }
    return draft;
  }

  listWorkerVersionReferences(workerId: string, versionId: string): WorkerVersionReferencesDto {
    const version = this.requireWorkerVersion(workerId, versionId);
    return this.deps.catalog.listWorkerVersionReferences(version.id);
  }

  createWorker(input: CreateWorkerInput): CreatedWorker {
    const name = input.name.trim();
    if (name.length === 0) {
      throw validationFailed("worker name is required");
    }
    const role = input.role?.trim() ?? "";
    if (role.length === 0) {
      throw validationFailed("worker role is required");
    }
    const now = this.deps.now();
    const workerId = this.deps.ids.ulid(ID_PREFIX.worker);
    const draftId = this.deps.ids.ulid(ID_PREFIX.workerDraft);
    const worker: WorkerDto = {
      id: workerId,
      name,
      protocolVersion,
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
    };
    if (input.description !== undefined) {
      worker.description = input.description;
    }
    const draft = this.buildWorkerDraft({
      id: draftId,
      workerId,
      revision: 1,
      name,
      role,
      updatedAt: now,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.runtimeProfileId !== undefined ? { runtimeProfileId: input.runtimeProfileId } : {}),
      ...workerCardFieldsFrom(input),
    });
    this.deps.catalog.workers.set(worker.id, worker);
    this.deps.catalog.workerDrafts.set(draft.id, draft);
    return { worker, draft };
  }

  patchWorker(id: string, input: PatchWorkerInput, expectedStateRevision?: number): WorkerDto {
    const worker = this.requireWorker(id);
    expectRevision(worker.stateRevision ?? 1, expectedStateRevision, id);
    if (worker.status !== "draft") {
      throw invalidTransition("published worker metadata is immutable; fork to create a new draft");
    }
    if (input.name !== undefined) {
      worker.name = input.name.trim();
    }
    if (input.description !== undefined) {
      worker.description = input.description;
    }
    if (worker.name.length === 0) {
      throw validationFailed("worker name is required");
    }
    worker.stateRevision = (worker.stateRevision ?? 1) + 1;
    worker.definitionRevision = (worker.definitionRevision ?? 1) + 1;
    return worker;
  }

  createWorkerDraft(workerId: string, input: WorkerDraftWrite): WorkerDraftDto {
    const worker = this.requireWorker(workerId);
    if (worker.status === "published") {
      throw invalidTransition("published WorkerVersion is immutable; fork to create a new draft");
    }
    const existing = this.deps.catalog.findWorkerDraftByWorker(workerId);
    if (existing) {
      throw invalidTransition("worker already has an open draft");
    }
    const name = input.name?.trim() ?? worker.name;
    const role = input.role?.trim() ?? "";
    if (name.length === 0) {
      throw validationFailed("worker name is required");
    }
    if (role.length === 0) {
      throw validationFailed("worker role is required");
    }
    const description = input.description ?? worker.description;
    const draft = this.buildWorkerDraft({
      id: this.deps.ids.ulid(ID_PREFIX.workerDraft),
      workerId,
      revision: 1,
      name,
      role,
      updatedAt: this.deps.now(),
      ...(description !== undefined ? { description } : {}),
      ...(input.runtimeProfileId !== undefined ? { runtimeProfileId: input.runtimeProfileId } : {}),
      ...workerCardFieldsFrom(input),
    });
    this.deps.catalog.workerDrafts.set(draft.id, draft);
    worker.stateRevision = (worker.stateRevision ?? 1) + 1;
    worker.definitionRevision = (worker.definitionRevision ?? 1) + 1;
    return draft;
  }

  patchWorkerDraft(
    workerId: string,
    draftId: string,
    input: WorkerDraftWrite,
    expectedRevision?: number,
  ): WorkerDraftDto {
    const worker = this.requireWorker(workerId);
    if (worker.status === "published") {
      throw invalidTransition("published WorkerVersion is immutable; fork to create a new draft");
    }
    const draft = this.requireWorkerDraft(workerId, draftId);
    expectRevision(draft.revision, expectedRevision, draft.id);
    if (input.name !== undefined) {
      draft.name = input.name.trim();
    }
    if (input.description !== undefined) {
      draft.description = input.description;
    }
    if (input.role !== undefined) {
      draft.role = input.role.trim();
    }
    if (input.runtimeProfileId !== undefined) {
      draft.runtimeProfileId = input.runtimeProfileId;
    }
    assignWorkerCardFields(draft, input);
    if (draft.name.length === 0) {
      throw validationFailed("worker name is required");
    }
    if (draft.role.length === 0) {
      throw validationFailed("worker role is required");
    }
    draft.revision += 1;
    draft.updatedAt = this.deps.now();
    draft.updatedBy = this.actor();
    draft.contentHash = workerDraftContentHash(draft);
    worker.stateRevision = (worker.stateRevision ?? 1) + 1;
    return draft;
  }

  publishWorkerDraft(
    workerId: string,
    draftId: string,
    expectedRevision?: number,
  ): WorkerVersionDto {
    const worker = this.requireWorker(workerId);
    if (worker.status === "published" && worker.activeVersionId !== undefined) {
      const existing = this.deps.catalog.getWorkerVersion(workerId, worker.activeVersionId);
      if (existing?.immutable) {
        return existing;
      }
    }
    const draft = this.requireWorkerDraft(workerId, draftId);
    expectRevision(draft.revision, expectedRevision, draft.id);
    if (draft.name.length === 0) {
      throw validationFailed("worker name is required");
    }
    if (draft.role.length === 0) {
      throw validationFailed("worker role is required");
    }
    const now = this.deps.now();
    const existing = this.deps.catalog.listWorkerVersions(workerId);
    const version: WorkerVersionDto = {
      id: this.deps.ids.ulid(ID_PREFIX.workerVersion),
      workerId,
      version: nextVersionLabel(existing),
      status: "published",
      immutable: true,
      archived: false,
      name: draft.name,
      role: draft.role,
      stateRevision: 1,
      publishedAt: now,
    };
    if (draft.description !== undefined) {
      version.description = draft.description;
    }
    if (draft.runtimeProfileId !== undefined) {
      version.runtimeProfileId = draft.runtimeProfileId;
    }
    assignWorkerCardFields(version, workerCardFieldsFrom(draft));
    const forkedFrom = this.deps.catalog.workerForkSources.get(workerId);
    if (forkedFrom !== undefined) {
      version.forkedFromWorkerVersionId = forkedFrom;
    }
    this.deps.catalog.workerVersions.set(version.id, version);
    this.deps.catalog.workerDrafts.delete(draft.id);
    worker.status = "published";
    worker.activeVersionId = version.id;
    worker.name = draft.name;
    if (draft.description !== undefined) {
      worker.description = draft.description;
    }
    worker.stateRevision = (worker.stateRevision ?? 1) + 1;
    worker.definitionRevision = (worker.definitionRevision ?? 1) + 1;
    return version;
  }

  archiveWorkerVersion(workerId: string, versionId: string): WorkerVersionDto {
    const worker = this.requireWorker(workerId);
    const version = this.requireWorkerVersion(workerId, versionId);
    if (version.status !== "published" || version.immutable !== true) {
      throw invalidTransition("only a published WorkerVersion can be archived");
    }
    if (version.archived) {
      return version;
    }
    version.archived = true;
    version.archivedAt = this.deps.now();
    version.stateRevision = (version.stateRevision ?? 1) + 1;
    worker.stateRevision = (worker.stateRevision ?? 1) + 1;
    return version;
  }

  forkWorkerVersion(workerId: string, versionId: string): ForkWorkerVersionAcceptedDto {
    const source = this.requireWorkerVersion(workerId, versionId);
    if (source.status !== "published" || source.immutable !== true) {
      throw invalidTransition("only a published WorkerVersion can be forked");
    }
    const created = this.createWorker({
      name: source.name,
      role: source.role,
      ...(source.description !== undefined ? { description: source.description } : {}),
      ...(source.runtimeProfileId !== undefined
        ? { runtimeProfileId: source.runtimeProfileId }
        : {}),
      ...workerCardFieldsFrom(source),
    });
    this.deps.catalog.workerForkSources.set(created.worker.id, source.id);
    return {
      workerId: created.worker.id,
      workerDraftId: created.draft.id,
      forkedFromWorkerVersionId: source.id,
    };
  }

  private actor(): string {
    return this.deps.updatedBy ?? `${ID_PREFIX.principal}catalog`;
  }

  private buildWorkerDraft(
    input: {
      id: string;
      workerId: string;
      revision: number;
      name: string;
      role: string;
      description?: string;
      runtimeProfileId?: string;
      updatedAt: string;
    } & WorkerCardFieldsDto,
  ): WorkerDraftDto {
    const draft: WorkerDraftDto = {
      id: input.id,
      workerId: input.workerId,
      revision: input.revision,
      status: "draft",
      name: input.name,
      role: input.role,
      contentHash: "",
      updatedAt: input.updatedAt,
      updatedBy: this.actor(),
    };
    if (input.description !== undefined) {
      draft.description = input.description;
    }
    if (input.runtimeProfileId !== undefined) {
      draft.runtimeProfileId = input.runtimeProfileId;
    }
    assignWorkerCardFields(draft, input);
    draft.contentHash = workerDraftContentHash(draft);
    return draft;
  }

  private requireWorker(id: string): WorkerDto {
    const worker = this.deps.catalog.workers.get(id);
    if (!worker) {
      throw notFound("worker", id);
    }
    return worker;
  }

  private requireWorkerVersion(workerId: string, versionId: string): WorkerVersionDto {
    const version = this.deps.catalog.getWorkerVersion(workerId, versionId);
    if (!version) {
      throw notFound("worker version", versionId);
    }
    return version;
  }

  private requireWorkerDraft(workerId: string, draftId: string): WorkerDraftDto {
    const draft = this.deps.catalog.findWorkerDraft(draftId);
    if (!draft || draft.workerId !== workerId) {
      throw notFound("worker draft", draftId);
    }
    return draft;
  }

  private requireWorkflow(id: string): WorkflowDefinitionRecord {
    const workflow = this.deps.catalog.workflows.get(id);
    if (!workflow) {
      throw notFound("workflow", id);
    }
    return workflow;
  }

  private requireWorkflowVersion(workflowId: string, versionId: string): WorkflowVersionRecord {
    const version = this.deps.catalog.getWorkflowVersion(workflowId, versionId);
    if (!version) {
      throw notFound("workflow version", versionId);
    }
    return version;
  }

  private requireTeam(id: string): TeamDefinitionRecord {
    const team = this.deps.catalog.teams.get(id);
    if (!team) {
      throw notFound("team", id);
    }
    return team;
  }

  private requireTeamVersion(teamId: string, versionId: string): TeamVersionRecord {
    const version = this.deps.catalog.getTeamVersion(teamId, versionId);
    if (!version) {
      throw notFound("team version", versionId);
    }
    return version;
  }
}

function normalizeMembers(
  members: CreateTeamVersionInput["members"],
  ids: { ulid(prefix: string): string },
): TeamVersionRecord["members"] {
  return members.map((member, index) => {
    const normalized: TeamMemberDto = {
      id: member.id ?? `member_${index + 1}_${ids.ulid("m_").slice(-6)}`,
      role: member.role,
      quantity: member.quantity,
    };
    if (member.workerVersionId !== undefined) {
      normalized.workerVersionId = member.workerVersionId;
    }
    if (member.runtimeProfileId !== undefined) {
      normalized.runtimeProfileId = member.runtimeProfileId;
    }
    return normalized;
  });
}

function workerDraftContentHash(
  draft: Pick<
    WorkerDraftDto,
    "name" | "description" | "role" | "runtimeProfileId" | "who" | "how" | "skills"
  >,
): string {
  return sha256CanonicalDigest({
    name: draft.name,
    role: draft.role,
    ...(draft.description !== undefined ? { description: draft.description } : {}),
    ...(draft.runtimeProfileId !== undefined ? { runtimeProfileId: draft.runtimeProfileId } : {}),
    ...workerCardFieldsFrom(draft),
  });
}

function workerMatchesQuery(
  worker: WorkerDto,
  versions: readonly WorkerVersionDto[],
  draft: WorkerDraftDto | undefined,
  query: string,
): boolean {
  const haystack = [
    worker.name,
    worker.description ?? "",
    draft?.name ?? "",
    draft?.role ?? "",
    draft?.description ?? "",
    draft?.who ?? "",
    draft?.how ?? "",
    draft?.skills ?? "",
    ...versions.flatMap((version) => [
      version.name,
      version.role,
      version.description ?? "",
      version.who ?? "",
      version.how ?? "",
      version.skills ?? "",
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export {
  isBindableTeamVersion,
  isExecutableWorkflowVersion,
  teamMembersHaveSelectableWorkerVersions,
};
