import type { CSSProperties } from "react";

import { badgeStyle, buttonStyle, cardStyle, mutedStyle, titleStyle } from "../projects/ui.js";
import { AUTHORING_PATH, CHAT_SESSION_GAP, CHAT_SESSION_PROTOCOL_FROZEN } from "./model.js";

export function WorkflowAuthoringEntry(props: { navigate: (path: string) => void }) {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-entry">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>对话生成</h2>
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <span style={badgeStyle("muted")}>会话协议未冻结</span>
      </div>
      <p style={mutedStyle}>{CHAT_SESSION_GAP}</p>
      <p style={mutedStyle}>
        「发送给编排 Agent」不可用。打开作者面后，只有你已填写可落库字段时，才会调用已接通的{" "}
        <code>POST /workflows</code> 写入未发布草稿；那不是对话生成成功。
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
          打开作者面（结构化落草稿）
        </button>
      </div>
      {CHAT_SESSION_PROTOCOL_FROZEN ? (
        <p data-testid="workflow-authoring-chat-ready">会话已接通</p>
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
