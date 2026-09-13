import {
  isSelectableWorkerVersion,
  parseChatClassifyInput,
  parseChatClassifyResult,
  parseChatIntent,
  type ChatClassifyInput,
  type ChatClassifyResultDto,
  type ChatIntentDto,
  type ChatNeedContextMissing,
  type ProjectDto,
  type RunDto,
  type WorkerCardFieldName,
  type WorkerDto,
} from "@workforce/protocol";

/**
 * Optional read-only snapshot for resolving names already in the library or
 * an in-flight Run. Callers pass catalog/project rows; this module never
 * writes workers, drafts, tasks, or runs.
 */
export interface ChatClassifyContext {
  readonly workers?: readonly WorkerDto[];
  readonly projects?: readonly ProjectDto[];
  readonly runs?: readonly RunDto[];
}

const UNRECOGNIZED_QUESTION =
  "没听懂这句话要落到哪。是建角色、改卡片、请到项目、建流程、问进度，还是执行中补一句？有项目也不会默认当成交流工作。";

const IN_FLIGHT_RUN_STATUSES = new Set([
  "pending",
  "starting",
  "running",
  "waiting_input",
  "paused",
]);

const ROLE_OBJECT =
  /角色|工人|员工|开发者|工程师|测试员|助手|人员|\breviewer\b|\bagents?\b|\bcoders?\b|\bqa\b|\bprogrammer\b/iu;

const PROCESS_OBJECT = /流程|工作流|流水线|编排|\bworkflows?\b|\bpipelines?\b/iu;

const CREATE_VERB = /建|创建|新建|招|来一个|要一个|加一个|做[一条个名位]/u;

type ClauseResolution =
  | { readonly kind: "intent"; readonly intent: ChatIntentDto }
  | { readonly kind: "need_context"; readonly missing: ChatNeedContextMissing }
  | { readonly kind: "unrecognized" };

/**
 * Classify one Chat utterance by what the speaker is trying to land on
 * (library / Team / Workflow / progress / in-flight input), not by matching
 * the frozen UI copy 「创建角色 / 创建流程」. Unrecognized text is
 * `need_clarification` even when `projectId` is present. Does not write.
 */
export function classifyChatIntent(
  input: ChatClassifyInput,
  context: ChatClassifyContext = {},
): ChatClassifyResultDto {
  const parsed = parseChatClassifyInput(input);
  const text = parsed.text.trim();

  if (isImRequest(text)) {
    return parseChatClassifyResult({
      outcome: "unsupported",
      code: "unsupported_capability",
      action: "im",
    });
  }
  if (isDirectRequest(text)) {
    return parseChatClassifyResult({
      outcome: "unsupported",
      code: "unsupported_capability",
      action: "direct",
    });
  }

  const clauses = splitActionClauses(text);
  const intents: ChatIntentDto[] = [];
  let missing: ChatNeedContextMissing | undefined;

  for (const clause of clauses) {
    const resolved = resolveClause(clause, parsed, context);
    if (resolved.kind === "intent") {
      intents.push(resolved.intent);
      continue;
    }
    if (resolved.kind === "need_context" && missing === undefined) {
      missing = resolved.missing;
    }
  }

  const first = intents[0];
  if (first !== undefined && intents.length === 1) {
    return parseChatClassifyResult({ outcome: "intent", intent: first });
  }
  if (first !== undefined && intents.length > 1) {
    return parseChatClassifyResult({
      outcome: "intent",
      intent: first,
      intents,
    });
  }
  if (missing !== undefined) {
    return parseChatClassifyResult({ outcome: "need_context", missing });
  }
  return parseChatClassifyResult({
    outcome: "need_clarification",
    question: UNRECOGNIZED_QUESTION,
  });
}

function resolveClause(
  clause: string,
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): ClauseResolution {
  if (isInviteTeam(clause)) {
    return resolveInviteTeam(clause, input, context);
  }
  if (isUpdateWorker(clause)) {
    return resolveUpdateWorker(clause, input, context);
  }
  if (isCreateWorkflow(clause)) {
    return resolveCreateWorkflow(clause, input, context);
  }
  if (isCreateWorker(clause)) {
    return { kind: "intent", intent: buildCreateWorker(clause) };
  }
  if (isQueryProgress(clause)) {
    return resolveQueryProgress(input, context, clause);
  }
  if (isDiscussWork(clause)) {
    return resolveDiscussWork(input, context);
  }
  return { kind: "unrecognized" };
}

function splitActionClauses(text: string): string[] {
  const parts = text
    .split(/[，,、]?(?:并|然后|接着|同时|再)(?=请|做|建|创建|开|问|查|加|邀)/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [text];
}

function isImRequest(text: string): boolean {
  return (
    /收件箱|私聊|私信|聊天室|\binbox\b|\bim\b/iu.test(text) ||
    /\/chat\/inbox/u.test(text) ||
    /\/workers\/[^/\s]+\/messages/u.test(text)
  );
}

/**
 * Immediate execution, not "change this role" and not "make a pipeline".
 * 「现在改这个 bug」is direct; 「把这个角色改得…」is not.
 */
function isDirectRequest(text: string): boolean {
  if (/:direct\b/u.test(text) || /\bjust do it\b/iu.test(text)) {
    return true;
  }
  if (/\bdirect\b/iu.test(text)) {
    return true;
  }
  if (/去做/u.test(text)) {
    return true;
  }
  if (/马上(?:去)?(?:做|改|修|干)|立刻(?:去)?(?:做|改|修)/u.test(text)) {
    return true;
  }
  if (/现在(?:去)?(?:改|修|做|干)/u.test(text) && /(?:bug|缺陷|问题)/iu.test(text)) {
    return true;
  }
  return /现在改这个\s*bug/iu.test(text);
}

function isInviteTeam(text: string): boolean {
  if (/请到/u.test(text)) {
    return true;
  }
  if (/请.{0,16}(?:进|入|加入)/u.test(text)) {
    return true;
  }
  if (/(?:邀|请来).{0,12}(?:项目|团队|\bteam\b)/iu.test(text)) {
    return true;
  }
  return /\binvite\b|\badd (?:this |the )?role\b/iu.test(text);
}

function isUpdateWorker(text: string): boolean {
  if (/对.{0,12}(?:角色|工人|员工).{0,8}说/u.test(text)) {
    return true;
  }
  if (/(?:没在跑|空闲)/u.test(text) && /说|讲|告诉/u.test(text)) {
    return true;
  }
  if (/把.{0,12}(?:角色|工人|员工).{0,16}改/u.test(text)) {
    return true;
  }
  if (/改得/u.test(text) && ROLE_OBJECT.test(text)) {
    return true;
  }
  if (/改.{0,8}(?:角色|卡片)/u.test(text)) {
    return true;
  }
  return /以后别动|别动\s*schema|不要动\s*schema/u.test(text) && ROLE_OBJECT.test(text);
}

function isCreateWorkflow(text: string): boolean {
  if (!PROCESS_OBJECT.test(text)) {
    return false;
  }
  return /建|创建|新建|做|开|加|一条|新/u.test(text);
}

function isCreateWorker(text: string): boolean {
  if (PROCESS_OBJECT.test(text)) {
    return false;
  }
  if (!CREATE_VERB.test(text) && !/新角色/u.test(text)) {
    return false;
  }
  return ROLE_OBJECT.test(text);
}

function isQueryProgress(text: string): boolean {
  return /进度|还没有记录|做到哪|进行到哪|进行得怎样/u.test(text) || /\bprogress\b/iu.test(text);
}

function isDiscussWork(text: string): boolean {
  if (/没在跑|空闲/u.test(text) || /对.{0,8}角色说/u.test(text)) {
    return false;
  }
  return (
    /执行中|进行中|这条\s*run|补一句|补约束|返工|交流工作|讨论工作/u.test(text) ||
    /\bthis run\b|\bdiscuss\b/iu.test(text)
  );
}

function resolveInviteTeam(
  clause: string,
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): ClauseResolution {
  const projectId = resolveProjectId(clause, input, context);
  const worker = resolveWorker(clause, input, context);
  const workerVersionId = optionalText(input.workerVersionId) ?? publishedVersionId(worker);

  if (workerVersionId === undefined) {
    return { kind: "need_context", missing: "workerId" };
  }
  if (projectId === undefined) {
    return { kind: "need_context", missing: "projectId" };
  }

  const intent: Record<string, unknown> = {
    kind: "invite_team",
    projectId,
    workerVersionId,
  };
  const summary = optionalText(clause);
  if (summary !== undefined) {
    intent.summary = summary;
  }
  return { kind: "intent", intent: parseChatIntent(intent) };
}

function resolveUpdateWorker(
  clause: string,
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): ClauseResolution {
  const worker = resolveWorker(clause, input, context);
  const workerId = optionalText(input.workerId) ?? worker?.id;
  if (workerId === undefined) {
    return { kind: "need_context", missing: "workerId" };
  }

  const intent: Record<string, unknown> = {
    kind: "update_worker",
    workerId,
    cardField: inferCardField(clause),
  };
  const draftId = optionalText(input.workerDraftId);
  if (draftId !== undefined) {
    intent.workerDraftId = draftId;
  }
  const versionId = optionalText(input.workerVersionId) ?? publishedVersionId(worker);
  if (versionId !== undefined) {
    intent.workerVersionId = versionId;
  }
  const remark = inferUpdateText(clause);
  if (remark !== undefined) {
    intent.text = remark;
  }
  return { kind: "intent", intent: parseChatIntent(intent) };
}

function resolveCreateWorkflow(
  clause: string,
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): ClauseResolution {
  const projectId = resolveProjectId(clause, input, context);
  if (projectId === undefined) {
    return { kind: "need_context", missing: "projectId" };
  }
  const intent: Record<string, unknown> = { kind: "create_workflow", projectId };
  const summary = optionalText(clause);
  if (summary !== undefined) {
    intent.summary = summary;
  }
  return { kind: "intent", intent: parseChatIntent(intent) };
}

function buildCreateWorker(clause: string): ChatIntentDto {
  const intent: Record<string, unknown> = { kind: "create_worker" };
  const summary = optionalText(clause);
  if (summary !== undefined) {
    intent.summary = summary;
  }
  const card = extractCreateWorkerCard(clause);
  if (card.who !== undefined) {
    intent.who = card.who;
  }
  if (card.how !== undefined) {
    intent.how = card.how;
  }
  if (card.skills !== undefined) {
    intent.skills = card.skills;
  }
  return parseChatIntent(intent);
}

function resolveQueryProgress(
  input: ChatClassifyInput,
  context: ChatClassifyContext,
  clause: string,
): ClauseResolution {
  const projectId = resolveProjectId(clause, input, context);
  if (projectId === undefined) {
    return { kind: "need_context", missing: "projectId" };
  }
  return { kind: "intent", intent: parseChatIntent({ kind: "query_progress", projectId }) };
}

function resolveDiscussWork(
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): ClauseResolution {
  const inFlight = pickInFlightRun(input, context);
  const projectId = optionalText(input.projectId) ?? inFlight?.projectId;
  if (projectId === undefined) {
    return { kind: "need_context", missing: "projectId" };
  }
  const runId = optionalText(input.runId) ?? inFlight?.id;
  if (runId === undefined) {
    return { kind: "need_context", missing: "runId" };
  }
  return {
    kind: "intent",
    intent: parseChatIntent({ kind: "discuss_work", projectId, runId }),
  };
}

function extractCreateWorkerCard(clause: string): {
  who?: string;
  how?: string;
  skills?: string;
} {
  const body = clause
    .replace(
      /^(?:请(?:你|帮我)?|帮我)?(?:先)?(?:建|创建|新建|招|来一个|要一个|加一个|做[一条个名位])(?:一个|一名|一位|一条)?/u,
      "",
    )
    .trim();
  const stripped = optionalText(body);
  const who =
    stripped !== undefined && !/^(?:角色|工人|员工)$/u.test(stripped) ? stripped : undefined;
  const howMatch = body.match(/更[^的\s]{1,8}/u);
  const skillsMatch = body.match(/会([^的，。]{1,20}?)(?:的|$)/u);
  const card: { who?: string; how?: string; skills?: string } = {};
  if (who !== undefined) {
    card.who = who;
  }
  const how = optionalText(howMatch?.[0]);
  if (how !== undefined) {
    card.how = how;
  }
  const skills = optionalText(skillsMatch?.[1] ?? skillsMatch?.[0]);
  if (skills !== undefined) {
    card.skills = skills;
  }
  return card;
}

function inferCardField(clause: string): WorkerCardFieldName {
  if (/是谁|身份|职责|他是|她是/u.test(clause)) {
    return "who";
  }
  if (/技能|更会|会写|会做|能力/u.test(clause)) {
    return "skills";
  }
  return "how";
}

function inferUpdateText(clause: string): string | undefined {
  const afterSay = clause.split(/说\s*[:：]/u, 2)[1];
  if (afterSay !== undefined) {
    return optionalText(afterSay);
  }
  const afterChange = clause.match(/改得\s*(.+)$/u)?.[1];
  if (afterChange !== undefined) {
    return optionalText(afterChange);
  }
  return optionalText(clause);
}

function resolveWorker(
  clause: string,
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): WorkerDto | undefined {
  const workers = context.workers ?? [];
  const byId = optionalText(input.workerId);
  if (byId !== undefined) {
    const hit = workers.find((worker) => worker.id === byId);
    if (hit !== undefined) {
      return hit;
    }
  }
  const byVersion = optionalText(input.workerVersionId);
  if (byVersion !== undefined) {
    const hit = workers.find((worker) => workerHasVersion(worker, byVersion));
    if (hit !== undefined) {
      return hit;
    }
  }

  const lowered = clause.toLowerCase();
  const named = workers.filter((worker) => workerMentioned(worker, lowered));
  if (named.length === 1) {
    return named[0];
  }
  if (
    /这个角色|该角色|这个工人/u.test(clause) &&
    workers.length === 1 &&
    workers[0] !== undefined
  ) {
    return workers[0];
  }
  return undefined;
}

function workerMentioned(worker: WorkerDto, loweredClause: string): boolean {
  if (worker.name.trim().length >= 2 && loweredClause.includes(worker.name.toLowerCase())) {
    return true;
  }
  for (const version of worker.versions ?? []) {
    if (version.name.trim().length >= 2 && loweredClause.includes(version.name.toLowerCase())) {
      return true;
    }
    if (version.role.trim().length >= 2 && loweredClause.includes(version.role.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function workerHasVersion(worker: WorkerDto, versionId: string): boolean {
  if (worker.activeVersionId === versionId) {
    return true;
  }
  return (worker.versions ?? []).some((version) => version.id === versionId);
}

function publishedVersionId(worker: WorkerDto | undefined): string | undefined {
  if (worker === undefined) {
    return undefined;
  }
  const active = (worker.versions ?? []).find(
    (version) => version.id === worker.activeVersionId && isSelectableWorkerVersion(version),
  );
  if (active !== undefined) {
    return active.id;
  }
  const published = (worker.versions ?? []).find((version) => isSelectableWorkerVersion(version));
  return published?.id;
}

function resolveProjectId(
  clause: string,
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): string | undefined {
  const named = namedProjectLabel(clause);
  if (named !== undefined) {
    const hit = (context.projects ?? []).find((project) => projectMatchesLabel(project, named));
    if (hit !== undefined) {
      return hit.id;
    }
  }
  return optionalText(input.projectId);
}

function namedProjectLabel(clause: string): string | undefined {
  const fromProject = clause.match(/项目\s*([A-Za-z0-9_\-一-龥]+)/u)?.[1];
  if (fromProject !== undefined) {
    return fromProject;
  }
  return optionalText(clause.match(/请到\s*([A-Za-z0-9_\-一-龥]+)/u)?.[1]);
}

function projectMatchesLabel(project: ProjectDto, label: string): boolean {
  const lowered = label.toLowerCase();
  if (project.id === label || project.id.toLowerCase() === lowered) {
    return true;
  }
  const name = project.name.trim();
  if (name.length === 0) {
    return false;
  }
  return (
    name === label ||
    name.toLowerCase() === lowered ||
    name === `项目${label}` ||
    name.toLowerCase() === `项目${lowered}`
  );
}

function pickInFlightRun(
  input: ChatClassifyInput,
  context: ChatClassifyContext,
): RunDto | undefined {
  const requested = optionalText(input.runId);
  if (requested !== undefined) {
    const known = (context.runs ?? []).find((run) => run.id === requested);
    if (known !== undefined) {
      return known;
    }
  }
  const inFlight = (context.runs ?? []).filter((run) => IN_FLIGHT_RUN_STATUSES.has(run.status));
  const scoped =
    optionalText(input.projectId) === undefined
      ? inFlight
      : inFlight.filter((run) => run.projectId === input.projectId);
  return scoped[0];
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}
