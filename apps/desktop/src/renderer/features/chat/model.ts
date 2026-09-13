import { ProblemError, type CommandOptions, type DesktopClient } from "@workforce/desktop-client";
import {
  PROJECT_PROGRESS_NO_RECORDS_MESSAGE,
  isSelectableWorkerVersion,
  workerCardFieldsAreImmutable,
  type ChatClassifyResultDto,
  type ChatIntentDto,
  type ChatNeedContextMissing,
  type CreateWorkerInput,
  type ProjectProgressProjectionDto,
  type TeamDto,
  type TeamMemberDto,
  type TeamVersionDto,
  type WorkerCardFieldName,
  type WorkerDraftDto,
  type WorkerDraftWrite,
  type WorkerDto,
  type WorkerVersionDto,
} from "@workforce/protocol";
import { ROLE_LIBRARY_PATH } from "@workforce/ui";

export const CHAT_SUBTITLE =
  "全局语言入口，任意页面可开，不限于作者页。分类不是完成；完成只看 Artifact / Run / Approval。";

export const CHAT_NOT_AUTHORING_ONLY =
  "这不是 /workflows?authoring=1 的作者页。创建流程仍走项目内 AuthoringSession；创建角色确认后进角色库草稿，不挂 projectId。";

export const CHAT_NOT_IM =
  "没有 Worker 收件箱，也没有无项目聊天室。对象仍是 WorkerVersion / Team / Workflow / Task / Run / Artifact。";

export const DIRECT_UNSUPPORTED_NOTE =
  "「去做 / 现在改这个 bug」在 direct 未就绪时是 unsupported_capability，不会渲染成已在跑。";

export const CREATE_WORKER_PROPOSAL_NOTE =
  "这是创建角色提案，不是已发布员工。确认后才会在库中落下未发布草稿。不经 AuthoringSession，也不挂项目。";

export const CREATE_WORKER_LANDED_NOTE =
  "库中已有未发布角色草稿。未发布不能当 Team 成员引用，也不会开始执行。";

export const CREATE_WORKFLOW_NEEDS_PROJECT =
  "创建流程必须先选择项目，才会打开 AuthoringSession。未发布草稿不会被 Runtime 执行。";

export const CREATE_WORKFLOW_PROPOSAL_NOTE =
  "AuthoringSession 返回了待确认提案。确认只会落地未发布 WorkflowDraft，不会发布或执行。";

export const CREATE_WORKFLOW_LANDED_NOTE =
  "未发布工作流草稿已落地。打开画布继续编辑；确认对话不会启动该流程。";

export const UPDATE_WORKER_LANDED_NOTE =
  "已写入角色卡片对应格子。没有创建 Task/Run，也没有收件箱。";

export const UPDATE_WORKER_FORKED_NOTE =
  "已发布版本不可就地改卡片。已 fork 成新草稿并写入该格；源版本三字段未改。";

export const UPDATE_WORKER_NEEDS_TARGET =
  "空闲写卡要草稿 PATCH，或已发布 WorkerVersion 先 fork 再写。还缺 workerDraftId / 可 fork 的版本。没有写入，也没有派活。";

export const INVITE_TEAM_LANDED_NOTE =
  "已把已发布 WorkerVersion 写入该项目的 Team 成员。未发布草稿不会被当成已请来上班。";

export const INVITE_TEAM_UNPUBLISHED_NOTE =
  "成员已写入未发布 Team 草稿。未发布不能绑定到项目执行，也不会开始跑。";

export const INVITE_NEEDS_PUBLISHED_VERSION =
  "请来 Team 必须是已发布且未归档的 workerVersionId。未发布草稿不能当员工。";

export const INVITE_ALREADY_ON_TEAM =
  "该 WorkerVersion 已在该项目 Team 中。没有重复写入，也没有当成新的请来成功。";

export const PROGRESS_FACT_NOTE =
  "只渲染 Daemon 投影里的 Task / Run / Event / Artifact。没有记录就说还没有。";

export const DISCUSS_NEEDS_PROJECT = "交流工作必须先选择项目。没有项目边界不会发写。";

export const DISCUSS_NEEDS_RUN =
  "针对执行中的工作需要挂 runId，才会调用已有 POST /runs/{id}:input。没有挂点不发写。";

export const DISCUSS_SENT_NOTE = "已把内容发给当前 Run 的 input。这不是 Task/Run 完成。";

export const TURN_CONFIRMED_IS_NOT_DONE =
  "Authoring Turn 确认只表示草稿落地，不是目标 Task/Run 完成，也不是已在执行。";

export const NEED_CLARIFICATION_NOTE =
  "分类没有认出来。展示 Daemon 的问题，不发写，也不默认当成交流工作。";

export const CANVAS_DRAFT_VERSION_SEGMENT = "draft";

export const CARD_FIELD_LABELS: Record<WorkerCardFieldName, string> = {
  who: "他是谁",
  how: "怎么干活",
  skills: "会哪些技能",
};

export interface WorkerProposalWrite {
  name: string;
  role: string;
  description?: string;
  who?: string;
  how?: string;
  skills?: string;
}

export interface LandedWorkflowDraft {
  workflowDraftId?: string;
  workflowId?: string;
  revision?: number;
  unpublished: true;
}

export interface IdleCardWriteResult {
  workerId: string;
  draft: WorkerDraftDto;
  cardField: WorkerCardFieldName;
  forkedFromWorkerVersionId?: string;
}

export interface InviteTeamWriteResult {
  projectId: string;
  workerVersionId: string;
  teamId: string;
  teamVersionId: string;
  unpublished: true;
  alreadyMember: boolean;
}

export function newChatId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return `${prefix}_${id}`;
}

export function writeCommandOptions(ifMatch?: number): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: newChatId("idem"),
    operationId: newChatId("op"),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ProblemError) {
    const code = error.problem.code;
    const detail = error.problem.detail || error.problem.title;
    return code ? `${code}：${detail}` : detail;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "请求 Daemon 失败。输入未改写，也没有伪造成成功。";
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof ProblemError) {
    return error.problem.code;
  }
  return undefined;
}

export function isEmptyChatIntent(content: string): boolean {
  return content.trim().length === 0;
}

export function intentKindLabel(kind: ChatIntentDto["kind"]): string {
  switch (kind) {
    case "create_worker":
      return "创建角色";
    case "create_workflow":
      return "创建流程";
    case "query_progress":
      return "询问进度";
    case "discuss_work":
      return "交流工作";
    case "update_worker":
      return "空闲写卡";
    case "invite_team":
      return "请到项目";
  }
}

export function classifiedIntents(
  result: Extract<ChatClassifyResultDto, { outcome: "intent" }>,
): ChatIntentDto[] {
  if (result.intents !== undefined && result.intents.length > 0) {
    return result.intents;
  }
  return [result.intent];
}

export function needContextMessage(missing: ChatNeedContextMissing): string {
  switch (missing) {
    case "projectId":
      return "还缺项目。请到项目、创建流程、问进度、交流工作都要有 projectId。没有写入对象。";
    case "runId":
      return DISCUSS_NEEDS_RUN;
    case "workerId":
      return "还缺角色。空闲写卡和请来 Team 都要能对上 Worker。没有写入对象。";
  }
}

export function createWorkerWriteFromIntent(
  intent: Extract<ChatIntentDto, { kind: "create_worker" }>,
  fallbackText: string,
): WorkerProposalWrite {
  const summary = optionalText(intent.summary) ?? optionalText(fallbackText);
  const who = optionalText(intent.who);
  const how = optionalText(intent.how);
  const skills = optionalText(intent.skills);
  const name = truncateName(who ?? summary ?? "") || "Untitled worker";
  const write: WorkerProposalWrite = { name, role: "worker" };
  if (summary !== undefined) {
    write.description = summary;
  }
  if (who !== undefined) {
    write.who = who;
  }
  if (how !== undefined) {
    write.how = how;
  }
  if (skills !== undefined) {
    write.skills = skills;
  }
  return write;
}

export function createWorkerInputFromWrite(write: WorkerProposalWrite): CreateWorkerInput {
  const input: CreateWorkerInput = {
    name: write.name,
    role: write.role,
  };
  if (write.description !== undefined) {
    input.description = write.description;
  }
  if (write.who !== undefined) {
    input.who = write.who;
  }
  if (write.how !== undefined) {
    input.how = write.how;
  }
  if (write.skills !== undefined) {
    input.skills = write.skills;
  }
  return input;
}

export function workerCardPatch(cardField: WorkerCardFieldName, text: string): WorkerDraftWrite {
  return { [cardField]: text };
}

export function selectablePublishedVersion(worker: WorkerDto): WorkerVersionDto | undefined {
  const versions = worker.versions ?? [];
  if (worker.activeVersionId !== undefined) {
    const active = versions.find((item) => item.id === worker.activeVersionId);
    if (active !== undefined && isSelectableWorkerVersion(active)) {
      return active;
    }
  }
  return versions.find((item) => isSelectableWorkerVersion(item));
}

export function roleLibraryPath(): string {
  return ROLE_LIBRARY_PATH;
}

export function landedDraftCanvasPath(draft: LandedWorkflowDraft): string | null {
  const workflowId = draft.workflowId?.trim();
  return workflowId ? `/workflows/${workflowId}/versions/${CANVAS_DRAFT_VERSION_SEGMENT}` : null;
}

export function progressEmptyMessage(
  projection: Pick<ProjectProgressProjectionDto, "empty" | "emptyDisplay">,
): string {
  if (!projection.empty) {
    return "";
  }
  return projection.emptyDisplay ?? PROJECT_PROGRESS_NO_RECORDS_MESSAGE;
}

export function hasCompletionFact(projection: ProjectProgressProjectionDto): boolean {
  return projection.artifacts.length > 0;
}

export const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

export function isActiveRun(status: string): boolean {
  return !TERMINAL_RUN_STATUSES.has(status);
}

export function classifyUnsupportedAction(
  result: ChatClassifyResultDto,
): "direct" | "im" | undefined {
  return result.outcome === "unsupported" ? result.action : undefined;
}

export function isDirectCapabilityReady(direct: boolean | undefined): boolean {
  return direct === true;
}

export async function landIdleWorkerRemark(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "update_worker" }>,
  fallbackText: string,
): Promise<IdleCardWriteResult> {
  const worker = await client.getWorker(intent.workerId);
  const remark = optionalText(intent.text) ?? optionalText(fallbackText) ?? "";
  const patch = workerCardPatch(intent.cardField, remark);

  if (intent.workerDraftId !== undefined) {
    const draft = await client.getWorkerDraft(intent.workerId, intent.workerDraftId);
    const written = await client.patchWorkerDraft(
      intent.workerId,
      draft.id,
      patch,
      writeCommandOptions(draft.revision),
    );
    return { workerId: intent.workerId, draft: written, cardField: intent.cardField };
  }

  const sourceId = intent.workerVersionId ?? worker.activeVersionId;
  if (sourceId !== undefined) {
    const source = await getWorkerVersionOrNull(client, intent.workerId, sourceId);
    if (source !== null && workerCardFieldsAreImmutable(source)) {
      const forked = await client.forkWorkerVersion(
        intent.workerId,
        source.id,
        writeCommandOptions(),
      );
      const opened = await client.getWorkerDraft(forked.workerId, forked.workerDraftId);
      const written = await client.patchWorkerDraft(
        forked.workerId,
        forked.workerDraftId,
        patch,
        writeCommandOptions(opened.revision),
      );
      return {
        workerId: forked.workerId,
        draft: written,
        cardField: intent.cardField,
        forkedFromWorkerVersionId: forked.forkedFromWorkerVersionId,
      };
    }
  }

  throw new Error(UPDATE_WORKER_NEEDS_TARGET);
}

export async function landInviteTeam(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "invite_team" }>,
): Promise<InviteTeamWriteResult> {
  const project = await client.getProject(intent.projectId);
  const selected = await findSelectableWorkerVersion(client, intent.workerVersionId);
  if (selected === null) {
    throw new Error(INVITE_NEEDS_PUBLISHED_VERSION);
  }
  const incoming: TeamMemberDto = {
    workerVersionId: selected.version.id,
    role: selected.version.role,
    quantity: 1,
  };

  const boundVersionId = optionalText(project.teamVersionId);
  const located =
    boundVersionId === undefined ? null : await findTeamOwningVersion(client, boundVersionId);
  if (located !== null) {
    const written = await writeMemberOntoTeam(client, located.team, located.version, incoming);
    if (written !== null) {
      return {
        projectId: intent.projectId,
        workerVersionId: selected.version.id,
        teamId: written.teamId,
        teamVersionId: written.teamVersionId,
        unpublished: true,
        alreadyMember: written.alreadyMember,
      };
    }
  }

  const members = membersPlus(located?.version.members ?? [], incoming);
  const team = await client.createTeam({ name: `${project.name} Team` }, writeCommandOptions());
  const created = await client.createTeamVersion(
    team.id,
    { members },
    writeCommandOptions(team.stateRevision ?? 1),
  );
  if (created.status === "published") {
    throw new Error("新建 TeamVersion 已是 published；未把请来当成可执行成功。");
  }
  return {
    projectId: intent.projectId,
    workerVersionId: selected.version.id,
    teamId: team.id,
    teamVersionId: created.id,
    unpublished: true,
    alreadyMember: false,
  };
}

async function writeMemberOntoTeam(
  client: DesktopClient,
  team: TeamDto,
  version: TeamVersionDto,
  incoming: TeamMemberDto,
): Promise<{ teamId: string; teamVersionId: string; alreadyMember: boolean } | null> {
  const alreadyMember = teamHasWorkerVersion(version.members, incoming.workerVersionId);
  const members = membersPlus(version.members, incoming);
  if (version.status === "draft" && version.immutable !== true) {
    const patched = await client.patchTeamVersion(
      team.id,
      version.id,
      { members },
      writeCommandOptions(version.stateRevision ?? 1),
    );
    if (patched.status === "published") {
      throw new Error("PATCH TeamVersion 返回 published；未把请来当成新的执行成功。");
    }
    return { teamId: team.id, teamVersionId: patched.id, alreadyMember };
  }
  try {
    const created = await client.createTeamVersion(
      team.id,
      { members },
      writeCommandOptions(team.stateRevision ?? 1),
    );
    if (created.status === "published") {
      throw new Error("新建 TeamVersion 已是 published；未把请来当成可执行成功。");
    }
    return { teamId: team.id, teamVersionId: created.id, alreadyMember };
  } catch (reason: unknown) {
    if (isNotFound(reason) || isInvalidTransition(reason)) {
      return null;
    }
    throw reason instanceof Error ? reason : new Error(errorMessage(reason));
  }
}

async function findSelectableWorkerVersion(
  client: DesktopClient,
  workerVersionId: string,
): Promise<{ workerId: string; version: WorkerVersionDto } | null> {
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 8; pageNo += 1) {
    const query: { status: "published"; limit: number; cursor?: string } = {
      status: "published",
      limit: 100,
    };
    if (cursor !== undefined) {
      query.cursor = cursor;
    }
    const page = await client.listWorkers(query);
    for (const worker of page.items) {
      const version = (worker.versions ?? []).find((item) => item.id === workerVersionId);
      if (version !== undefined && isSelectableWorkerVersion(version)) {
        return { workerId: worker.id, version };
      }
    }
    if (!page.page.hasMore || page.page.nextCursor === null) {
      break;
    }
    cursor = page.page.nextCursor;
  }
  return null;
}

async function findTeamOwningVersion(
  client: DesktopClient,
  teamVersionId: string,
): Promise<{ team: TeamDto; version: TeamVersionDto } | null> {
  const published = await client.listTeams({ limit: 100 });
  const drafts = await client.listTeams({ status: "draft", limit: 100 });
  const items = [...published.items, ...drafts.items];
  const seen = new Set<string>();
  for (const summary of items) {
    if (seen.has(summary.id)) {
      continue;
    }
    seen.add(summary.id);
    const team = await client.getTeam(summary.id);
    const versions = team.versions ?? [];
    const matched =
      versions.find((item) => item.id === teamVersionId) ??
      (team.activeVersionId === teamVersionId
        ? versions.find((item) => item.id === team.activeVersionId)
        : undefined);
    if (matched !== undefined) {
      return { team, version: matched };
    }
    try {
      const version = await client.getTeamVersion(team.id, teamVersionId);
      return { team, version };
    } catch (reason: unknown) {
      if (!isNotFound(reason)) {
        throw reason instanceof Error ? reason : new Error(errorMessage(reason));
      }
    }
  }
  return null;
}

async function getWorkerVersionOrNull(
  client: DesktopClient,
  workerId: string,
  versionId: string,
): Promise<WorkerVersionDto | null> {
  try {
    return await client.getWorkerVersion(workerId, versionId);
  } catch (reason: unknown) {
    if (isNotFound(reason)) {
      return null;
    }
    throw reason instanceof Error ? reason : new Error(errorMessage(reason));
  }
}

function membersPlus(existing: readonly TeamMemberDto[], incoming: TeamMemberDto): TeamMemberDto[] {
  if (teamHasWorkerVersion(existing, incoming.workerVersionId)) {
    return existing.map((member) => ({ ...member }));
  }
  return [...existing.map((member) => ({ ...member })), incoming];
}

function teamHasWorkerVersion(
  members: readonly TeamMemberDto[],
  workerVersionId: string | undefined,
): boolean {
  if (workerVersionId === undefined) {
    return false;
  }
  return members.some((member) => member.workerVersionId === workerVersionId);
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof ProblemError &&
    /not_found|not found/i.test(error.problem.code + error.problem.detail)
  );
}

function isInvalidTransition(error: unknown): boolean {
  return (
    error instanceof ProblemError &&
    /invalid_transition|immutable/i.test(error.problem.code + error.problem.detail)
  );
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function truncateName(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length <= 120) {
    return firstLine;
  }
  return firstLine.slice(0, 120).trim();
}
