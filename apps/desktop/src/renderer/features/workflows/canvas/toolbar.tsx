import type { ReactNode } from "react";

import { Button, Cluster, Muted, Tooltip } from "../../../components/ui.js";
import { CANVAS_NODE_KINDS, type CanvasNodeKind } from "../graph/types.js";
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
      <Cluster>
        {CANVAS_NODE_KINDS.map((kind) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            testId={`workflow-canvas-add-${kind}`}
            disabled={!mutable}
            onClick={() => props.dispatch({ type: "addNode", kind })}
          >
            添加{KIND_LABEL[kind]}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          testId="workflow-canvas-connect"
          disabled={!mutable || !props.session.selectedNodeId}
          onClick={() => {
            if (props.session.selectedNodeId) {
              props.dispatch({ type: "startConnect", nodeId: props.session.selectedNodeId });
            }
          }}
        >
          {props.session.connectFrom ? "选择目标节点…" : "连接"}
        </Button>
        <Button
          variant="dangerOutline"
          size="sm"
          testId="workflow-canvas-delete"
          disabled={!mutable || (!props.session.selectedNodeId && !props.session.selectedEdgeId)}
          onClick={() => props.dispatch({ type: "removeSelected" })}
        >
          删除
        </Button>
      </Cluster>
      <Cluster>
        <Tooltip content={save.reason ?? "保存未发布草稿"}>
          <Button
            testId="workflow-canvas-save"
            disabled={save.disabled}
            title={save.reason ?? "保存未发布草稿"}
            onClick={props.onSave}
          >
            保存草稿
          </Button>
        </Tooltip>
        <Tooltip content={publish.reason ?? "发布不可变版本"}>
          <Button
            variant="primary"
            testId="workflow-canvas-publish"
            disabled={publish.disabled}
            title={publish.reason ?? "发布不可变版本"}
            onClick={props.onPublish}
          >
            发布
          </Button>
        </Tooltip>
      </Cluster>
      {save.reason ? (
        <Muted>
          <span data-testid="workflow-canvas-save-reason">{save.reason}</span>
        </Muted>
      ) : null}
      {publish.reason && publish.reason !== save.reason ? (
        <Muted>
          <span data-testid="workflow-canvas-publish-reason">{publish.reason}</span>
        </Muted>
      ) : null}
    </div>
  );
}
