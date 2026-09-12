import type { CSSProperties, ReactNode } from "react";

import {
  JOIN_POLICIES,
  UPSTREAM_WAITS,
  WORKER_ROLES,
  WORKFLOW_GATES,
  type CanvasJoinPolicy,
  type CanvasNode,
  type CanvasUpstreamWait,
  type CanvasWorkerRole,
} from "../graph/types.js";
import { inputStyle, labelStyle, mutedStyle } from "../../projects/ui.js";
import type { CanvasAction, CanvasSession } from "./model.js";

const box: CSSProperties = {
  minWidth: 260,
  maxWidth: 320,
};

export function WorkflowCanvasInspector(props: {
  session: CanvasSession;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  const { session } = props;
  const node = session.draft.graph.nodes.find((item) => item.id === session.selectedNodeId) ?? null;
  const edge = session.draft.graph.edges.find((item) => item.id === session.selectedEdgeId) ?? null;
  const frozen = session.mode === "readonly-frozen";

  if (!node && !edge) {
    return (
      <aside style={box} data-testid="workflow-canvas-inspector">
        <p style={mutedStyle}>选中节点或边以编辑属性。画布只编排未发布草稿。</p>
      </aside>
    );
  }

  if (edge) {
    return (
      <aside style={box} data-testid="workflow-canvas-inspector">
        <p style={labelStyle}>边 {edge.id}</p>
        <p style={mutedStyle}>
          {edge.from} → {edge.to}
        </p>
        <label style={labelStyle} htmlFor="wf-edge-wait">
          上游等待
        </label>
        <select
          id="wf-edge-wait"
          style={inputStyle}
          disabled={frozen}
          value={edge.waitFor ?? "outputs_ready"}
          onChange={(event) => {
            const waitFor = event.target.value as CanvasUpstreamWait;
            if (!(UPSTREAM_WAITS as readonly string[]).includes(waitFor)) {
              return;
            }
            props.dispatch({
              type: "updateEdge",
              edgeId: edge.id,
              patch: { waitFor },
            });
          }}
        >
          {UPSTREAM_WAITS.map((wait) => (
            <option key={wait} value={wait}>
              {wait}
            </option>
          ))}
        </select>
      </aside>
    );
  }

  if (!node) {
    return null;
  }

  return (
    <aside style={box} data-testid="workflow-canvas-inspector">
      <p style={labelStyle}>节点 {node.id}</p>
      <label style={labelStyle} htmlFor="wf-node-title">
        标题
      </label>
      <input
        id="wf-node-title"
        style={inputStyle}
        disabled={frozen}
        value={node.title}
        onChange={(event) =>
          props.dispatch({
            type: "updateNode",
            nodeId: node.id,
            patch: { title: event.target.value },
          })
        }
      />
      <RoleField node={node} frozen={frozen} dispatch={props.dispatch} />
      <GateField node={node} frozen={frozen} dispatch={props.dispatch} />
      <JoinField node={node} frozen={frozen} dispatch={props.dispatch} />
      <label style={{ ...labelStyle, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          disabled={frozen}
          checked={session.draft.graph.entryNodeIds.includes(node.id)}
          onChange={() => props.dispatch({ type: "toggleEntry", nodeId: node.id })}
        />
        入口节点
      </label>
    </aside>
  );
}

function RoleField(props: {
  node: CanvasNode;
  frozen: boolean;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  if (props.node.kind !== "task" && props.node.kind !== "delivery") {
    return null;
  }
  return (
    <>
      <label style={labelStyle} htmlFor="wf-node-role">
        角色
      </label>
      <select
        id="wf-node-role"
        style={inputStyle}
        disabled={props.frozen}
        value={props.node.role ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value.length === 0 || !(WORKER_ROLES as readonly string[]).includes(value)) {
            props.dispatch({ type: "unsetNode", nodeId: props.node.id, fields: ["role"] });
            return;
          }
          props.dispatch({
            type: "updateNode",
            nodeId: props.node.id,
            patch: { role: value as CanvasWorkerRole },
          });
        }}
      >
        <option value="">（无）</option>
        {WORKER_ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>
    </>
  );
}

function GateField(props: {
  node: CanvasNode;
  frozen: boolean;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  if (props.node.kind !== "approval") {
    return null;
  }
  return (
    <>
      <label style={labelStyle} htmlFor="wf-node-gate">
        Gate
      </label>
      <select
        id="wf-node-gate"
        style={inputStyle}
        disabled={props.frozen}
        value={props.node.gate ?? "artifact"}
        onChange={(event) => {
          const gate = event.target.value;
          if (gate === "plan" || gate === "artifact") {
            props.dispatch({ type: "updateNode", nodeId: props.node.id, patch: { gate } });
          }
        }}
      >
        {WORKFLOW_GATES.map((gate) => (
          <option key={gate} value={gate}>
            {gate}
          </option>
        ))}
      </select>
    </>
  );
}

function JoinField(props: {
  node: CanvasNode;
  frozen: boolean;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  return (
    <>
      <label style={labelStyle} htmlFor="wf-node-join">
        汇合策略
      </label>
      <select
        id="wf-node-join"
        style={inputStyle}
        disabled={props.frozen}
        value={props.node.joinPolicy ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value.length === 0 || !(JOIN_POLICIES as readonly string[]).includes(value)) {
            props.dispatch({ type: "unsetNode", nodeId: props.node.id, fields: ["joinPolicy"] });
            return;
          }
          props.dispatch({
            type: "updateNode",
            nodeId: props.node.id,
            patch: { joinPolicy: value as CanvasJoinPolicy },
          });
        }}
      >
        <option value="">（无）</option>
        {JOIN_POLICIES.map((policy) => (
          <option key={policy} value={policy}>
            {policy}
          </option>
        ))}
      </select>
    </>
  );
}
