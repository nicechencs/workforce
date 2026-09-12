import type { CSSProperties } from "react";

import { badgeStyle, buttonStyle, cardStyle, mutedStyle, titleStyle } from "../projects/ui.js";
import {
  AGENT_REPLY_GAP,
  AUTHORING_PATH,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
} from "./model.js";

export function WorkflowAuthoringEntry(props: { navigate: (path: string) => void }) {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-entry">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>对话生成</h2>
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <span style={badgeStyle("muted")}>本机会话 · 仅用户消息</span>
      </div>
      <p style={mutedStyle}>{CHAT_SESSION_GAP}</p>
      <p style={mutedStyle}>{AGENT_REPLY_GAP}</p>
      <p style={mutedStyle}>
        「用对话生成」仍不可用，因为编排 Agent 未接线。打开作者面后，可以追加用户消息到
        Desktop-local 会话；有可落库字段时才会调用已接通的 <code>POST /workflows</code>{" "}
        写入未发布草稿。那不是对话生成成功。
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          data-testid="workflow-authoring-chat-disabled"
          style={buttonStyle("primary", true)}
          disabled
        >
          用对话生成
        </button>
        <button
          type="button"
          data-testid="workflow-authoring-open"
          style={buttonStyle("secondary")}
          onClick={() => props.navigate(AUTHORING_PATH)}
        >
          打开作者面（用户消息 + 结构化落草稿）
        </button>
      </div>
      {CHAT_SESSION_PROTOCOL_FROZEN ? (
        <p data-testid="workflow-authoring-chat-ready">本机用户消息已接线；编排 Agent 仍 planned</p>
      ) : null}
    </section>
  );
}

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--wf-space-sm, 8px)",
  alignItems: "center",
  marginTop: "var(--wf-space-md, 12px)",
};
