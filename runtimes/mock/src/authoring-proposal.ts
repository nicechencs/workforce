/**
 * Maps a project-scoped authoring sentence onto a strict AuthoringProposal.
 *
 * Chat classification lives in Application. This helper only decides what the
 * Mock Runtime emits on `authoring_proposal`: a workflow graph, a team roster,
 * a patch of an existing Task, or a combination. Creating a worker is not this
 * Runtime — `targetType` is never `"worker"`. Summaries, graph labels, and
 * Task patch fields come from interpreted meaning, not the frozen
 * `wf_mock_authoring` fixture, and never echo the raw prompt.
 */

import { sha256Hex, stableJson } from "@workforce/runtime-sdk";

export const MOCK_PUBLISHED_PLANNER_WORKER_VERSION_ID = "wrv_software_planner_0_1_0";
export const MOCK_PUBLISHED_DEVELOPER_WORKER_VERSION_ID = "wrv_software_developer_0_1_0";
export const MOCK_PUBLISHED_REVIEWER_WORKER_VERSION_ID = "wrv_software_reviewer_0_1_0";

export const MOCK_PUBLISHED_WORKER_VERSION_IDS = [
  MOCK_PUBLISHED_PLANNER_WORKER_VERSION_ID,
  MOCK_PUBLISHED_DEVELOPER_WORKER_VERSION_ID,
  MOCK_PUBLISHED_REVIEWER_WORKER_VERSION_ID,
] as const;

export type MockAuthoringTargetType = "workflow" | "team" | "task";

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

export interface MockAuthoringTaskExpectedOutput {
  id: string;
  kind: string;
  required: boolean;
}

export interface MockAuthoringTaskDependency {
  taskId: string;
  waitFor: "outputs_ready" | "completed";
}

export interface MockAuthoringTaskPatch {
  targetType: "task";
  taskId: string;
  /** CAS next revision; proposal `expectedRevision` is this minus one. */
  revision: number;
  title?: string;
  role?: MockWorkflowWorkerRole;
  requiresReview?: boolean;
  expectedOutputs?: MockAuthoringTaskExpectedOutput[];
  dependsOn?: MockAuthoringTaskDependency[];
  maxAttempts?: number;
  maxReworkCycles?: number;
  priority?: number;
}

export type MockAuthoringPatch =
  MockAuthoringWorkflowPatch | MockAuthoringTeamPatch | MockAuthoringTaskPatch;

export interface MockAuthoringProposalTarget {
  targetType: MockAuthoringTargetType;
  targetId: string;
  expectedRevision: number;
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
  wantsTask: boolean;
  summary: string;
  workflow?: MockAuthoringWorkflowPatch;
  team?: MockAuthoringTeamPatch;
  task?: MockAuthoringTaskPatch;
}

const TEAM_ROSTER_INTENT =
  /组队|组(?:建)?(?:一个|个)?.{0,12}(?:团队|班底|小队)|入队|请到|请.{0,24}(?:进|入)(?:项目|团队|队)|请来.{0,24}(?:角色|reviewer|planner|developer|工人)|拉进(?:项目|团队|队)|配(?:一个)?(?:团队|班底)|加人|找人来|form(?:ing)? a team|assemble a (?:team|roster)|staff (?:the |a )?project|invite .{0,48} to (?:the )?(?:team|project)|add .{0,48} to (?:the )?team|bring .{0,48} (?:onto|into) (?:the )?team/i;

const WORKFLOW_PROCESS_INTENT =
  /流程|工作流|流水线|工序|先.{0,24}再|\bworkflow\b|\bpipeline\b|\bprocess\b/i;

const TASK_CHANGE_INTENT =
  /(?:改|修改|更新|调整)(?:这个|该|此)?任务|(?:把|将)(?:这个|该|此)?任务|任务(?:的)?(?:标题|名称|角色|审查|评审|依赖|产出|优先级)|任务(?:改成|改为|设为|设成)|(?:change|update|rename|patch|edit)\s+(?:the\s+|this\s+)?task|task\s+(?:title|role|review|revision)|(?:require(?:s)?\s+review).{0,32}\btask\b|\btask\b.{0,32}(?:require(?:s)?\s+review)|(?:改|修改|更新|调整|update|change|rename|patch|edit).{0,40}\btsk_[A-Za-z0-9]+|\btsk_[A-Za-z0-9]+.{0,24}(?:改成|改为|标题|审查|title|review)/i;

const TASK_ID_PATTERN = /\b(tsk_[A-Za-z0-9]+)\b/g;

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

const TASK_ROLE_ALIASES: ReadonlyArray<{
  role: MockWorkflowWorkerRole;
  pattern: RegExp;
}> = [
  { role: "planner", pattern: /planner|规划师|规划/i },
  { role: "developer", pattern: /developer|开发者|开发/i },
  { role: "reviewer", pattern: /reviewer|审查员|审查|评审/i },
  { role: "approver", pattern: /approver|批准|验收/i },
];

export function interpretMockAuthoringIntent(text: string): MockAuthoringInterpretation {
  const source = text.trim();
  const wantsTask = TASK_CHANGE_INTENT.test(source);
  const wantsTeam = TEAM_ROSTER_INTENT.test(source);
  const wantsWorkflow = WORKFLOW_PROCESS_INTENT.test(source) || (!wantsTeam && !wantsTask);
  const workflow = wantsWorkflow ? workflowPatchFromIntent(source) : undefined;
  const team = wantsTeam ? teamPatchFromIntent(source) : undefined;
  const task = wantsTask ? taskPatchFromIntent(source) : undefined;
  return {
    wantsWorkflow,
    wantsTeam,
    wantsTask,
    summary: summaryFromPatches(workflow, team, task),
    ...(workflow ? { workflow } : {}),
    ...(team ? { team } : {}),
    ...(task ? { task } : {}),
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
  const multiple =
    Number(interpreted.workflow !== undefined) +
      Number(interpreted.team !== undefined) +
      Number(interpreted.task !== undefined) >
    1;

  if (interpreted.workflow) {
    targets.push({
      targetType: "workflow",
      targetId: `wf_${digestKey}`,
      expectedRevision: 1,
      patchRef: multiple ? `${input.patchRef}_workflow` : input.patchRef,
    });
    patches.push(interpreted.workflow);
  }
  if (interpreted.team) {
    targets.push({
      targetType: "team",
      targetId: `tm_${digestKey}`,
      expectedRevision: 1,
      patchRef: multiple ? `${input.patchRef}_team` : input.patchRef,
    });
    patches.push(interpreted.team);
  }
  if (interpreted.task) {
    targets.push({
      targetType: "task",
      targetId: interpreted.task.taskId,
      expectedRevision: interpreted.task.revision - 1,
      patchRef: multiple ? `${input.patchRef}_task` : input.patchRef,
    });
    patches.push(interpreted.task);
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

function taskPatchFromIntent(text: string): MockAuthoringTaskPatch {
  const expectedRevision = revisionFromIntent(text);
  const title = taskTitleFromIntent(text);
  const role = taskRoleFromIntent(text);
  const requiresReview = taskRequiresReviewFromIntent(text);
  const expectedOutputs = taskExpectedOutputsFromIntent(text);
  const namedIds = taskIdsIn(text);
  const dependsOn = taskDependsOnFromIntent(text, namedIds);
  const maxAttempts = boundedIntFromIntent(
    text,
    /(?:maxAttempts|最多(?:尝试|重试)?)\s*[=:：]?\s*(\d+)/i,
    1,
    100,
  );
  const maxReworkCycles = boundedIntFromIntent(
    text,
    /(?:maxReworkCycles|最多返工)\s*[=:：]?\s*(\d+)/i,
    0,
    100,
  );
  const priority = boundedIntFromIntent(text, /(?:priority|优先级)\s*[=:：]?\s*(\d+)/i, 0, 100);
  const fields = {
    ...(title !== undefined ? { title } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(requiresReview !== undefined ? { requiresReview } : {}),
    ...(expectedOutputs !== undefined ? { expectedOutputs } : {}),
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(maxReworkCycles !== undefined ? { maxReworkCycles } : {}),
    ...(priority !== undefined ? { priority } : {}),
  };
  const taskId =
    namedIds[0] ?? `tsk_${sha256Hex(stableJson({ expectedRevision, ...fields })).slice(0, 16)}`;
  return {
    targetType: "task",
    taskId,
    revision: expectedRevision + 1,
    ...fields,
  };
}

function taskIdsIn(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(TASK_ID_PATTERN)) {
    const id = match[1];
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function revisionFromIntent(text: string): number {
  const match = text.match(
    /(?:definitionRevision|expectedRevision|revision|修订号|修订)\s*[=:：]?\s*(\d+)/i,
  );
  const value = Number.parseInt(match?.[1] ?? "1", 10);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

function taskTitleFromIntent(text: string): string | undefined {
  const labeled = text.match(
    /(?:标题|名称|title)\s*(?:改成|改为|设为|设成|是|to|as|:|：)\s*[「「“"']?([^」」”"'\n，。,;；]{1,80})/i,
  );
  const quoted = text.match(/[「「“"]([^」」”"]{1,80})[」」”"]/);
  const raw = labeled?.[1]?.trim() || quoted?.[1]?.trim();
  if (
    !raw ||
    /^tsk_[A-Za-z0-9]+$/i.test(raw) ||
    TASK_ROLE_ALIASES.some((item) => item.pattern.test(raw))
  ) {
    return undefined;
  }
  return raw;
}

function taskRoleFromIntent(text: string): MockWorkflowWorkerRole | undefined {
  const labeled = text.match(
    /(?:角色|role)\s*(?:改成|改为|设为|设成|to|as|:|：)\s*([A-Za-z\u4e00-\u9fff]{2,16})/i,
  );
  const token = labeled?.[1]?.trim();
  if (!token) {
    return undefined;
  }
  return TASK_ROLE_ALIASES.find((item) => item.pattern.test(token))?.role;
}

function taskRequiresReviewFromIntent(text: string): boolean | undefined {
  if (
    /(?:不需要|不要|无需|取消|关闭|去掉).{0,8}(?:审查|评审)|(?:no|without|disable)\s+review/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /(?:需要|要|加上|开启|必须).{0,8}(?:审查|评审)|(?:require(?:s)?|enable)\s+review/i.test(text)
  ) {
    return true;
  }
  return undefined;
}

function taskExpectedOutputsFromIntent(
  text: string,
): MockAuthoringTaskExpectedOutput[] | undefined {
  const match = text.match(/(?:产出(?:物|id)?|expectedOutputs?)\s*[=:：]?\s*([A-Za-z0-9_-]+)/i);
  const id = match?.[1]?.trim();
  if (!id || id.startsWith("tsk_")) {
    return undefined;
  }
  return [{ id, kind: "artifact", required: true }];
}

function taskDependsOnFromIntent(
  text: string,
  namedIds: readonly string[],
): MockAuthoringTaskDependency[] | undefined {
  const mentioned: string[] = [];
  const seen = new Set<string>();
  const pattern = /(?:依赖|depends(?:\s+on)?)\s*(?:任务\s*)?(tsk_[A-Za-z0-9]+)/gi;
  for (const match of text.matchAll(pattern)) {
    const id = match[1];
    if (!id || seen.has(id) || id === namedIds[0]) {
      continue;
    }
    seen.add(id);
    mentioned.push(id);
  }
  if (mentioned.length === 0) {
    return undefined;
  }
  const waitFor: MockAuthoringTaskDependency["waitFor"] =
    /完成后|wait(?:s)?\s+for\s+completed/i.test(text) ? "completed" : "outputs_ready";
  return mentioned.map((taskId) => ({ taskId, waitFor }));
}

function boundedIntFromIntent(
  text: string,
  pattern: RegExp,
  min: number,
  max: number,
): number | undefined {
  const match = text.match(pattern);
  const value = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    return undefined;
  }
  return value;
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
  task: MockAuthoringTaskPatch | undefined,
): string {
  if (workflow && team && !task) {
    return `Team roster (${memberCountLabel(team.members.length)}) and ${workflow.name}`;
  }
  if (team && !workflow && !task) {
    return `Team roster (${memberCountLabel(team.members.length)})`;
  }
  if (workflow && !team && !task) {
    return `${workflow.name} (${workflow.graph.nodes.length} node${
      workflow.graph.nodes.length === 1 ? "" : "s"
    })`;
  }
  const parts: string[] = [];
  if (task) {
    parts.push(`Task patch (${task.taskId} rev ${task.revision})`);
  }
  if (team) {
    parts.push(`Team roster (${memberCountLabel(team.members.length)})`);
  }
  if (workflow) {
    parts.push(
      `${workflow.name} (${workflow.graph.nodes.length} node${
        workflow.graph.nodes.length === 1 ? "" : "s"
      })`,
    );
  }
  return parts.length > 0 ? parts.join(" and ") : "Structured authoring proposal";
}

function patchDigestKey(patchRef: string): string {
  const match = /([0-9a-f]{16})(?:_[a-z]+)?$/i.exec(patchRef);
  return match?.[1]?.toLowerCase() ?? "from_intent";
}
