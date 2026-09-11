import type { ReactNode } from "react";

import { CANVAS_NODE_KINDS, type CanvasNodeKind } from "../graph/types.js";
import { buttonStyle, mutedStyle, rowStyle } from "../../projects/ui.js";
import {
  canMutateCanvas,
  publishButtonState,
  saveButtonState,
  type CanvasAction,
  type CanvasSession,
} from "./model.js";

const KIND_LABEL: Record<CanvasNodeKind, string> = {
  task: "任务",
  approval: "审批",
  condition: "条件",
  parallel: "并行",
  delivery: "交付",
};

export function WorkflowCanvasToolbar(props: {
  session: CanvasSession;
  dispatch: (action: CanvasAction) => void;
  onSave: () => void;
  onPublish: () => void;
}): ReactNode {
  const mutable = canMutateCanvas(props.session);
  const save = saveButtonState(props.session);
  const publish = publishButtonState(props.session);
  return (
    <div data-testid="workflow-canvas-toolbar">
      <div style={rowStyle}>
        {CANVAS_NODE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            data-testid={`workflow-canvas-add-${kind}`}
            style={buttonStyle("secondary", !mutable)}
            disabled={!mutable}
            onClick={() => props.dispatch({ type: "addNode", kind })}
          >
            添加{KIND_LABEL[kind]}
          </button>
        ))}
        <button
          type="button"
          data-testid="workflow-canvas-connect"
          style={buttonStyle("secondary", !mutable || !props.session.selectedNodeId)}
          disabled={!mutable || !props.session.selectedNodeId}
          onClick={() => {
            if (props.session.selectedNodeId) {
              props.dispatch({ type: "startConnect", nodeId: props.session.selectedNodeId });
            }
          }}
        >
          {props.session.connectFrom ? "选择目标节点…" : "连接"}
        </button>
        <button
          type="button"
          data-testid="workflow-canvas-delete"
          style={buttonStyle(
            "danger",
            !mutable || (!props.session.selectedNodeId && !props.session.selectedEdgeId),
          )}
          disabled={!mutable || (!props.session.selectedNodeId && !props.session.selectedEdgeId)}
          onClick={() => props.dispatch({ type: "removeSelected" })}
        >
          删除
        </button>
      </div>
      <div style={rowStyle}>
        <button
          type="button"
          data-testid="workflow-canvas-save"
          style={buttonStyle("secondary", save.disabled)}
          disabled={save.disabled}
          title={save.reason ?? "保存未发布草稿"}
          onClick={props.onSave}
        >
          保存草稿
        </button>
        <button
          type="button"
          data-testid="workflow-canvas-publish"
          style={buttonStyle("primary", publish.disabled)}
          disabled={publish.disabled}
          title={publish.reason ?? "发布不可变版本"}
          onClick={props.onPublish}
        >
          发布
        </button>
      </div>
      {save.reason ? (
        <p style={mutedStyle} data-testid="workflow-canvas-save-reason">
          {save.reason}
        </p>
      ) : null}
      {publish.reason && publish.reason !== save.reason ? (
        <p style={mutedStyle} data-testid="workflow-canvas-publish-reason">
          {publish.reason}
        </p>
      ) : null}
    </div>
  );
}
