import type {
  WorkerDraftDto,
  WorkerDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
  WorkerVersionTeamReferenceDto,
} from "@workforce/protocol";

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
  readonly workers = new Map<string, WorkerDto>();
  readonly workerVersions = new Map<string, WorkerVersionDto>();
  readonly workerDrafts = new Map<string, WorkerDraftDto>();
  /** workerId → source WorkerVersion id; copied onto the published fork. */
  readonly workerForkSources = new Map<string, string>();

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

  listWorkers(): WorkerDto[] {
    return [...this.workers.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listWorkerVersions(workerId: string): WorkerVersionDto[] {
    return [...this.workerVersions.values()]
      .filter((item) => item.workerId === workerId)
      .sort(
        (a, b) =>
          (a.publishedAt ?? a.id).localeCompare(b.publishedAt ?? b.id) || a.id.localeCompare(b.id),
      );
  }

  getWorkerVersion(workerId: string, versionId: string): WorkerVersionDto | undefined {
    const exact = this.workerVersions.get(versionId);
    if (exact && exact.workerId === workerId) {
      return exact;
    }
    return this.listWorkerVersions(workerId).find(
      (item) => item.id === versionId || item.version === versionId,
    );
  }

  findWorkerVersion(versionId: string): WorkerVersionDto | undefined {
    return this.workerVersions.get(versionId);
  }

  findWorkerDraft(draftId: string): WorkerDraftDto | undefined {
    return this.workerDrafts.get(draftId);
  }

  findWorkerDraftByWorker(workerId: string): WorkerDraftDto | undefined {
    return [...this.workerDrafts.values()].find((item) => item.workerId === workerId);
  }

  listWorkerVersionReferences(workerVersionId: string): WorkerVersionReferencesDto {
    const teamVersions: WorkerVersionTeamReferenceDto[] = [];
    for (const version of this.teamVersions.values()) {
      const referenced = version.members.some(
        (member) => member.workerVersionId === workerVersionId,
      );
      if (!referenced) {
        continue;
      }
      teamVersions.push({
        teamId: version.teamId,
        teamVersionId: version.id,
        status: version.status,
      });
    }
    teamVersions.sort((a, b) => a.teamVersionId.localeCompare(b.teamVersionId));
    return { workerVersionId, teamVersions };
  }
}
