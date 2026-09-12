import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkflowAuthoringEntry } from "./entry.js";
import {
  AGENT_REPLY_GAP,
  AUTHORING_PATH,
  CHAT_SESSION_PROTOCOL_FROZEN,
  activeAuthoringTurn,
  canCancelAuthoringTurn,
  canCloseAuthoringTurn,
  canRetryAuthoringTurn,
  isUnavailableMessage,
  isWorkflowAuthoringHash,
  resolveAuthoringProjectBinding,
  sessionStatusLabel,
  turnStatusLabel,
  writeCommandOptions,
} from "./model.js";
import { WorkflowAuthoringPage } from "./page.js";

function session() {
  return {
    id: "cas_1",
    projectId: "prj_1",
    protocolVersion: "0.1" as const,
    status: "open" as const,
    messages: [],
    turns: [],
    stateRevision: 1,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
}

describe("workflow authoring chat route", () => {
  it("recognizes only the authoring hash and keeps project binding explicit", () => {
    expect(CHAT_SESSION_PROTOCOL_FROZEN).toBe(true);
    expect(AUTHORING_PATH).toBe("/workflows?authoring=1");
    expect(isWorkflowAuthoringHash("#/workflows?authoring=1")).toBe(true);
    expect(isWorkflowAuthoringHash("#/workflows")).toBe(false);
    expect(resolveAuthoringProjectBinding({}, "#/workflows?authoring=1")).toEqual({
      source: "project-picker",
    });
    expect(
      resolveAuthoringProjectBinding({}, "/workflows?authoring=1&projectId=prj_route"),
    ).toEqual({ projectId: "prj_route", source: "route" });
  });

  it("creates unique command options and preserves the CAS revision", () => {
    const first = writeCommandOptions(7);
    const second = writeCommandOptions(7);
    expect(first.ifMatch).toBe(7);
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.operationId).not.toBe(second.operationId);
  });

  it("maps server states without presenting a fake completed workflow", () => {
    const current = session();
    const turn = {
      id: "cat_1",
      sessionId: current.id,
      protocolVersion: "0.1" as const,
      status: "awaiting_confirmation" as const,
      userMessage: {
        id: "cam_1",
        role: "user" as const,
        content: "创建一个工作流",
        createdAt: current.createdAt,
      },
      refs: {},
      revision: 2,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    };
    const withTurn = { ...current, turns: [turn] };
    expect(activeAuthoringTurn(withTurn)?.status).toBe("awaiting_confirmation");
    expect(turnStatusLabel(turn.status)).toBe("待确认");
    expect(sessionStatusLabel(current.status)).toBe("进行中");
    expect(isUnavailableMessage("[message unavailable after restart]")).toBe(true);
    expect(isUnavailableMessage("创建一个工作流")).toBe(false);
  });

  it("exposes lifecycle controls only for the matching remote Turn state", () => {
    expect(canCancelAuthoringTurn("accepted")).toBe(true);
    expect(canCancelAuthoringTurn("running")).toBe(true);
    expect(canCancelAuthoringTurn("failed")).toBe(false);
    expect(canRetryAuthoringTurn("failed")).toBe(true);
    expect(canRetryAuthoringTurn("cancelled")).toBe(true);
    expect(canRetryAuthoringTurn("running")).toBe(false);
    expect(canCloseAuthoringTurn("awaiting_confirmation")).toBe(true);
    expect(canCloseAuthoringTurn("completed")).toBe(true);
    expect(canCloseAuthoringTurn("running")).toBe(false);
    expect(canCloseAuthoringTurn("closed")).toBe(false);
  });
});

describe("workflow authoring renderer", () => {
  it("offers a real chat entry instead of a disabled Agent button", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowAuthoringEntry, { navigate: () => undefined }),
    );
    expect(html).toContain("workflow-authoring-open");
    expect(html).toContain("Daemon 会话");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Agent send 不可用");
  });

  it("renders a project picker and no localStorage-backed chat", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowAuthoringPage, {
        params: {},
        path: "/workflows?authoring=1",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("workflow-authoring-page");
    expect(html).toContain("workflow-authoring-project-picker");
    expect(html).toContain("workflow-authoring-chat-note");
    expect(html).toContain(AGENT_REPLY_GAP);
    expect(html).not.toContain("localStorage");
    expect(html).not.toContain("追加用户消息");
  });
});
