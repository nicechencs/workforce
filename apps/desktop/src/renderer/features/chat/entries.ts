import type {
  AuthoringChatProposalDto,
  ProjectProgressProjectionDto,
  WorkerDto,
} from "@workforce/desktop-client";
import type { ChatNeedContextMissing, WorkerCardFieldName } from "@workforce/protocol";

import type { WorkerProposalWrite } from "./model.js";

export type BusyAction = "classify" | "confirming" | "starting" | null;

export interface UserEntry {
  id: string;
  kind: "user";
  text: string;
}

export interface NeedContextEntry {
  id: string;
  kind: "need_context";
  missing: ChatNeedContextMissing;
  text: string;
}

export interface ClarificationEntry {
  id: string;
  kind: "need_clarification";
  question: string;
}

export interface UnsupportedEntry {
  id: string;
  kind: "unsupported";
  action: "direct" | "im";
  code: "unsupported_capability";
}

export interface CreateWorkerEntry {
  id: string;
  kind: "create_worker";
  summary: string;
  write: WorkerProposalWrite;
  phase: "proposal" | "landed";
  worker?: WorkerDto;
}

export interface UpdateWorkerEntry {
  id: string;
  kind: "update_worker";
  cardField: WorkerCardFieldName;
  workerId: string;
  draftId: string;
  phase: "landed" | "failed";
  forkedFromWorkerVersionId?: string;
  error?: string;
}

export interface InviteTeamEntry {
  id: string;
  kind: "invite_team";
  projectId: string;
  workerVersionId: string;
  phase: "landed" | "failed";
  teamId?: string;
  teamVersionId?: string;
  alreadyMember?: boolean;
  error?: string;
}

export interface CreateWorkflowEntry {
  id: string;
  kind: "create_workflow";
  projectId: string;
  summary: string;
  phase: "proposal" | "landed" | "failed";
  sessionId?: string;
  turnId?: string;
  workflowDraftId?: string;
  workflowId?: string;
  unpublished?: true;
  proposal?: AuthoringChatProposalDto;
  taskId?: string;
  definitionRevision?: number;
  error?: string;
}

export interface StartDirectEntry {
  id: string;
  kind: "start_direct";
  projectId: string;
  phase: "started" | "failed";
  taskId?: string;
  runId?: string;
  runStatus?: string;
  createdAdHocTask?: boolean;
  detail: string;
  error?: string;
}

export interface ProgressEntry {
  id: string;
  kind: "progress";
  projection: ProjectProgressProjectionDto;
}

export interface DiscussEntry {
  id: string;
  kind: "discuss_work";
  projectId: string;
  runId?: string;
  phase: "need_run" | "sent" | "blocked";
  runStatus?: string;
  detail: string;
}

export interface ErrorEntry {
  id: string;
  kind: "error";
  detail: string;
  code?: string;
}

export type ChatEntry =
  | UserEntry
  | NeedContextEntry
  | ClarificationEntry
  | UnsupportedEntry
  | CreateWorkerEntry
  | UpdateWorkerEntry
  | InviteTeamEntry
  | CreateWorkflowEntry
  | StartDirectEntry
  | ProgressEntry
  | DiscussEntry
  | ErrorEntry;
