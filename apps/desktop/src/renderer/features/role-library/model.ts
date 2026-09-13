import {
  ProblemError,
  type CommandOptions,
  type CreateWorkerInput,
  type DesktopClient,
  type ForkWorkerVersionAcceptedDto,
  type ListWorkersInput,
  type WorkerCardFieldsDto,
  type WorkerDraftDto,
  type WorkerDraftWrite,
  type WorkerDto,
  type WorkerVersionDto,
  type WorkerVersionReferencesDto,
} from "@workforce/desktop-client";
import {
  isEditableWorkerDraft,
  isPublishedWorkerVersion,
  isSelectableWorkerVersion,
  workerCardFieldNames,
  workerCardFieldsAreImmutable,
  type WorkerCardFieldName,
  type WorkerDefinitionStatus,
} from "@workforce/protocol";

export type LibraryTone = "success" | "warning" | "muted";

export const LIBRARY_PAGE_LIMIT = 50;

export const LIBRARY_API_MISSING =
  "角色版本库接口尚未接通。列表、搜索、引用、归档、fork、新建、发布和卡片 PATCH 都不会成功。";

export const UNPUBLISHED_NOT_EMPLOYEE =
  "未发布草稿不是已发布员工，不能给 Team 选用，也不能当成已发布 WorkerVersion。";

export const ARCHIVE_NOT_PUBLISHED = "只有已发布且不可变的 WorkerVersion 才能归档。";

export const FORK_NOT_PUBLISHED = "只有已发布且不可变的 WorkerVersion 才能 fork。";

export const FORK_NOT_DRAFT = "fork 响应不是新草稿，未当作已发布员工。";

export const ARCHIVE_NOT_CONFIRMED = "归档响应仍显示未归档，未从选择器移除。";

export const CARD_EMPTY = "空";

export const CARD_READ_ONLY =
  "已发布版本的卡片只读，不能就地保存。要改谁 / 怎么干活 / 技能，请 fork 出新草稿。源版本不会被改。";

export const CARD_DRAFT_HINT =
  "未发布草稿可以改这三格并 PATCH。Runtime / Policy 不是卡片必填，请入 Team 时再选。";

export const CARD_UNPUBLISHED_NO_DRAFT =
  "还没有打开草稿，三格按空显示，不能就地保存。已发布版本请 fork，得到新草稿后再改。";

export const PUBLISHED_CARD_NOT_PATCHABLE = "已发布卡片不能就地保存。请 fork 新草稿后再改。";

export const DRAFT_NOT_EDITABLE = "这份草稿不是可编辑草稿，未当作已发布员工，也没有写入卡片。";

export const DRAFT_REVISION_CONFLICT =
  "版本冲突（412 revision_conflict）。已保留你输入的三格，请刷新后再保存。";

export const CARD_PATCH_NOT_CONFIRMED = "PATCH 响应不是未发布草稿，未当作已发布员工。";

export const PUBLISH_NOT_DRAFT = "只有未发布草稿才能发布。已发布版本请 fork。";

export const PUBLISH_NOT_CONFIRMED = "发布响应不是已发布 WorkerVersion，未当作已发布员工。";

export const CREATE_ROLE_NEEDS_NAME_ROLE = "名称和职责都要填。不挂项目，也不选 Runtime / Policy。";

export interface CardFieldSpec {
  id: WorkerCardFieldName;
  label: string;
  hint: string;
}

export const CARD_FIELDS: readonly CardFieldSpec[] = [
  { id: "who", label: "他是谁", hint: "身份 / 职责称呼。空则显式空，不拿名称或 Runtime 顶替。" },
  { id: "how", label: "怎么干活", hint: "做事方式、偏好、属于角色自己的约束。" },
  { id: "skills", label: "会哪些技能", hint: "会做什么。不是 Policy、席位或 Placement。" },
];

export type CardForm = Record<WorkerCardFieldName, string>;

export type LibraryStatusFilter = "all" | WorkerDefinitionStatus;

export interface LibraryQuery {
  q: string;
  status: LibraryStatusFilter;
  includeArchived: boolean;
}

export interface LibraryCatalog {
  workers: WorkerDto[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SelectableVersionOption {
  workerId: string;
  workerName: string;
  version: WorkerVersionDto;
}

export const STATUS_FILTER_ITEMS: readonly { id: LibraryStatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "published", label: "已发布" },
  { id: "draft", label: "草稿" },
];

export const ARCHIVED_FILTER_ITEMS: readonly { id: "hide" | "include"; label: string }[] = [
  { id: "hide", label: "不显示已归档" },
  { id: "include", label: "含已归档" },
];

export function emptyLibraryQuery(): LibraryQuery {
  return { q: "", status: "all", includeArchived: false };
}

export function workerLibraryMethodsPresent(client: DesktopClient): boolean {
  return (
    typeof client.listWorkers === "function" &&
    typeof client.getWorker === "function" &&
    typeof client.getWorkerVersion === "function" &&
    typeof client.getWorkerVersionReferences === "function" &&
    typeof client.getWorkerDraft === "function" &&
    typeof client.archiveWorkerVersion === "function" &&
    typeof client.forkWorkerVersion === "function" &&
    typeof client.patchWorkerDraft === "function" &&
    typeof client.createWorker === "function" &&
    typeof client.publishWorkerDraft === "function"
  );
}

export function listWorkersInput(query: LibraryQuery, cursor?: string): ListWorkersInput {
  const input: ListWorkersInput = { limit: LIBRARY_PAGE_LIMIT };
  const q = query.q.trim();
  if (q.length > 0) {
    input.q = q;
  }
  if (query.status !== "all") {
    input.status = query.status;
  }
  if (query.includeArchived) {
    input.includeArchived = true;
  }
  if (cursor !== undefined && cursor.length > 0) {
    input.cursor = cursor;
  }
  return input;
}

export async function loadWorkerCatalog(
  client: DesktopClient,
  query: LibraryQuery,
  cursor?: string,
): Promise<LibraryCatalog> {
  const page = await client.listWorkers(listWorkersInput(query, cursor));
  return {
    workers: page.items,
    nextCursor: page.page.nextCursor,
    hasMore: page.page.hasMore,
  };
}

export function mergeWorkerPage(current: WorkerDto[], incoming: WorkerDto[]): WorkerDto[] {
  const incomingById = new Map(incoming.map((item) => [item.id, item]));
  const updated = current.map((item) => incomingById.get(item.id) ?? item);
  const seen = new Set(current.map((item) => item.id));
  return [...updated, ...incoming.filter((item) => !seen.has(item.id))];
}

export function replaceWorker(workers: WorkerDto[], next: WorkerDto): WorkerDto[] {
  let found = false;
  const mapped = workers.map((item) => {
    if (item.id !== next.id) {
      return item;
    }
    found = true;
    return next;
  });
  return found ? mapped : [next, ...workers];
}

export function prependWorker(workers: WorkerDto[], next: WorkerDto): WorkerDto[] {
  return [next, ...workers.filter((item) => item.id !== next.id)];
}

export function applyArchivedToWorker(
  worker: WorkerDto,
  archived: WorkerVersionDto,
  includeArchived: boolean,
): WorkerDto {
  return applyArchivedVersion([worker], archived, includeArchived)[0] ?? worker;
}

export function applyArchivedVersion(
  workers: WorkerDto[],
  archived: WorkerVersionDto,
  includeArchived: boolean,
): WorkerDto[] {
  return workers.map((worker) => {
    if (worker.id !== archived.workerId) {
      return worker;
    }
    const versions = worker.versions ?? [];
    const nextVersions = includeArchived
      ? versions.map((item) => (item.id === archived.id ? archived : item))
      : versions.filter((item) => item.id !== archived.id);
    return { ...worker, versions: nextVersions };
  });
}

export function selectableVersionOptions(workers: readonly WorkerDto[]): SelectableVersionOption[] {
  const options: SelectableVersionOption[] = [];
  for (const worker of workers) {
    if (worker.status !== "published") {
      continue;
    }
    for (const version of worker.versions ?? []) {
      if (!isSelectableWorkerVersion(version)) {
        continue;
      }
      options.push({ workerId: worker.id, workerName: worker.name, version });
    }
  }
  return options;
}

export function isUnpublishedWorker(worker: Pick<WorkerDto, "status">): boolean {
  return worker.status !== "published";
}

export function canArchiveVersion(version: WorkerVersionDto): boolean {
  return isPublishedWorkerVersion(version) && version.archived === false;
}

export function canForkVersion(version: WorkerVersionDto): boolean {
  return isPublishedWorkerVersion(version);
}

export function canPatchCardDraft(draft: WorkerDraftDto | null | undefined): boolean {
  return draft !== null && draft !== undefined && isEditableWorkerDraft(draft);
}

export function canPublishDraft(
  worker: Pick<WorkerDto, "status"> | null | undefined,
  draft: WorkerDraftDto | null | undefined,
): boolean {
  return worker !== null && worker !== undefined && isUnpublishedWorker(worker) && canPatchCardDraft(draft);
}

export function confirmPublishedVersion(version: WorkerVersionDto): WorkerVersionDto {
  if (!isPublishedWorkerVersion(version)) {
    throw new Error(PUBLISH_NOT_CONFIRMED);
  }
  return version;
}

export interface CreateRoleForm {
  name: string;
  role: string;
  who: string;
  how: string;
  skills: string;
}

export function emptyCreateRoleForm(): CreateRoleForm {
  return { name: "", role: "", who: "", how: "", skills: "" };
}

export function createRoleFormValid(form: CreateRoleForm): boolean {
  return form.name.trim().length > 0 && form.role.trim().length > 0;
}

export function createWorkerInputFromForm(form: CreateRoleForm): CreateWorkerInput {
  const input: CreateWorkerInput = {
    name: form.name.trim(),
    role: form.role.trim(),
  };
  if (form.who.length > 0) {
    input.who = form.who;
  }
  if (form.how.length > 0) {
    input.how = form.how;
  }
  if (form.skills.length > 0) {
    input.skills = form.skills;
  }
  return input;
}

export function confirmCreatedDraft(worker: WorkerDto): WorkerDto {
  if (worker.status !== "draft") {
    throw new Error("创建结果不是未发布草稿，已拒绝当成已发布员工。");
  }
  return worker;
}

export function activeDraftIdOf(worker: WorkerDto): string | undefined {
  return worker.activeDraftId;
}

export function isPublishedCardLocked(version: WorkerVersionDto | null | undefined): boolean {
  return version !== null && version !== undefined && workerCardFieldsAreImmutable(version);
}

export function cardSourceOf(
  draft: WorkerDraftDto | null | undefined,
  version: WorkerVersionDto | null | undefined,
): WorkerCardFieldsDto | null {
  if (draft !== null && draft !== undefined) {
    return draft;
  }
  if (version !== null && version !== undefined) {
    return version;
  }
  return null;
}

export function cardFieldText(
  source: WorkerCardFieldsDto | null | undefined,
  field: WorkerCardFieldName,
): string {
  const value = source?.[field];
  return typeof value === "string" ? value : "";
}

export function cardFieldDisplay(value: string | undefined): string {
  return value === undefined || value.length === 0 ? CARD_EMPTY : value;
}

export function isCardFieldEmpty(value: string | undefined): boolean {
  return value === undefined || value.length === 0;
}

export function emptyCardForm(source: WorkerCardFieldsDto | null | undefined): CardForm {
  return {
    who: cardFieldText(source, "who"),
    how: cardFieldText(source, "how"),
    skills: cardFieldText(source, "skills"),
  };
}

export function cardWriteFromForm(form: CardForm): WorkerDraftWrite {
  return {
    who: form.who,
    how: form.how,
    skills: form.skills,
  };
}

export function cardFormDirty(
  form: CardForm,
  source: WorkerCardFieldsDto | null | undefined,
): boolean {
  return workerCardFieldNames.some((key) => form[key] !== cardFieldText(source, key));
}

export function confirmPatchedDraft(draft: WorkerDraftDto): WorkerDraftDto {
  if (draft.status !== "draft") {
    throw new Error(CARD_PATCH_NOT_CONFIRMED);
  }
  return draft;
}

export function isLibraryRevisionConflict(error: unknown): boolean {
  return (
    error instanceof ProblemError &&
    (error.status === 412 || error.problem.code === "revision_conflict")
  );
}

export function workerBadge(worker: WorkerDto): { label: string; tone: LibraryTone } {
  if (isUnpublishedWorker(worker)) {
    return { label: "未发布草稿", tone: "warning" };
  }
  return { label: "已发布", tone: "success" };
}

export function versionBadge(version: WorkerVersionDto): { label: string; tone: LibraryTone } {
  if (!isPublishedWorkerVersion(version)) {
    return { label: "未发布", tone: "warning" };
  }
  if (version.archived) {
    return { label: "已归档", tone: "muted" };
  }
  return { label: "可选用", tone: "success" };
}

export function workerListMeta(worker: WorkerDto): string {
  if (isUnpublishedWorker(worker)) {
    return "未发布 · 不可选用";
  }
  const versions = worker.versions ?? [];
  const selectable = versions.filter((item) => isSelectableWorkerVersion(item)).length;
  const archived = versions.filter((item) => item.archived).length;
  const parts = [`${versions.length} 个版本`, `${selectable} 可选用`];
  if (archived > 0) {
    parts.push(`${archived} 已归档`);
  }
  return parts.join(" · ");
}

export function versionOptionLabel(option: SelectableVersionOption): string {
  return `${option.workerName} · ${option.version.version} · ${option.version.id}`;
}

export function activeVersionOf(worker: WorkerDto): WorkerVersionDto | undefined {
  const versions = worker.versions ?? [];
  if (worker.activeVersionId !== undefined) {
    const active = versions.find((item) => item.id === worker.activeVersionId);
    if (active !== undefined) {
      return active;
    }
  }
  return versions.find((item) => isSelectableWorkerVersion(item)) ?? versions[0];
}

export function confirmArchived(version: WorkerVersionDto): WorkerVersionDto {
  if (!isPublishedWorkerVersion(version) || version.archived !== true) {
    throw new Error(ARCHIVE_NOT_CONFIRMED);
  }
  return version;
}

export function confirmForkedDraft(
  accepted: ForkWorkerVersionAcceptedDto,
  worker: WorkerDto | null,
  draft: WorkerDraftDto | null,
): {
  accepted: ForkWorkerVersionAcceptedDto;
  worker: WorkerDto | null;
  draft: WorkerDraftDto | null;
} {
  if (worker !== null && worker.status === "published") {
    throw new Error(FORK_NOT_DRAFT);
  }
  if (draft !== null && draft.status !== "draft") {
    throw new Error(FORK_NOT_DRAFT);
  }
  if (draft !== null && draft.workerId !== accepted.workerId) {
    throw new Error(FORK_NOT_DRAFT);
  }
  return { accepted, worker, draft };
}

export function libraryCommandOptions(ifMatch?: number): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export function libraryErrorMessage(error: unknown): string {
  if (error instanceof ProblemError) {
    return error.problem.detail || error.problem.title;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败";
}

export function referenceMeta(item: WorkerVersionReferencesDto["teamVersions"][number]): string {
  const status = item.status === "published" ? "已发布 TeamVersion" : "Team 草稿";
  return `${status} · ${item.teamId}`;
}
