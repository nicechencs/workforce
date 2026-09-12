import type { ReactNode } from "react";

import { CANVAS_NODE_SIZE } from "../graph/operations.js";
import type { CanvasEdge, CanvasGraph, CanvasNode, CanvasNodeKind } from "../graph/types.js";
import { cn } from "../../../components/cn.js";
import type { CanvasSession } from "./model.js";

export function WorkflowCanvasEditor(props: {
  session: CanvasSession;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onNodeClick: (nodeId: string) => void;
}): ReactNode {
  const { graph } = props.session.draft;
  const bounds = canvasBounds(graph);
  return (
    <div className="wf-canvas-frame" data-testid="workflow-canvas">
      {graph.nodes.length === 0 ? (
        <p className="wf-canvas-empty" data-testid="workflow-canvas-empty">
          画布是空的。从工具栏添加节点。未发布，Runtime 不会执行此图。
        </p>
      ) : null}
      <svg
        role="img"
        aria-label="工作流画布"
        width={bounds.width}
        height={bounds.height}
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        data-testid="workflow-canvas-svg"
        onClick={() => {
          props.onSelectNode(null);
          props.onSelectEdge(null);
        }}
      >
        <defs>
          <marker
            id="wf-edge-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path className="wf-canvas-arrow" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {graph.edges.map((edge) => (
          <EdgePath
            key={edge.id}
            graph={graph}
            edge={edge}
            selected={props.session.selectedEdgeId === edge.id}
            onSelect={() => props.onSelectEdge(edge.id)}
          />
        ))}
        {graph.nodes.map((node) => (
          <NodeRect
            key={node.id}
            node={node}
            isEntry={graph.entryNodeIds.includes(node.id)}
            selected={props.session.selectedNodeId === node.id}
            connecting={props.session.connectFrom === node.id}
            onClick={() => props.onNodeClick(node.id)}
          />
        ))}
      </svg>
    </div>
  );
}

function canvasBounds(graph: CanvasGraph): { width: number; height: number } {
  if (graph.nodes.length === 0) {
    return { width: 720, height: 280 };
  }
  let maxX = 720;
  let maxY = 360;
  for (const node of graph.nodes) {
    maxX = Math.max(maxX, node.layout.x + CANVAS_NODE_SIZE.width + 48);
    maxY = Math.max(maxY, node.layout.y + CANVAS_NODE_SIZE.height + 48);
  }
  return { width: maxX, height: maxY };
}

function NodeRect(props: {
  node: CanvasNode;
  isEntry: boolean;
  selected: boolean;
  connecting: boolean;
  onClick: () => void;
}): ReactNode {
  const { node } = props;
  return (
    <g
      className="wf-canvas-node"
      data-testid={`workflow-canvas-node-${node.id}`}
      data-kind={node.kind}
      transform={`translate(${node.layout.x} ${node.layout.y})`}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
    >
      <rect
        className={cn(
          "wf-canvas-node-shape",
          `wf-canvas-node-${node.kind}`,
          props.selected && "is-selected",
          props.connecting && "is-connecting",
        )}
        width={CANVAS_NODE_SIZE.width}
        height={CANVAS_NODE_SIZE.height}
        rx={8}
      />
      <text className="wf-canvas-node-kind" x={12} y={22}>
        {kindLabel(node.kind)}
        {props.isEntry ? " · 入口" : ""}
      </text>
      <text className="wf-canvas-node-title" x={12} y={44}>
        {truncate(node.title, 14)}
      </text>
      <text className="wf-canvas-node-id" x={12} y={64}>
        {node.id}
        {node.role ? ` · ${node.role}` : ""}
      </text>
    </g>
  );
}

function EdgePath(props: {
  graph: CanvasGraph;
  edge: CanvasEdge;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const from = props.graph.nodes.find((node) => node.id === props.edge.from);
  const to = props.graph.nodes.find((node) => node.id === props.edge.to);
  if (!from || !to) {
    return null;
  }
  const x1 = from.layout.x + CANVAS_NODE_SIZE.width;
  const y1 = from.layout.y + CANVAS_NODE_SIZE.height / 2;
  const x2 = to.layout.x;
  const y2 = to.layout.y + CANVAS_NODE_SIZE.height / 2;
  const midX = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
  return (
    <g
      data-testid={`workflow-canvas-edge-${props.edge.id}`}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect();
      }}
      className="wf-canvas-hit"
    >
      <path className="wf-canvas-edge-hit" d={d} />
      <path className={cn("wf-canvas-edge", props.selected && "is-selected")} d={d} markerEnd="url(#wf-edge-arrow)" />
    </g>
  );
}

function kindLabel(kind: CanvasNodeKind): string {
  switch (kind) {
    case "task":
      return "任务";
    case "approval":
      return "审批";
    case "condition":
      return "条件";
    case "parallel":
      return "并行";
    case "delivery":
      return "交付";
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
