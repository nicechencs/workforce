import type {
  CreateWorkflowVersionInput,
  WorkflowGraphEdgeDto,
  WorkflowGraphNodeDto,
} from "@workforce/desktop-client";

import type { WorkflowStepView, WorkflowVersionView } from "../model.js";
import { addNode, connectNodes, layoutGraph } from "./operations.js";
import {
  emptyCanvasGraph,
  isCanvasWorkerRole,
  type CanvasGraph,
  type CanvasGraphPayload,
  type CanvasNode,
  type CanvasNodeKind,
} from "./types.js";
import { parseGraphRecord } from "./parse.js";

export { parseGraphRecord };

export function catalogKindToCanvas(kind: WorkflowStepView["kind"]): CanvasNodeKind {
  return kind;
}

export function graphFromSteps(steps: readonly WorkflowStepView[], entry?: string): CanvasGraph {
  let graph = emptyCanvasGraph();
  for (const step of steps) {
    graph = addNode(graph, catalogKindToCanvas(step.kind), step.id);
    graph = {
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.id !== step.id) {
          return node;
        }
        const next: CanvasNode = {
          ...node,
          title: step.title,
          notes: [...step.notes],
        };
        if (step.worker !== undefined && isCanvasWorkerRole(step.worker)) {
          next.role = step.worker;
        }
        if (step.gate !== undefined) {
          next.gate = step.gate;
        }
        return next;
      }),
    };
  }
  for (let i = 0; i < steps.length - 1; i += 1) {
    const from = steps[i];
    const to = steps[i + 1];
    if (!from || !to) {
      continue;
    }
    const connected = connectNodes(graph, from.id, to.id, "outputs_ready");
    graph = connected.graph;
  }
  const entryId =
    entry && graph.nodes.some((node) => node.id === entry) ? entry : graph.nodes[0]?.id;
  graph = {
    ...graph,
    entryNodeIds: entryId ? [entryId] : [],
  };
  return layoutGraph(graph);
}

export function graphFromVersion(version: WorkflowVersionView): CanvasGraph {
  if (version.graph && version.graph.nodes.length > 0) {
    return layoutGraph(version.graph);
  }
  return graphFromSteps(version.steps, version.entry);
}

export function stepsFromGraph(graph: CanvasGraph): WorkflowStepView[] {
  return graph.nodes.map((node) => {
    const catalogKind = node.kind === "condition" || node.kind === "parallel" ? "task" : node.kind;
    const step: WorkflowStepView = {
      id: node.id,
      kind: catalogKind,
      title: node.title,
      notes: [...node.notes],
    };
    if (node.role !== undefined) {
      step.worker = node.role;
    }
    if (node.gate !== undefined) {
      step.gate = node.gate;
    }
    return step;
  });
}

export function toProtocolNodeKind(kind: CanvasNodeKind): WorkflowGraphNodeDto["kind"] {
  return kind === "delivery" ? "task" : kind;
}

export function toProtocolGraph(
  graph: CanvasGraph | CanvasGraphPayload,
): Pick<CreateWorkflowVersionInput, "entry" | "nodes" | "edges"> {
  const nodes: WorkflowGraphNodeDto[] = graph.nodes.map((node) => {
    const dto: WorkflowGraphNodeDto = {
      id: node.id,
      kind: toProtocolNodeKind(node.kind),
    };
    if (node.title !== undefined && node.title.length > 0) {
      dto.title = node.title;
    }
    if (node.role !== undefined) {
      dto.role = node.role;
    }
    if (node.joinPolicy !== undefined) {
      dto.joinPolicy = node.joinPolicy;
    }
    if (node.minSuccess !== undefined) {
      dto.minSuccess = node.minSuccess;
    }
    return dto;
  });
  const edges: WorkflowGraphEdgeDto[] = graph.edges.map((edge) => {
    const dto: WorkflowGraphEdgeDto = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
    };
    if (edge.waitFor !== undefined) {
      dto.waitFor = edge.waitFor;
    }
    return dto;
  });
  const entry = graph.entryNodeIds[0] ?? graph.nodes[0]?.id;
  if (entry === undefined) {
    return { nodes, edges };
  }
  return { entry, nodes, edges };
}
