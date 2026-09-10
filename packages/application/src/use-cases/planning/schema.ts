import {
  acceptanceCriterionSchema,
  expectedOutputSchema,
  protocolError,
  type ProtocolError,
} from "@workforce/protocol";

import {
  HARD_MAX_DEPTH,
  HARD_MAX_TASKS,
  PLAN_PROTOCOL,
  PLAN_PROTOCOL_VERSION,
  type OnUpstream,
  type PlanApprovalNode,
  type PlanArtifact,
  type PlanBounds,
  type PlanEdge,
  type PlanIntegration,
  type PlanNode,
  type PlanRuntime,
  type PlanTaskNode,
} from "./types.js";

const NODE_ID = /^[a-z][a-z0-9_]*$/;
const SHA1 = /^[0-9a-f]{40}$/;
const ON_UPSTREAM: readonly OnUpstream[] = ["outputs_ready", "completed"];

export type ParsePlanResult =
  { ok: true; plan: PlanArtifact } | { ok: false; error: ProtocolError };

function fail(message: string, details?: Record<string, unknown>): ParsePlanResult {
  return {
    ok: false,
    error: protocolError("validation_failed", message, details ? { details } : undefined),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseRuntime(value: unknown): PlanRuntime | string {
  if (!isRecord(value)) {
    return "runtime must be an object";
  }
  const adapterId = asString(value.adapterId);
  const protocolVersion = asString(value.protocolVersion);
  if (!adapterId || !protocolVersion) {
    return "runtime.adapterId and runtime.protocolVersion are required";
  }
  return { adapterId, protocolVersion };
}

function parseBounds(value: unknown): PlanBounds | string {
  if (!isRecord(value)) {
    return "bounds must be an object";
  }
  const maxDepth = asPositiveInt(value.maxDepth);
  const maxTasks = asPositiveInt(value.maxTasks);
  const maxAttempts = asPositiveInt(value.maxAttempts);
  const maxReworkCycles = asPositiveInt(value.maxReworkCycles);
  if (!maxDepth || !maxTasks || !maxAttempts || !maxReworkCycles) {
    return "bounds.maxDepth, maxTasks, maxAttempts, and maxReworkCycles must be positive integers";
  }
  if (maxTasks > HARD_MAX_TASKS) {
    return `bounds.maxTasks ${maxTasks} exceeds hard cap ${HARD_MAX_TASKS}`;
  }
  if (maxDepth > HARD_MAX_DEPTH) {
    return `bounds.maxDepth ${maxDepth} exceeds hard cap ${HARD_MAX_DEPTH}`;
  }
  return { maxDepth, maxTasks, maxAttempts, maxReworkCycles };
}

function parseTaskNode(value: Record<string, unknown>, id: string): PlanTaskNode | string {
  const role = asString(value.role);
  if (role !== "planner" && role !== "developer" && role !== "reviewer") {
    return `node ${id}: task role must be planner, developer, or reviewer`;
  }
  const workerRef = asString(value.workerRef);
  const title = asString(value.title);
  const objective = asString(value.objective);
  const maxAttempts = asPositiveInt(value.maxAttempts);
  const maxReworkCycles = asPositiveInt(value.maxReworkCycles);
  if (!workerRef || !title || !objective || !maxAttempts || !maxReworkCycles) {
    return `node ${id}: workerRef, title, objective, maxAttempts, and maxReworkCycles are required`;
  }
  if (!Array.isArray(value.expectedOutputs) || value.expectedOutputs.length === 0) {
    return `node ${id}: expectedOutputs must be a non-empty array`;
  }
  if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length === 0) {
    return `node ${id}: acceptanceCriteria must be a non-empty array`;
  }
  try {
    const expectedOutputs = value.expectedOutputs.map((item) => expectedOutputSchema.parse(item));
    const acceptanceCriteria = value.acceptanceCriteria.map((item) =>
      acceptanceCriterionSchema.parse(item),
    );
    return {
      id,
      kind: "task",
      role,
      workerRef,
      title,
      objective,
      expectedOutputs,
      acceptanceCriteria,
      maxAttempts,
      maxReworkCycles,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid output spec";
    return `node ${id}: ${message}`;
  }
}

function parseApprovalNode(value: Record<string, unknown>, id: string): PlanApprovalNode | string {
  if (value.role !== "human") {
    return `node ${id}: approval role must be human`;
  }
  if (
    value.gate !== "plan" &&
    value.gate !== "artifact" &&
    value.gate !== "action" &&
    value.gate !== "budget"
  ) {
    return `node ${id}: approval gate is required`;
  }
  const title = asString(value.title);
  const objective = asString(value.objective);
  if (!title || !objective) {
    return `node ${id}: title and objective are required`;
  }
  return {
    id,
    kind: "approval",
    role: "human",
    gate: value.gate,
    title,
    objective,
  };
}

function parseNode(value: unknown): PlanNode | string {
  if (!isRecord(value)) {
    return "each node must be an object";
  }
  const id = asString(value.id);
  if (!id || !NODE_ID.test(id)) {
    return "node id must match [a-z][a-z0-9_]*";
  }
  if (value.kind === "task") {
    return parseTaskNode(value, id);
  }
  if (value.kind === "approval") {
    return parseApprovalNode(value, id);
  }
  return `node ${id}: kind must be task or approval`;
}

function parseEdge(value: unknown): PlanEdge | string {
  if (!isRecord(value)) {
    return "each edge must be an object";
  }
  const id = asString(value.id);
  const from = asString(value.from);
  const to = asString(value.to);
  const onUpstream = asString(value.onUpstream);
  if (!id || !from || !to) {
    return "edge id, from, and to are required";
  }
  if (!onUpstream || !ON_UPSTREAM.includes(onUpstream as OnUpstream)) {
    return `edge ${id}: onUpstream must be outputs_ready or completed`;
  }
  return { id, from, to, onUpstream: onUpstream as OnUpstream };
}

function parseIntegration(value: unknown, nodes: PlanNode[]): PlanIntegration | string {
  if (!isRecord(value)) {
    return "integration must be an object";
  }
  if (value.strategy !== "stable_node_id_order") {
    return "integration.strategy must be stable_node_id_order";
  }
  if (value.worktree !== "dedicated") {
    return "integration.worktree must be dedicated";
  }
  if (value.onConflict !== "human") {
    return "integration.onConflict must be human";
  }
  if (!Array.isArray(value.contributorNodeIds) || value.contributorNodeIds.length === 0) {
    return "integration.contributorNodeIds must be a non-empty array";
  }
  if (!Array.isArray(value.bindDigestTo) || value.bindDigestTo.length === 0) {
    return "integration.bindDigestTo must be a non-empty array";
  }
  const ids = new Set(nodes.map((node) => node.id));
  const contributorNodeIds: string[] = [];
  for (const raw of value.contributorNodeIds) {
    const id = asString(raw);
    if (!id || !ids.has(id)) {
      return `integration contributor ${String(raw)} is not a plan node`;
    }
    const node = nodes.find((item) => item.id === id);
    if (!node || node.kind !== "task" || node.role !== "developer") {
      return `integration contributor ${id} must be a developer task`;
    }
    contributorNodeIds.push(id);
  }
  const bindDigestTo: string[] = [];
  for (const raw of value.bindDigestTo) {
    const id = asString(raw);
    if (!id || !ids.has(id)) {
      return `integration bindDigestTo ${String(raw)} is not a plan node`;
    }
    bindDigestTo.push(id);
  }
  return {
    strategy: "stable_node_id_order",
    worktree: "dedicated",
    contributorNodeIds,
    bindDigestTo,
    onConflict: "human",
  };
}

function incomingMap(nodes: PlanNode[], edges: PlanEdge[]): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.to)?.push(edge.from);
  }
  return incoming;
}

function detectCycle(nodes: PlanNode[], edges: PlanEdge[]): boolean {
  const incoming = incomingMap(nodes, edges);
  const remaining = new Set(nodes.map((node) => node.id));
  const queue = [...remaining].filter((id) => (incoming.get(id) ?? []).length === 0);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    remaining.delete(id);
    visited += 1;
    for (const edge of edges) {
      if (edge.from !== id) {
        continue;
      }
      const preds = incoming.get(edge.to);
      if (!preds) {
        continue;
      }
      const next = preds.filter((pred) => pred !== id);
      incoming.set(edge.to, next);
      if (next.length === 0 && remaining.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }
  return visited !== nodes.length;
}

function longestDepth(nodes: PlanNode[], edges: PlanEdge[]): number {
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incomingCount.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if ((incomingCount.get(node.id) ?? 0) === 0) {
      depth.set(node.id, 1);
      queue.push(node.id);
    }
  }
  let max = 1;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    const here = depth.get(id) ?? 1;
    for (const next of outgoing.get(id) ?? []) {
      const candidate = here + 1;
      if (candidate > (depth.get(next) ?? 0)) {
        depth.set(next, candidate);
        max = Math.max(max, candidate);
      }
      const left = (incomingCount.get(next) ?? 1) - 1;
      incomingCount.set(next, left);
      if (left === 0) {
        queue.push(next);
      }
    }
  }
  return max;
}

function developerWaitsOnReviewer(nodes: PlanNode[], edges: PlanEdge[]): string | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const fromReviewer =
      (from.kind === "task" && from.role === "reviewer") ||
      (from.kind === "approval" && from.gate === "artifact");
    const toDeveloper = to.kind === "task" && to.role === "developer";
    if (fromReviewer && toDeveloper) {
      return `developer ${to.id} must not depend on reviewer/approval ${from.id}`;
    }
  }
  return undefined;
}

function reviewerEdgesUseOutputsReady(nodes: PlanNode[], edges: PlanEdge[]): string | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const to = byId.get(edge.to);
    if (to?.kind === "task" && to.role === "reviewer" && edge.onUpstream !== "outputs_ready") {
      return `edge ${edge.id} into reviewer ${to.id} must use onUpstream outputs_ready`;
    }
  }
  return undefined;
}

export function parsePlanArtifact(input: unknown): ParsePlanResult {
  if (!isRecord(input)) {
    return fail("plan artifact must be an object");
  }
  if (input.protocol !== PLAN_PROTOCOL) {
    return fail("plan protocol must be workforce.plan");
  }
  if (input.protocolVersion !== PLAN_PROTOCOL_VERSION) {
    return fail("unsupported plan protocolVersion", { protocolVersion: input.protocolVersion });
  }
  const templateId = asString(input.templateId);
  const templateVersion = asString(input.templateVersion);
  const workflowId = asString(input.workflowId);
  const objective = asString(input.objective);
  const baseSha = asString(input.baseSha);
  const policyRef = asString(input.policyRef);
  if (!templateId || !templateVersion || !workflowId || !objective || !policyRef) {
    return fail("templateId, templateVersion, workflowId, objective, and policyRef are required");
  }
  if (!baseSha || !SHA1.test(baseSha)) {
    return fail("baseSha must be a 40-character lowercase hex SHA");
  }
  const runtime = parseRuntime(input.runtime);
  if (typeof runtime === "string") {
    return fail(runtime);
  }
  const bounds = parseBounds(input.bounds);
  if (typeof bounds === "string") {
    return fail(bounds);
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    return fail("plan must declare at least one node");
  }
  if (input.nodes.length > bounds.maxTasks) {
    return fail("plan exceeds bounds.maxTasks", {
      nodeCount: input.nodes.length,
      maxTasks: bounds.maxTasks,
    });
  }
  const nodes: PlanNode[] = [];
  const seen = new Set<string>();
  for (const raw of input.nodes) {
    const node = parseNode(raw);
    if (typeof node === "string") {
      return fail(node);
    }
    if (seen.has(node.id)) {
      return fail(`duplicate node id ${node.id}`);
    }
    seen.add(node.id);
    nodes.push(node);
  }
  if (!Array.isArray(input.edges)) {
    return fail("edges must be an array");
  }
  const edges: PlanEdge[] = [];
  const edgeIds = new Set<string>();
  for (const raw of input.edges) {
    const edge = parseEdge(raw);
    if (typeof edge === "string") {
      return fail(edge);
    }
    if (edgeIds.has(edge.id)) {
      return fail(`duplicate edge id ${edge.id}`);
    }
    if (!seen.has(edge.from) || !seen.has(edge.to)) {
      return fail(`edge ${edge.id} references unknown node`);
    }
    if (edge.from === edge.to) {
      return fail(`edge ${edge.id} is a self-loop`);
    }
    edgeIds.add(edge.id);
    edges.push(edge);
  }
  if (detectCycle(nodes, edges)) {
    return fail("plan DAG contains a cycle");
  }
  const depth = longestDepth(nodes, edges);
  if (depth > bounds.maxDepth) {
    return fail("plan exceeds bounds.maxDepth", { depth, maxDepth: bounds.maxDepth });
  }
  const developers = nodes.filter((node) => node.kind === "task" && node.role === "developer");
  const reviewers = nodes.filter((node) => node.kind === "task" && node.role === "reviewer");
  const artifactApprovals = nodes.filter(
    (node) => node.kind === "approval" && node.gate === "artifact",
  );
  if (developers.length < 2) {
    return fail("software-development-team plans must include at least two developer tasks");
  }
  if (reviewers.length < 1) {
    return fail("software-development-team plans must include a reviewer task");
  }
  if (artifactApprovals.length < 1) {
    return fail("software-development-team plans must include a human artifact approval");
  }
  const waitError = developerWaitsOnReviewer(nodes, edges);
  if (waitError) {
    return fail(waitError);
  }
  const upstreamError = reviewerEdgesUseOutputsReady(nodes, edges);
  if (upstreamError) {
    return fail(upstreamError);
  }
  const integration = parseIntegration(input.integration, nodes);
  if (typeof integration === "string") {
    return fail(integration);
  }
  return {
    ok: true,
    plan: {
      protocol: PLAN_PROTOCOL,
      protocolVersion: PLAN_PROTOCOL_VERSION,
      templateId,
      templateVersion,
      workflowId,
      objective,
      baseSha,
      policyRef,
      runtime,
      bounds,
      nodes,
      edges,
      integration,
    },
  };
}
