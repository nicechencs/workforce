/**
 * Maps a project-scoped authoring sentence onto a strict AuthoringProposal.
 *
 * Chat classification lives in Application. This helper only decides what the
 * Mock Runtime emits on `authoring_proposal`: a workflow graph, a team roster,
 * or both. Creating a worker is not this Runtime — `targetType` is never
 * `"worker"`. Summaries and graph labels come from interpreted meaning, not
 * the frozen `wf_mock_authoring` fixture, and never echo the raw prompt.
 */

export const MOCK_PUBLISHED_PLANNER_WORKER_VERSION_ID = "wrv_software_planner_0_1_0";
export const MOCK_PUBLISHED_DEVELOPER_WORKER_VERSION_ID = "wrv_software_developer_0_1_0";
export const MOCK_PUBLISHED_REVIEWER_WORKER_VERSION_ID = "wrv_software_reviewer_0_1_0";

export const MOCK_PUBLISHED_WORKER_VERSION_IDS = [
  MOCK_PUBLISHED_PLANNER_WORKER_VERSION_ID,
  MOCK_PUBLISHED_DEVELOPER_WORKER_VERSION_ID,
  MOCK_PUBLISHED_REVIEWER_WORKER_VERSION_ID,
] as const;

export type MockAuthoringTargetType = "workflow" | "team";

export type MockWorkflowWorkerRole = "planner" | "developer" | "reviewer" | "approver";

export interface MockWorkflowGraphNode {
  id: string;
  kind: "task" | "approval";
  title: string;
  role: MockWorkflowWorkerRole;
  expectedOutputIds: string[];
}

export interface MockWorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  waitFor: "outputs_ready";
}

export interface MockWorkflowGraph {
  entryNodeIds: string[];
  nodes: MockWorkflowGraphNode[];
  edges: MockWorkflowGraphEdge[];
  failurePolicy: { default: "fail" };
  concurrencyPolicy: {
    runWorktree: "isolated";
    integrationWorktree: "disabled";
  };
}

export interface MockTeamMember {
  id: string;
  role: "planner" | "developer" | "reviewer";
  workerVersionId: string;
  quantity: number;
}

export interface MockAuthoringWorkflowPatch {
  targetType: "workflow";
  name: string;
  description: string;
  graph: MockWorkflowGraph;
}

export interface MockAuthoringTeamPatch {
  targetType: "team";
  name: string;
  description: string;
  members: MockTeamMember[];
}

export type MockAuthoringPatch = MockAuthoringWorkflowPatch | MockAuthoringTeamPatch;

export interface MockAuthoringProposalTarget {
  targetType: MockAuthoringTargetType;
  targetId: string;
  expectedRevision: 1;
  patchRef: string;
}

export interface MockAuthoringProposal {
  id: string;
  projectId: string;
  sourceRunId: string;
  summary: string;
  targets: MockAuthoringProposalTarget[];
}

export interface MockAuthoringInterpretation {
  wantsWorkflow: boolean;
  wantsTeam: boolean;
  summary: string;
  workflow?: MockAuthoringWorkflowPatch;
  team?: MockAuthoringTeamPatch;
}

const TEAM_ROSTER_INTENT =
  /组队|组(?:建)?(?:一个|个)?.{0,12}(?:团队|班底|小队)|入队|请到|请.{0,24}(?:进|入)(?:项目|团队|队)|请来.{0,24}(?:角色|reviewer|planner|developer|工人)|拉进(?:项目|团队|队)|配(?:一个)?(?:团队|班底)|加人|找人来|form(?:ing)? a team|assemble a (?:team|roster)|staff (?:the |a )?project|invite .{0,48} to (?:the )?(?:team|project)|add .{0,48} to (?:the )?team|bring .{0,48} (?:onto|into) (?:the )?team/i;

const WORKFLOW_PROCESS_INTENT =
  /流程|工作流|流水线|工序|先.{0,24}再|\bworkflow\b|\bpipeline\b|\bprocess\b/i;

const WORKFLOW_STAGES: ReadonlyArray<{
  id: string;
  title: string;
  role: MockWorkflowWorkerRole;
  kind: "task" | "approval";
  pattern: RegExp;
}> = [
  {
    id: "plan",
    title: "Plan",
    role: "planner",
    kind: "task",
    pattern: /规划|计划|\bplan(?:ning)?\b/i,
  },
  {
    id: "implement",
    title: "Implement",
    role: "developer",
    kind: "task",
    pattern: /实现|开发|编码|\bimplement|\bdevelop|\bcod(?:e|ing)\b/i,
  },
  { id: "test", title: "Test", role: "developer", kind: "task", pattern: /测试|\btest(?:ing)?\b/i },
  {
    id: "integrate",
    title: "Integrate",
    role: "developer",
    kind: "task",
    pattern: /整合|集成|\bintegrat/i,
  },
  { id: "review", title: "Review", role: "reviewer", kind: "task", pattern: /审查|评审|\breview/i },
  {
    id: "release",
    title: "Release",
    role: "developer",
    kind: "task",
    pattern: /发布|上线|部署|\brelease\b|\bdeploy|\bpublish/i,
  },
  {
    id: "accept",
    title: "Accept",
    role: "approver",
    kind: "approval",
    pattern: /验收|批准|\baccept|\bapprov/i,
  },
];

const TEAM_ROLES: ReadonlyArray<{
  role: MockTeamMember["role"];
  workerVersionId: string;
  pattern: RegExp;
}> = [
  {
    role: "planner",
    workerVersionId: MOCK_PUBLISHED_PLANNER_WORKER_VERSION_ID,
    pattern: /planner|规划师/i,
  },
  {
    role: "developer",
    workerVersionId: MOCK_PUBLISHED_DEVELOPER_WORKER_VERSION_ID,
    pattern: /developer|开发|实现/i,
  },
  {
    role: "reviewer",
    workerVersionId: MOCK_PUBLISHED_REVIEWER_WORKER_VERSION_ID,
    pattern: /reviewer|审查|评审/i,
  },
];

export function interpretMockAuthoringIntent(text: string): MockAuthoringInterpretation {
  const source = text.trim();
  const wantsTeam = TEAM_ROSTER_INTENT.test(source);
  const wantsWorkflow = WORKFLOW_PROCESS_INTENT.test(source) || !wantsTeam;
  const workflow = wantsWorkflow ? workflowPatchFromIntent(source) : undefined;
  const team = wantsTeam ? teamPatchFromIntent(source) : undefined;
  return {
    wantsWorkflow,
    wantsTeam,
    summary: summaryFromPatches(workflow, team),
    ...(workflow ? { workflow } : {}),
    ...(team ? { team } : {}),
  };
}

export function buildMockAuthoringProposal(input: {
  id: string;
  projectId: string;
  sourceRunId: string;
  patchRef: string;
  text: string;
}): { proposal: MockAuthoringProposal; patches: MockAuthoringPatch[] } {
  const interpreted = interpretMockAuthoringIntent(input.text);
  const digestKey = patchDigestKey(input.patchRef);
  const targets: MockAuthoringProposalTarget[] = [];
  const patches: MockAuthoringPatch[] = [];

  if (interpreted.workflow) {
    targets.push({
      targetType: "workflow",
      targetId: `wf_${digestKey}`,
      expectedRevision: 1,
      patchRef: interpreted.team === undefined ? input.patchRef : `${input.patchRef}_workflow`,
    });
    patches.push(interpreted.workflow);
  }
  if (interpreted.team) {
    targets.push({
      targetType: "team",
      targetId: `tm_${digestKey}`,
      expectedRevision: 1,
      patchRef: interpreted.workflow === undefined ? input.patchRef : `${input.patchRef}_team`,
    });
    patches.push(interpreted.team);
  }

  return {
    proposal: {
      id: input.id,
      projectId: input.projectId,
      sourceRunId: input.sourceRunId,
      summary: interpreted.summary,
      targets,
    },
    patches,
  };
}

function workflowPatchFromIntent(text: string): MockAuthoringWorkflowPatch {
  const stages = stagesInOrder(text);
  const nodes: MockWorkflowGraphNode[] =
    stages.length > 0
      ? stages.map((stage) => ({
          id: `node_${stage.id}`,
          kind: stage.kind,
          title: stage.title,
          role: stage.role,
          expectedOutputIds: [],
        }))
      : [
          {
            id: "node_task",
            kind: "task",
            title: workflowTopicTitle(text),
            role: "developer",
            expectedOutputIds: [],
          },
        ];
  const edges: MockWorkflowGraphEdge[] = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    if (!from || !to) {
      continue;
    }
    edges.push({
      id: `edge_${from.id}_${to.id}`,
      from: from.id,
      to: to.id,
      waitFor: "outputs_ready",
    });
  }
  const name = workflowNameFrom(text, nodes);
  return {
    targetType: "workflow",
    name,
    description: `${name} derived from the user sentence`,
    graph: {
      entryNodeIds: [nodes[0]?.id ?? "node_task"],
      nodes,
      edges,
      failurePolicy: { default: "fail" },
      concurrencyPolicy: {
        runWorktree: "isolated",
        integrationWorktree: "disabled",
      },
    },
  };
}

function teamPatchFromIntent(text: string): MockAuthoringTeamPatch {
  const mentioned = TEAM_ROLES.filter((item) => item.pattern.test(text));
  const selected = mentioned.length > 0 ? mentioned : [...TEAM_ROLES];
  const members: MockTeamMember[] = selected.map((item) => ({
    id: `mbr_${item.role}`,
    role: item.role,
    workerVersionId: item.workerVersionId,
    quantity: 1,
  }));
  const name =
    members.length === TEAM_ROLES.length ? "Published software-dev team" : "Published role roster";
  return {
    targetType: "team",
    name,
    description: `${name} with published workerVersionId members`,
    members,
  };
}

function stagesInOrder(text: string): Array<(typeof WORKFLOW_STAGES)[number]> {
  const found: Array<{ index: number; stage: (typeof WORKFLOW_STAGES)[number] }> = [];
  for (const stage of WORKFLOW_STAGES) {
    const match = stage.pattern.exec(text);
    if (match && match.index >= 0) {
      found.push({ index: match.index, stage });
    }
  }
  found.sort((left, right) => left.index - right.index);
  return found.map((item) => item.stage);
}

function workflowTopicTitle(text: string): string {
  const labeled = text.match(
    /([\u4e00-\u9fffA-Za-z0-9]{1,24})(?:流程|工作流|流水线|工序|\s+workflow|\s+pipeline)/i,
  );
  const topic = labeled?.[1]?.trim();
  if (topic && !TEAM_ROSTER_INTENT.test(topic)) {
    const stage = WORKFLOW_STAGES.find((item) => item.pattern.test(topic));
    if (stage) {
      return stage.title;
    }
  }
  return "Task";
}

function workflowNameFrom(text: string, nodes: readonly MockWorkflowGraphNode[]): string {
  if (nodes.length === 1) {
    const title = nodes[0]?.title ?? "Task";
    return title === "Task" ? "Workflow" : `${title} workflow`;
  }
  void text;
  return nodes.map((node) => node.title).join(" → ");
}

function memberCountLabel(count: number): string {
  return `${count} published member${count === 1 ? "" : "s"}`;
}

function summaryFromPatches(
  workflow: MockAuthoringWorkflowPatch | undefined,
  team: MockAuthoringTeamPatch | undefined,
): string {
  if (workflow && team) {
    return `Team roster (${memberCountLabel(team.members.length)}) and ${workflow.name}`;
  }
  if (team) {
    return `Team roster (${memberCountLabel(team.members.length)})`;
  }
  if (workflow) {
    return `${workflow.name} (${workflow.graph.nodes.length} node${
      workflow.graph.nodes.length === 1 ? "" : "s"
    })`;
  }
  return "Structured authoring proposal";
}

function patchDigestKey(patchRef: string): string {
  const match = /([0-9a-f]{16})(?:_[a-z]+)?$/i.exec(patchRef);
  return match?.[1]?.toLowerCase() ?? "from_intent";
}
