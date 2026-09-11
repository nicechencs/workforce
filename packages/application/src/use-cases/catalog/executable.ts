import {
  isBindableTeamVersion as protocolBindableTeam,
  isExecutableWorkflowVersion as protocolExecutableWorkflow,
} from "@workforce/protocol";

import type { TeamVersionRecord, WorkflowVersionRecord } from "./types.js";

export function isExecutableWorkflowVersion(
  version: Pick<WorkflowVersionRecord, "status" | "immutable">,
): boolean {
  return protocolExecutableWorkflow(version);
}

export function isBindableTeamVersion(
  version: Pick<TeamVersionRecord, "status" | "immutable">,
): boolean {
  return protocolBindableTeam(version);
}
