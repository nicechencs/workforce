import type { CSSProperties } from "react";

import { badgeStyle, buttonStyle, cardStyle, mutedStyle, titleStyle } from "../projects/ui.js";
import { AUTHORING_PATH, CHAT_SESSION_GAP } from "./model.js";

export function WorkflowAuthoringEntry(props: { navigate: (path: string) => void }) {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-entry">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>对话生成工作流</h2>
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <span style={badgeStyle("muted")}>Daemon 会话 · 项目范围</span>
      </div>
      <p style={mutedStyle}>{CHAT_SESSION_GAP}</p>
      <p style={mutedStyle}>
        在聊天中描述工作流，等待结构化提案后由你确认。确认只会创建未发布草稿，不会自动发布或执行。
      </p>
      <div style={rowStyle}>
        <button
          type="button"
          data-testid="workflow-authoring-open"
          style={buttonStyle("primary")}
          onClick={() => props.navigate(AUTHORING_PATH)}
        >
          打开工作流作者面
        </button>
      </div>
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
