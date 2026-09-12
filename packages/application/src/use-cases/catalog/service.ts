import { ID_PREFIX } from "@workforce/domain";
import type {
  CreateTeamInput,
  CreateTeamVersionInput,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  PatchTeamInput,
  PatchTeamVersionInput,
  PatchWorkflowInput,
  PatchWorkflowVersionInput,
} from "@workforce/protocol";

import type { EnginePort } from "../projects/engine-port.js";
import {
  invalidTransition,
  notFound,
  revisionConflict,
  validationFailed,
} from "../projects/errors.js";
import { isBindableTeamVersion, isExecutableWorkflowVersion } from "./executable.js";
import { deriveEntryNodeIds, deriveStepsFromGraph, toEngineGraph } from "./graph.js";
import type { MemoryCatalog } from "./store.js";
import type {
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
}

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
    if (!isBindableTeamVersion(version)) {
      throw invalidTransition("unpublished TeamVersion cannot bind or start planning");
    }
    return version;
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
  return members.map((member, index) => ({
    id: member.id ?? `member_${index + 1}_${ids.ulid("m_").slice(-6)}`,
    role: member.role,
    runtimeProfileId: member.runtimeProfileId,
    quantity: member.quantity,
  }));
}

export { isBindableTeamVersion, isExecutableWorkflowVersion };
