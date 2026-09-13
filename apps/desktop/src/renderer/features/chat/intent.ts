import type {
  CapabilitiesDto,
  ChatClassifyInput,
  ChatClassifyResultDto,
  DesktopClient,
} from "@workforce/desktop-client";
import type { ChatIntentDto } from "@workforce/protocol";

import {
  isAuthoringProposalReady,
  lastAuthoringTurn,
  loadChatProposalForTurn,
  sendWorkflowAuthoringMessage,
} from "./authoring.js";
import type {
  ChatEntry,
  CreateWorkflowEntry,
  InviteTeamEntry,
  UpdateWorkerEntry,
} from "./entries.js";
import {
  classifyUnsupportedAction,
  classifiedIntents,
  createWorkerWriteFromIntent,
  DISCUSS_NEEDS_RUN,
  DISCUSS_SENT_NOTE,
  errorMessage,
  isDirectCapabilityReady,
  landIdleWorkerRemark,
  landInviteTeam,
  landStartDirect,
  newChatId,
  START_DIRECT_LANDED_NOTE,
  startDirectIntentFromHanging,
  writeCommandOptions,
} from "./model.js";

export async function classify(
  client: DesktopClient,
  hanging: {
    text: string;
    projectId: string;
    runId: string;
    taskId: string;
    workerId: string;
    workerVersionId: string;
  },
): Promise<ChatClassifyResultDto> {
  const body: ChatClassifyInput = { text: hanging.text };
  if (hanging.projectId) {
    body.projectId = hanging.projectId;
  }
  if (hanging.runId) {
    body.runId = hanging.runId;
  }
  if (hanging.taskId) {
    body.taskId = hanging.taskId;
  }
  if (hanging.workerId) {
    body.workerId = hanging.workerId;
  }
  if (hanging.workerVersionId) {
    body.workerVersionId = hanging.workerVersionId;
  }
  return client.classifyChatIntent(body, writeCommandOptions());
}

export async function dispatchResult(
  client: DesktopClient,
  result: ChatClassifyResultDto,
  text: string,
  capabilities: CapabilitiesDto | null,
  hanging: { projectId: string; taskId: string },
): Promise<ChatEntry[]> {
  const unsupported = classifyUnsupportedAction(result);
  if (result.outcome === "unsupported" && unsupported === "im") {
    return [
      {
        id: newChatId("uns"),
        kind: "unsupported",
        action: "im",
        code: "unsupported_capability",
      },
    ];
  }
  if (result.outcome === "unsupported" && unsupported === "direct") {
    if (!isDirectCapabilityReady(capabilities?.orchestration?.direct)) {
      return [
        {
          id: newChatId("uns"),
          kind: "unsupported",
          action: "direct",
          code: "unsupported_capability",
        },
      ];
    }
    if (!hanging.projectId) {
      return [
        {
          id: newChatId("need"),
          kind: "need_context",
          missing: "projectId",
          text,
        },
      ];
    }
    const hangingIntent: { projectId: string; taskId?: string; title?: string } = {
      projectId: hanging.projectId,
    };
    if (hanging.taskId) {
      hangingIntent.taskId = hanging.taskId;
    }
    if (text.trim().length > 0) {
      hangingIntent.title = text.trim();
    }
    return handleIntent(client, startDirectIntentFromHanging(hangingIntent), text, capabilities);
  }
  if (result.outcome === "need_context") {
    return [
      {
        id: newChatId("need"),
        kind: "need_context",
        missing: result.missing,
        text,
      },
    ];
  }
  if (result.outcome === "need_clarification") {
    return [
      {
        id: newChatId("ask"),
        kind: "need_clarification",
        question: result.question,
      },
    ];
  }
  if (result.outcome !== "intent") {
    return [{ id: newChatId("err"), kind: "error", detail: "分类结果无法识别，没有写入对象。" }];
  }
  const entries: ChatEntry[] = [];
  for (const intent of classifiedIntents(result)) {
    entries.push(...(await handleIntent(client, intent, text, capabilities)));
  }
  return entries;
}

export async function handleIntent(
  client: DesktopClient,
  intent: ChatIntentDto,
  text: string,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  switch (intent.kind) {
    case "create_worker":
      return [
        {
          id: newChatId("wrk"),
          kind: "create_worker",
          summary: intent.summary ?? text,
          write: createWorkerWriteFromIntent(intent, text),
          phase: "proposal",
        },
      ];
    case "update_worker":
      return landUpdateWorkerEntry(client, intent, text);
    case "invite_team":
      return landInviteTeamEntry(client, intent);
    case "create_workflow":
      return startWorkflowAuthoring(client, intent.projectId, intent.summary ?? text);
    case "query_progress": {
      const projection = await client.getProjectProgress(intent.projectId);
      return [{ id: newChatId("prg"), kind: "progress", projection }];
    }
    case "discuss_work":
      return sendDiscussWork(client, intent, text, capabilities);
    case "start_direct":
      return landStartDirectEntry(client, intent, capabilities);
  }
}

async function landStartDirectEntry(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "start_direct" }>,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  if (!isDirectCapabilityReady(capabilities?.orchestration?.direct)) {
    return [
      {
        id: newChatId("uns"),
        kind: "unsupported",
        action: "direct",
        code: "unsupported_capability",
      },
    ];
  }
  try {
    const landed = await landStartDirect(client, intent);
    return [
      {
        id: newChatId("dir"),
        kind: "start_direct",
        projectId: landed.projectId,
        phase: "started",
        taskId: landed.taskId,
        runId: landed.run.id,
        runStatus: landed.run.status,
        createdAdHocTask: landed.createdAdHocTask,
        detail: START_DIRECT_LANDED_NOTE,
      },
    ];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("dir"),
        kind: "start_direct",
        projectId: intent.projectId,
        phase: "failed",
        ...(intent.taskId ? { taskId: intent.taskId } : {}),
        detail: errorMessage(reason),
        error: errorMessage(reason),
      },
    ];
  }
}

async function landUpdateWorkerEntry(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "update_worker" }>,
  text: string,
): Promise<ChatEntry[]> {
  try {
    const landed = await landIdleWorkerRemark(client, intent, text);
    const entry: UpdateWorkerEntry = {
      id: newChatId("upd"),
      kind: "update_worker",
      cardField: landed.cardField,
      workerId: landed.workerId,
      draftId: landed.draft.id,
      phase: "landed",
    };
    if (landed.forkedFromWorkerVersionId !== undefined) {
      entry.forkedFromWorkerVersionId = landed.forkedFromWorkerVersionId;
    }
    return [entry];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("upd"),
        kind: "update_worker",
        cardField: intent.cardField,
        workerId: intent.workerId,
        draftId: intent.workerDraftId ?? "",
        phase: "failed",
        error: errorMessage(reason),
      },
    ];
  }
}

async function landInviteTeamEntry(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "invite_team" }>,
): Promise<ChatEntry[]> {
  try {
    const landed = await landInviteTeam(client, intent);
    const entry: InviteTeamEntry = {
      id: newChatId("inv"),
      kind: "invite_team",
      projectId: landed.projectId,
      workerVersionId: landed.workerVersionId,
      phase: "landed",
      teamId: landed.teamId,
      teamVersionId: landed.teamVersionId,
      alreadyMember: landed.alreadyMember,
    };
    return [entry];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("inv"),
        kind: "invite_team",
        projectId: intent.projectId,
        workerVersionId: intent.workerVersionId,
        phase: "failed",
        error: errorMessage(reason),
      },
    ];
  }
}

async function startWorkflowAuthoring(
  client: DesktopClient,
  projectId: string,
  summary: string,
): Promise<ChatEntry[]> {
  try {
    const session = await sendWorkflowAuthoringMessage(client, projectId, summary);
    const turn = lastAuthoringTurn(session);
    if (!isAuthoringProposalReady(session) || !turn) {
      return [
        {
          id: newChatId("wf"),
          kind: "create_workflow",
          projectId,
          summary,
          phase: "failed",
          sessionId: session.id,
          error: "AuthoringSession 没有进入待确认提案。未发布、未执行。",
        },
      ];
    }
    const proposal = await loadChatProposalForTurn(client, session);
    const entry: CreateWorkflowEntry = {
      id: newChatId("wf"),
      kind: "create_workflow",
      projectId,
      summary,
      phase: "proposal",
      sessionId: session.id,
      turnId: turn.id,
    };
    if (proposal !== null) {
      entry.proposal = proposal;
    }
    return [entry];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("wf"),
        kind: "create_workflow",
        projectId,
        summary,
        phase: "failed",
        error: errorMessage(reason),
      },
    ];
  }
}

async function sendDiscussWork(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "discuss_work" }>,
  text: string,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  if (!intent.runId) {
    return [
      {
        id: newChatId("dsc"),
        kind: "discuss_work",
        projectId: intent.projectId,
        phase: "need_run",
        detail: DISCUSS_NEEDS_RUN,
      },
    ];
  }
  if (capabilities !== null && capabilities.run.input !== true) {
    return [
      {
        id: newChatId("dsc"),
        kind: "discuss_work",
        projectId: intent.projectId,
        runId: intent.runId,
        phase: "blocked",
        detail: "Run input 能力未接通。没有发写，也没有当成已在跑。",
      },
    ];
  }
  const run = await client.sendRunInput(intent.runId, { text }, writeCommandOptions());
  return [
    {
      id: newChatId("dsc"),
      kind: "discuss_work",
      projectId: intent.projectId,
      runId: intent.runId,
      phase: "sent",
      runStatus: run.status,
      detail: DISCUSS_SENT_NOTE,
    },
  ];
}
