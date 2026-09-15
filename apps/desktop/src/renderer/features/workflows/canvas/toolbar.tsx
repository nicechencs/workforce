import type { ReactNode } from "react";

import { Button, Muted, Tooltip } from "../../../components/ui.js";
import type { CanvasNodeKind } from "../graph/types.js";
import { KIND_LABEL, PALETTE_GROUPS } from "./copy.js";
import {
  canMutateCanvas,
  type CanvasAction,
  type CanvasSession,
} from "./model.js";

export function WorkflowCanvasToolbar(props: {
  session: CanvasSession;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  const mutable = canMutateCanvas(props.session);
  return (
    <aside className="wf-canvas-palette" data-testid="workflow-canvas-toolbar">
      <p className="wf-label">节点类型</p>
      <Muted>添加到画布。不是插件商店。</Muted>
      {PALETTE_GROUPS.map((group) => (
        <div key={group.label} className="wf-canvas-palette-group">
          <p className="wf-canvas-palette-group-label">{group.label}</p>
          {group.kinds.map((kind: CanvasNodeKind) => (
            <Button
              key={kind}
              variant="outline"
              size="sm"
              testId={`workflow-canvas-add-${kind}`}
              disabled={!mutable}
              onClick={() => props.dispatch({ type: "addNode", kind })}
            >
              {KIND_LABEL[kind]}
            </Button>
          ))}
        </div>
      ))}
      <div className="wf-canvas-palette-group">
        <p className="wf-canvas-palette-group-label">连线</p>
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
      </div>
      {props.session.connectFrom ? (
        <Muted>再点目标节点完成连线。不会启动 Run。</Muted>
      ) : null}
      {!mutable ? (
        <Tooltip content="已发布版本只读">
          <Muted>已发布版本不可改节点。</Muted>
        </Tooltip>
      ) : null}
    </aside>
  );
}
