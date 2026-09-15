import type { ReactNode } from "react";

import { Badge, EmptyState, Field, Input, Muted, Select, Textarea } from "../../../components/ui.js";
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
import {
  GATE_LABEL,
  INSPECTOR_EMPTY_NOTE,
  JOIN_LABEL,
  KIND_LABEL,
  ROLE_LABEL,
  WAIT_LABEL,
} from "./copy.js";
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
        <EmptyState title="未选中">{INSPECTOR_EMPTY_NOTE}</EmptyState>
      </aside>
    );
  }

  if (edge) {
    return (
      <aside className="wf-canvas-inspector" data-testid="workflow-canvas-inspector">
        <p className="wf-label">边</p>
        <Badge tone="muted">{edge.id}</Badge>
        <Muted>
          {edge.from} → {edge.to}
        </Muted>
        <Field label="上游等待" htmlFor="wf-edge-wait" hint="协议字段 waitFor，执行仍以已发布图为准。">
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
                {WAIT_LABEL[wait]}（{wait}）
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
      <p className="wf-label">节点属性</p>
      <div className="wf-cluster">
        <Badge tone={kindTone(node.kind)}>{KIND_LABEL[node.kind]}</Badge>
        <Muted>{node.id}</Muted>
      </div>
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
      <MinSuccessField node={node} frozen={frozen} dispatch={props.dispatch} />
      <Field label="备注" htmlFor="wf-node-notes">
        <Textarea
          id="wf-node-notes"
          disabled={frozen}
          rows={3}
          value={node.notes.join("\n")}
          onChange={(event) =>
            props.dispatch({
              type: "updateNode",
              nodeId: node.id,
              patch: {
                notes: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0),
              },
            })
          }
        />
      </Field>
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

function kindTone(kind: CanvasNode["kind"]): "info" | "warning" | "accent" | "success" | "muted" {
  switch (kind) {
    case "task":
      return "info";
    case "approval":
      return "warning";
    case "condition":
      return "accent";
    case "parallel":
      return "success";
    case "delivery":
      return "muted";
  }
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
    <Field label="角色" htmlFor="wf-node-role" hint="请入项目 Team 时再绑具体 WorkerVersion。">
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
            {ROLE_LABEL[role]}（{role}）
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
            {GATE_LABEL[gate]}（{gate}）
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
            {JOIN_LABEL[policy]}（{policy}）
          </option>
        ))}
      </Select>
    </Field>
  );
}

function MinSuccessField(props: {
  node: CanvasNode;
  frozen: boolean;
  dispatch: (action: CanvasAction) => void;
}): ReactNode {
  if (props.node.joinPolicy !== "min_success") {
    return null;
  }
  return (
    <Field label="最少成功数" htmlFor="wf-node-min-success">
      <Input
        id="wf-node-min-success"
        type="number"
        disabled={props.frozen}
        value={String(props.node.minSuccess ?? 1)}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          props.dispatch({
            type: "updateNode",
            nodeId: props.node.id,
            patch: { minSuccess: Number.isFinite(parsed) ? parsed : 1 },
          });
        }}
      />
    </Field>
  );
}
