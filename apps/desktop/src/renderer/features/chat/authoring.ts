import type {
  AuthoringChatProposalDto,
  AuthoringSessionViewDto,
  AuthoringTurnDto,
  DesktopClient,
} from "@workforce/desktop-client";
import {
  parseAuthoringChatProposal,
  parseWorkforceEvent,
  type AuthoringProposalTargetInput,
} from "@workforce/protocol";

import { errorMessage, writeCommandOptions, type LandedWorkflowDraft } from "./model.js";

const POLL_ATTEMPTS = 24;
export const AUTHORING_POLL_MS = 250;

export function isSettledAuthoringTurn(status: AuthoringTurnDto["status"]): boolean {
  return (
    status === "awaiting_confirmation" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "closed"
  );
}

export function lastAuthoringTurn(
  session: Pick<AuthoringSessionViewDto, "turns"> | null | undefined,
): AuthoringTurnDto | undefined {
  return session?.turns.at(-1);
}

export function landedWorkflowDraft(
  session: AuthoringSessionViewDto | null | undefined,
): LandedWorkflowDraft | null {
  const draft = session?.draft;
  if (draft?.kind !== "landed" || draft.unpublished !== true) {
    return null;
  }
  if (draft.workflowDraftId === undefined && draft.workflowId === undefined) {
    return null;
  }
  const landed: LandedWorkflowDraft = { unpublished: true };
  if (draft.workflowDraftId !== undefined) {
    landed.workflowDraftId = draft.workflowDraftId;
  }
  if (draft.workflowId !== undefined) {
    landed.workflowId = draft.workflowId;
  }
  if (draft.revision !== undefined) {
    landed.revision = draft.revision;
  }
  return landed;
}

export function isWorkflowProposalReady(
  session: AuthoringSessionViewDto | null | undefined,
): boolean {
  return isAuthoringProposalReady(session);
}

export function isAuthoringProposalReady(
  session: AuthoringSessionViewDto | null | undefined,
): boolean {
  const turn = lastAuthoringTurn(session);
  return session?.draft?.kind === "proposal" && turn?.status === "awaiting_confirmation";
}

export function proposalHasTaskTarget(
  proposal: AuthoringChatProposalDto | null | undefined,
): boolean {
  return proposal?.targets.some((target) => target.targetType === "task") === true;
}

export function taskTargetsFromProposal(
  proposal: AuthoringChatProposalDto | null | undefined,
): AuthoringProposalTargetInput[] {
  return proposal?.targets.filter((target) => target.targetType === "task") ?? [];
}

export async function loadChatProposalForTurn(
  client: DesktopClient,
  session: AuthoringSessionViewDto,
): Promise<AuthoringChatProposalDto | null> {
  const turn = lastAuthoringTurn(session);
  const runId = turn?.refs.runId;
  if (!runId) {
    return null;
  }
  try {
    const page = await client.listEvents({
      runId,
      types: ["workflow.authoring.chat.proposed"],
      limit: 50,
    });
    const proposalId = proposalIdFromEvents(page.items);
    if (proposalId === undefined) {
      return null;
    }
    return parseAuthoringChatProposal(await client.getAuthoringProposal(session.id, proposalId));
  } catch {
    return null;
  }
}

function proposalIdFromEvents(items: readonly unknown[]): string | undefined {
  for (const item of items) {
    try {
      const event = parseWorkforceEvent(item);
      if (event.type !== "workflow.authoring.chat.proposed") {
        continue;
      }
      if (event.subject.type === "authoring_chat_proposal" && event.subject.id.trim().length > 0) {
        return event.subject.id;
      }
      const fromData = event.data.proposalId;
      if (typeof fromData === "string" && fromData.trim().length > 0) {
        return fromData.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function loadOrCreateAuthoringSession(
  client: DesktopClient,
  projectId: string,
): Promise<AuthoringSessionViewDto> {
  const page = await client.listAuthoringSessions({ projectId, limit: 20 });
  const existing = page.items.find(
    (item) => item.projectId === projectId && item.status === "open",
  );
  if (existing) {
    return client.getAuthoringSession(existing.id);
  }
  return client.createAuthoringSession(projectId, writeCommandOptions());
}

export async function pollAuthoringSession(
  client: DesktopClient,
  sessionId: string,
  projectId: string,
  turnId: string,
  isDone: (status: AuthoringTurnDto["status"]) => boolean = isSettledAuthoringTurn,
): Promise<AuthoringSessionViewDto> {
  let last: AuthoringSessionViewDto | undefined;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const next = await client.getAuthoringSession(sessionId);
    if (next.projectId !== projectId) {
      throw new Error("Daemon 返回了不属于当前项目的作者会话，已拒绝显示。");
    }
    last = next;
    const turn = next.turns.find((item) => item.id === turnId);
    if (turn && isDone(turn.status)) {
      return next;
    }
    await wait(AUTHORING_POLL_MS);
  }
  if (last) {
    return last;
  }
  throw new Error(errorMessage(new Error("作者会话未在时限内进入可确认状态。未发布、未执行。")));
}

export async function sendWorkflowAuthoringMessage(
  client: DesktopClient,
  projectId: string,
  content: string,
): Promise<AuthoringSessionViewDto> {
  const session = await loadOrCreateAuthoringSession(client, projectId);
  if (session.status !== "open") {
    throw new Error(`作者会话不是 open（${session.status}），没有发送，也没有当成已创建流程。`);
  }
  const accepted = await client.sendAuthoringMessage(
    session.id,
    content,
    writeCommandOptions(session.stateRevision),
  );
  return pollAuthoringSession(client, session.id, projectId, accepted.turnId);
}

export async function confirmWorkflowAuthoringTurn(
  client: DesktopClient,
  session: AuthoringSessionViewDto,
): Promise<AuthoringSessionViewDto> {
  const turn = lastAuthoringTurn(session);
  if (!turn || turn.status !== "awaiting_confirmation") {
    throw new Error("当前没有待确认的流程提案。没有把对话画成已创建或已执行。");
  }
  const accepted = await client.confirmAuthoringTurn(
    session.id,
    turn.id,
    writeCommandOptions(turn.revision),
  );
  return pollAuthoringSession(client, session.id, session.projectId, accepted.turnId);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
