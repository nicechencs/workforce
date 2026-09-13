import {
  isBindableTeamVersion as protocolBindableTeam,
  isPublishedWorkerVersion,
  isSelectableWorkerVersion,
  teamMemberHasWorkerVersionId,
  isExecutableWorkflowVersion as protocolExecutableWorkflow,
} from "@workforce/protocol";
import type { TeamMemberDto, WorkerVersionDto } from "@workforce/protocol";

import type { TeamVersionRecord, WorkflowVersionRecord } from "./types.js";

export type WorkerVersionBindLookup = (
  workerVersionId: string,
) => Pick<WorkerVersionDto, "status" | "immutable" | "archived"> | undefined;

export function isExecutableWorkflowVersion(
  version: Pick<WorkflowVersionRecord, "status" | "immutable">,
): boolean {
  return protocolExecutableWorkflow(version);
}

/**
 * New Team publish/select requires a published, non-archived WorkerVersion.
 * Existing TeamVersion references stay valid after archive.
 */
export function teamMembersHaveSelectableWorkerVersions(
  members: readonly TeamMemberDto[],
  resolveWorkerVersion: WorkerVersionBindLookup,
): boolean {
  if (members.length === 0) {
    return false;
  }
  return members.every((member) => {
    if (!teamMemberHasWorkerVersionId(member)) {
      return false;
    }
    const worker = resolveWorkerVersion(member.workerVersionId);
    return worker !== undefined && isSelectableWorkerVersion(worker);
  });
}

export function isBindableTeamVersion(
  version: Pick<TeamVersionRecord, "status" | "immutable" | "members">,
  resolveWorkerVersion: WorkerVersionBindLookup,
): boolean {
  if (!protocolBindableTeam(version) || version.members.length === 0) {
    return false;
  }
  return version.members.every((member) => {
    if (!teamMemberHasWorkerVersionId(member)) {
      return false;
    }
    const worker = resolveWorkerVersion(member.workerVersionId);
    return worker !== undefined && isPublishedWorkerVersion(worker);
  });
}
