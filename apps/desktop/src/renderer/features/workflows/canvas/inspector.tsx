import type { ReactNode } from "react";

import { Field, Input, Muted, Select } from "../../../components/ui.js";
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
import type { CanvasAction, CanvasSession } from "./model.js";

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
      <aside className="wf-canvas-inspector" data-testid="workflow-canvas-inspector">
        <Muted>选中节点或边以编辑属性。画布只编排未发布草稿。</Muted>
      </aside>
    );
  }

  if (edge) {
    return (
      <aside className="wf-canvas-inspector" data-testid="workflow-canvas-inspector">
        <p className="wf-label">边 {edge.id}</p>
        <Muted>
          {edge.from} → {edge.to}
        </Muted>
        <Field label="上游等待" htmlFor="wf-edge-wait">
          <Select
            id="wf-edge-wait"
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
          </Select>
        </Field>
      </aside>
    );
  }

  if (!node) {
    return null;
  }

  return (
    <aside className="wf-canvas-inspector" data-testid="workflow-canvas-inspector">
      <p className="wf-label">节点 {node.id}</p>
      <Field label="标题" htmlFor="wf-node-title">
        <Input
          id="wf-node-title"
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
      </Field>
      <RoleField node={node} frozen={frozen} dispatch={props.dispatch} />
      <GateField node={node} frozen={frozen} dispatch={props.dispatch} />
      <JoinField node={node} frozen={frozen} dispatch={props.dispatch} />
      <label className="wf-check-row">
        <input
          className="wf-check"
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
    <Field label="角色" htmlFor="wf-node-role">
      <Select
        id="wf-node-role"
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
      </Select>
    </Field>
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
    <Field label="Gate" htmlFor="wf-node-gate">
      <Select
        id="wf-node-gate"
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
      </Select>
    </Field>
  );
}

function JoinField(props: {
  node: CanvasNode;
  frozen: boolean;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  return (
    <Field label="汇合策略" htmlFor="wf-node-join">
      <Select
        id="wf-node-join"
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
      </Select>
    </Field>
  );
}
