import { useReducer, type FormEvent, type ReactNode } from "react";

import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  mutedStyle,
  pageStyle,
  titleStyle,
  warningStyle,
} from "../projects/ui.js";
import {
  emptyAuthoringModel,
  landUnpublishedDraft,
  reduceAuthoring,
  type AuthoringFormField,
  type LandedDraft,
} from "./model.js";

export function WorkflowAuthoringPage(props: FeaturePageProps): ReactNode {
  const client = useWorkforceClient();
  const [model, dispatch] = useReducer(reduceAuthoring, undefined, emptyAuthoringModel);

  async function onLandDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const intentEl = event.currentTarget.ownerDocument.getElementById("wf-authoring-intent");
    const intentText =
      intentEl instanceof HTMLTextAreaElement ? intentEl.value : model.form.intentText;
    const form = {
      ...model.form,
      name: String(data.get("name") ?? model.form.name),
      description: String(data.get("description") ?? model.form.description),
      rolesText: String(data.get("roles") ?? model.form.rolesText),
      stepsText: String(data.get("steps") ?? model.form.stepsText),
      teamName: String(data.get("teamName") ?? model.form.teamName),
      intentText,
    };
    const submitted = reduceAuthoring(reduceAuthoring(model, { type: "hydrate", form }), {
      type: "submitDraft",
    });
    dispatch({ type: "hydrate", form });
    dispatch({ type: "submitDraft" });
    if (submitted.phase !== "submitting") {
      return;
    }
    try {
      const draft = await landUnpublishedDraft(client, submitted.form);
      dispatch({ type: "landed", draft });
    } catch (error) {
      dispatch({ type: "failure", error });
    }
  }

  return (
    <main style={pageStyle} data-testid="workflow-authoring-page">
      <p>
        <button
          type="button"
          style={buttonStyle("secondary")}
          onClick={() => props.navigate("/workflows")}
        >
          返回工作流目录
        </button>
      </p>
      <h1 style={titleStyle}>对话生成工作流</h1>
      <p style={mutedStyle}>{model.note}</p>
      <p style={mutedStyle} data-testid="workflow-authoring-route-gap">
        {model.routeGap}
      </p>
      <ConversationPanel
        explanation={model.chat.explanation}
        intentText={model.form.intentText}
        submitting={model.phase === "submitting"}
        onIntentChange={(value) => dispatch({ type: "change", field: "intentText", value })}
        onSubmitChat={() => dispatch({ type: "submitChat" })}
      />
      <StructuredDraftForm
        model={model}
        onChange={(field, value) => dispatch({ type: "change", field, value })}
        onSubmit={onLandDraft}
      />
      {model.error ? (
        <div
          style={model.phase === "empty_intent" ? warningStyle : errorStyle}
          data-testid="workflow-authoring-error"
        >
          {model.error}
        </div>
      ) : null}
      {model.draft ? <LandedDraftCard draft={model.draft} navigate={props.navigate} /> : null}
    </main>
  );
}

function ConversationPanel(props: {
  explanation: string;
  intentText: string;
  submitting: boolean;
  onIntentChange: (value: string) => void;
  onSubmitChat: () => void;
}): ReactNode {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-chat">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>编排对话</h2>
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <span style={badgeStyle("muted")}>不可发送</span>
      </div>
      <p style={mutedStyle}>{props.explanation}</p>
      <label style={labelStyle} htmlFor="wf-authoring-intent">
        意图（保留，不发送）
      </label>
      <textarea
        id="wf-authoring-intent"
        data-testid="workflow-authoring-intent"
        style={{ ...inputStyle, minHeight: "96px" }}
        value={props.intentText}
        onChange={(event) => props.onIntentChange(event.target.value)}
        placeholder="例如：创建 planner 与 developer，跑功能交付，审查后再验收。"
      />
      <button
        type="button"
        data-testid="workflow-authoring-send-chat"
        style={buttonStyle("primary", true)}
        disabled
        onClick={props.onSubmitChat}
      >
        发送给编排 Agent
      </button>
      <p style={mutedStyle} data-testid="workflow-authoring-chat-empty">
        没有 Agent 回复。未冻结会话协议前，这里不会出现生成成功的对话气泡。
      </p>
    </section>
  );
}

function StructuredDraftForm(props: {
  model: ReturnType<typeof emptyAuthoringModel>;
  onChange: (field: AuthoringFormField, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): ReactNode {
  const disabled = props.model.phase === "submitting";
  return (
    <section style={cardStyle} data-testid="workflow-authoring-structured">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>结构化落草稿</h2>
      <p style={mutedStyle}>
        以下字段直接映射到已接通的 M7 写接口，不经过对话
        endpoint。写入后仍是草稿，不会发布，也不会开始规划。
      </p>
      <form onSubmit={props.onSubmit}>
        <label style={labelStyle} htmlFor="wf-authoring-name">
          工作流名称
        </label>
        <input
          id="wf-authoring-name"
          data-testid="workflow-authoring-name"
          name="name"
          style={inputStyle}
          value={props.model.form.name}
          disabled={disabled}
          onChange={(event) => props.onChange("name", event.target.value)}
        />
        <label style={labelStyle} htmlFor="wf-authoring-description">
          说明
        </label>
        <textarea
          id="wf-authoring-description"
          data-testid="workflow-authoring-description"
          name="description"
          style={{ ...inputStyle, minHeight: "64px" }}
          value={props.model.form.description}
          disabled={disabled}
          onChange={(event) => props.onChange("description", event.target.value)}
        />
        <label style={labelStyle} htmlFor="wf-authoring-roles">
          角色（每行一个，可选）
        </label>
        <textarea
          id="wf-authoring-roles"
          data-testid="workflow-authoring-roles"
          name="roles"
          style={{ ...inputStyle, minHeight: "64px" }}
          value={props.model.form.rolesText}
          disabled={disabled}
          placeholder={"planner\ndeveloper"}
          onChange={(event) => props.onChange("rolesText", event.target.value)}
        />
        <label style={labelStyle} htmlFor="wf-authoring-steps">
          步骤（每行一个，可选）
        </label>
        <textarea
          id="wf-authoring-steps"
          data-testid="workflow-authoring-steps"
          name="steps"
          style={{ ...inputStyle, minHeight: "64px" }}
          value={props.model.form.stepsText}
          disabled={disabled}
          placeholder={"规划\n实现"}
          onChange={(event) => props.onChange("stepsText", event.target.value)}
        />
        <label style={labelStyle} htmlFor="wf-authoring-team">
          可选 Team 名称（只创建未发布 Team 定义，不编造 runtimeProfile）
        </label>
        <input
          id="wf-authoring-team"
          data-testid="workflow-authoring-team"
          name="teamName"
          style={inputStyle}
          value={props.model.form.teamName}
          disabled={disabled}
          onChange={(event) => props.onChange("teamName", event.target.value)}
        />
        <button
          type="submit"
          data-testid="workflow-authoring-land-draft"
          style={buttonStyle("secondary", disabled)}
          disabled={disabled}
        >
          {disabled ? "正在写入未发布草稿…" : "写入未发布草稿"}
        </button>
      </form>
    </section>
  );
}

function LandedDraftCard(props: {
  draft: LandedDraft;
  navigate: (path: string) => void;
}): ReactNode {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-landed">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>未发布草稿已写入</h2>
      <p data-testid="workflow-authoring-landed-note">
        已用 <code>POST /workflows</code> 与 version 写接口保存<strong>未发布</strong>
        草稿。这不是对话生成成功，也不是 Task/Run 完成，更不能执行。
      </p>
      <p style={mutedStyle} data-testid="workflow-authoring-workflow-id">
        {props.draft.workflowName} · {props.draft.workflowId} · 版本 {props.draft.versionId} ·{" "}
        {props.draft.status}
      </p>
      {props.draft.teamId ? (
        <p style={mutedStyle} data-testid="workflow-authoring-team-id">
          可选 Team 草稿 {props.draft.teamId}（未发布，不能 bind 开始规划）
        </p>
      ) : null}
      {props.draft.teamWarning ? (
        <p style={warningStyle} data-testid="workflow-authoring-team-warning">
          {props.draft.teamWarning}
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--wf-space-sm, 8px)" }}>
        <button
          type="button"
          data-testid="workflow-authoring-open-catalog"
          style={buttonStyle("primary")}
          onClick={() => props.navigate(props.draft.catalogHref)}
        >
          查看目录中的草稿
        </button>
        <button
          type="button"
          data-testid="workflow-authoring-open-canvas"
          style={buttonStyle("secondary", !props.draft.canvas.available)}
          disabled={!props.draft.canvas.available}
          title={props.draft.canvas.reason}
          onClick={() => {
            if (props.draft.canvas.available) {
              props.navigate(props.draft.canvas.href);
            }
          }}
        >
          在画布中编辑
        </button>
      </div>
      <p style={mutedStyle} data-testid="workflow-authoring-canvas-gap">
        {props.draft.canvas.reason}
      </p>
    </section>
  );
}
