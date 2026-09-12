import type {
  TeamDefinitionRecord,
  TeamVersionRecord,
  WorkflowDefinitionRecord,
  WorkflowVersionRecord,
} from "./types.js";

export class MemoryCatalog {
  readonly workflows = new Map<string, WorkflowDefinitionRecord>();
  readonly workflowVersions = new Map<string, WorkflowVersionRecord>();
  readonly teams = new Map<string, TeamDefinitionRecord>();
  readonly teamVersions = new Map<string, TeamVersionRecord>();

  listWorkflows(): WorkflowDefinitionRecord[] {
    return [...this.workflows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listWorkflowVersions(workflowId: string): WorkflowVersionRecord[] {
    return [...this.workflowVersions.values()]
      .filter((item) => item.workflowId === workflowId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  getWorkflowVersion(workflowId: string, versionId: string): WorkflowVersionRecord | undefined {
    const exact = this.workflowVersions.get(versionId);
    if (exact && exact.workflowId === workflowId) {
      return exact;
    }
    return this.listWorkflowVersions(workflowId).find(
      (item) => item.id === versionId || item.version === versionId,
    );
  }

  findWorkflowVersion(versionId: string): WorkflowVersionRecord | undefined {
    const exact = this.workflowVersions.get(versionId);
    if (exact) {
      return exact;
    }
    return [...this.workflowVersions.values()].find(
      (item) => item.id === versionId || item.version === versionId,
    );
  }

  listTeams(): TeamDefinitionRecord[] {
    return [...this.teams.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listTeamVersions(teamId: string): TeamVersionRecord[] {
    return [...this.teamVersions.values()]
      .filter((item) => item.teamId === teamId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  getTeamVersion(teamId: string, versionId: string): TeamVersionRecord | undefined {
    const exact = this.teamVersions.get(versionId);
    if (exact && exact.teamId === teamId) {
      return exact;
    }
    return this.listTeamVersions(teamId).find(
      (item) => item.id === versionId || item.version === versionId,
    );
  }

  findTeamVersion(versionId: string): TeamVersionRecord | undefined {
    const exact = this.teamVersions.get(versionId);
    if (exact) {
      return exact;
    }
    return [...this.teamVersions.values()].find(
      (item) => item.id === versionId || item.version === versionId,
    );
  }
}
