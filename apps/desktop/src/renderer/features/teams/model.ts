export const PRESET_TEAM_ID = "software-development-team" as const;
export const LIVE_PRESET_TEAM_ID = "tm_software_development" as const;
export const PRESET_TEAM_VERSION = "0.1.0" as const;
export const PRESET_RUNTIME_ID = "mock" as const;

export const TEAM_ROLES = ["planner", "developer", "reviewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export interface TeamMemberView {
  id: string;
  role: string;
  title: string;
  runtimeProfile: string;
  quantity: number;
}

export interface TeamWorkerView {
  id: string;
  role: string;
  title: string;
  runtime: string;
}

export interface TeamView {
  id: string;
  name: string;
  version: string;
  versionId: string;
  kind: "preset" | "custom";
  status: "published" | "draft";
  readonly: boolean;
  runtime: { adapterId: string; label: string };
  members: TeamMemberView[];
  workers: TeamWorkerView[];
  publishedAt?: string;
  definitionRevision?: number;
  stateRevision?: number;
  versionStateRevision?: number;
}

export const PRESET_MEMBERS: TeamMemberView[] = [
  {
    id: "planner",
    role: "planner",
    title: "Planner",
    runtimeProfile: PRESET_RUNTIME_ID,
    quantity: 1,
  },
  {
    id: "developer",
    role: "developer",
    title: "Developer",
    runtimeProfile: PRESET_RUNTIME_ID,
    quantity: 1,
  },
  {
    id: "reviewer",
    role: "reviewer",
    title: "Reviewer",
    runtimeProfile: PRESET_RUNTIME_ID,
    quantity: 1,
  },
];

export const PRESET_TEAM: TeamView = {
  id: PRESET_TEAM_ID,
  name: "Software Development Team",
  version: PRESET_TEAM_VERSION,
  versionId: PRESET_TEAM_VERSION,
  kind: "preset",
  status: "published",
  readonly: true,
  runtime: { adapterId: PRESET_RUNTIME_ID, label: "Mock" },
  members: PRESET_MEMBERS,
  workers: PRESET_MEMBERS.map(memberToWorker),
};

export const LIVE_CATALOG_NOTE =
  "目录来自 GET /teams。预设 Software Development Team 只读保留；自定义团队必须发布 TeamVersion 后才能绑定到项目。";

export const TEAM_WRITE_API_MISSING =
  "自定义团队写接口尚未接通或探测失败。发布/保存不会成功；预设 Software Development Team 仍只读可用。";

export const UNPUBLISHED_BIND_REASON = "未发布的 Team 草稿不能绑定到项目，也不能开始规划。";

export const CUSTOM_BIND_UNCONFIRMED_REASON =
  "自定义 Team 绑定需要服务端写入并回传精确 teamVersionId。在写 API 确认前，不会启用开始规划。";

export const PUBLISH_NOT_IN_CATALOG_REASON =
  "发布响应已返回，但 GET /teams 仍看不到该已发布团队。未当作发布成功。";

export type TeamActionId = "create" | "edit" | "save" | "publish" | "bind";

export interface TeamWriteSupport {
  methodsPresent: boolean;
  versionRead: boolean;
  create: boolean;
  publish: boolean;
  bind: boolean;
}

export interface TeamWriteOptions {
  idempotencyKey: string;
  operationId?: string;
  ifMatch?: number;
}

export interface TeamMemberWritePayload {
  role: string;
  runtimeProfileId: string;
  quantity: number;
}

export interface TeamWriteClient {
  listTeams?: (query?: { status?: string }) => Promise<{ items: unknown[] }>;
  getTeam?: (id: string) => Promise<unknown>;
  getTeamVersion?: (id: string, versionId: string) => Promise<unknown>;
  createTeam?: (input: { name: string }, options: TeamWriteOptions) => Promise<unknown>;
  patchTeam?: (id: string, input: { name?: string }, options: TeamWriteOptions) => Promise<unknown>;
  createTeamVersion?: (
    id: string,
    input: { members: TeamMemberWritePayload[] },
    options: TeamWriteOptions,
  ) => Promise<unknown>;
  patchTeamVersion?: (
    id: string,
    versionId: string,
    input: { members: TeamMemberWritePayload[] },
    options: TeamWriteOptions,
  ) => Promise<unknown>;
  publishTeamVersion?: (
    id: string,
    versionId: string,
    options: TeamWriteOptions,
  ) => Promise<unknown>;
  patchProject?: (
    id: string,
    input: { teamVersionId: string },
    options: TeamWriteOptions,
  ) => Promise<unknown>;
}

export interface TeamPageModel {
  readonly: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canBind: boolean;
  saveLooksSuccessful: false;
  publishLooksSuccessful: false;
  actions: TeamActionId[];
  teams: TeamView[];
  source: "preset" | "live";
  note: string | null;
  writeSupport: TeamWriteSupport;
}

export interface TeamBindSelection {
  teamId: string;
  versionId: string;
  status: "published" | "draft";
  kind: "preset" | "custom";
}

export interface TeamDraftForm {
  name: string;
  members: TeamMemberView[];
  teamId: string | null;
  versionId: string | null;
  teamStatus: "draft" | "published";
  definitionRevision?: number;
  teamStateRevision?: number;
  versionStateRevision?: number;
  error: string | null;
  needsRefresh: boolean;
  submitting: boolean;
  lastAction: "idle" | "save" | "publish";
  saved: boolean;
  published: boolean;
}

export type TeamDraftFormEvent =
  | { type: "changeName"; value: string }
  | { type: "setMembers"; members: TeamMemberView[] }
  | { type: "submit"; action: "save" | "publish" }
  | {
      type: "saved";
      teamId: string;
      versionId: string;
      definitionRevision?: number;
      teamStateRevision?: number;
      versionStateRevision?: number;
    }
  | { type: "published"; teamId: string; versionId: string }
  | { type: "failure"; error: unknown; keepPublished?: boolean };

export function unavailableTeamWriteSupport(): TeamWriteSupport {
  return {
    methodsPresent: false,
    versionRead: false,
    create: false,
    publish: false,
    bind: false,
  };
}

export function teamWriteMethodsPresent(client: TeamWriteClient): boolean {
  return (
    typeof client.createTeam === "function" &&
    typeof client.patchTeam === "function" &&
    typeof client.createTeamVersion === "function" &&
    typeof client.patchTeamVersion === "function" &&
    typeof client.publishTeamVersion === "function" &&
    typeof client.getTeam === "function" &&
    typeof client.getTeamVersion === "function"
  );
}

export function supportFromFlags(input: {
  methodsPresent: boolean;
  versionRead: boolean;
  bindMethod: boolean;
}): TeamWriteSupport {
  const live = input.methodsPresent && input.versionRead;
  return {
    methodsPresent: input.methodsPresent,
    versionRead: input.versionRead,
    create: live,
    publish: live,
    bind: live && input.bindMethod,
  };
}

export async function probeTeamWriteSupport(client: TeamWriteClient): Promise<TeamWriteSupport> {
  const methodsPresent = teamWriteMethodsPresent(client);
  const bindMethod = typeof client.patchProject === "function";
  if (!methodsPresent || typeof client.getTeamVersion !== "function") {
    return supportFromFlags({ methodsPresent, versionRead: false, bindMethod });
  }
  const versionRead = await probePublishedVersionRead(client);
  return supportFromFlags({ methodsPresent, versionRead, bindMethod });
}

async function probePublishedVersionRead(client: TeamWriteClient): Promise<boolean> {
  if (typeof client.getTeamVersion !== "function") {
    return false;
  }
  try {
    const preset = await client.getTeamVersion(LIVE_PRESET_TEAM_ID, PRESET_TEAM_VERSION);
    if (isTeamVersionPayload(preset)) {
      return true;
    }
  } catch {
    // Fall through to the published catalog; listTeams never includes drafts.
  }
  try {
    const page = client.listTeams ? await client.listTeams() : { items: [] };
    const first = page.items.map(asTeamView).find((item): item is TeamView => item !== null);
    if (!first) {
      return false;
    }
    const version = await client.getTeamVersion(first.id, first.versionId || first.version);
    return isTeamVersionPayload(version);
  } catch {
    return false;
  }
}

export function teamPageModel(
  input: {
    liveTeams?: TeamView[] | null;
    writeSupport?: TeamWriteSupport;
  } = {},
): TeamPageModel {
  const writeSupport = input.writeSupport ?? unavailableTeamWriteSupport();
  const canWrite = writeSupport.create;
  const actions: TeamActionId[] = canWrite ? ["create", "edit", "save", "publish"] : [];
  const live = input.liveTeams;
  if (live && live.length > 0) {
    return {
      readonly: !canWrite,
      canCreate: canWrite,
      canEdit: canWrite,
      canPublish: writeSupport.publish,
      canBind: writeSupport.bind,
      saveLooksSuccessful: false,
      publishLooksSuccessful: false,
      actions,
      teams: mergeCatalogTeams(live),
      source: "live",
      note: null,
      writeSupport,
    };
  }
  return {
    readonly: !canWrite,
    canCreate: canWrite,
    canEdit: canWrite,
    canPublish: writeSupport.publish,
    canBind: writeSupport.bind,
    saveLooksSuccessful: false,
    publishLooksSuccessful: false,
    actions,
    teams: [PRESET_TEAM],
    source: "preset",
    note: writeSupport.create
      ? LIVE_CATALOG_NOTE
      : `${LIVE_CATALOG_NOTE} ${TEAM_WRITE_API_MISSING}`,
    writeSupport,
  };
}

export function createTeamButton(support: TeamWriteSupport): {
  testId: "team-create";
  enabled: boolean;
  looksSuccessful: false;
  label: string;
  reason: string | null;
} {
  if (!support.create) {
    return {
      testId: "team-create",
      enabled: false,
      looksSuccessful: false,
      label: "新建团队",
      reason: TEAM_WRITE_API_MISSING,
    };
  }
  return {
    testId: "team-create",
    enabled: true,
    looksSuccessful: false,
    label: "新建团队",
    reason: null,
  };
}

export function publishTeamButton(support: TeamWriteSupport): {
  testId: "team-publish";
  enabled: boolean;
  looksSuccessful: false;
  label: string;
  reason: string | null;
} {
  if (!support.publish) {
    return {
      testId: "team-publish",
      enabled: false,
      looksSuccessful: false,
      label: "发布 TeamVersion",
      reason: TEAM_WRITE_API_MISSING,
    };
  }
  return {
    testId: "team-publish",
    enabled: true,
    looksSuccessful: false,
    label: "发布 TeamVersion",
    reason: null,
  };
}

export function rejectCustomTeamSave(support?: TeamWriteSupport): { ok: false; reason: string } {
  if (!support?.create) {
    return { ok: false, reason: TEAM_WRITE_API_MISSING };
  }
  return { ok: false, reason: "保存未完成：尚未收到已确认的 Team 草稿响应。" };
}

export function rejectCustomTeamPublish(support?: TeamWriteSupport): { ok: false; reason: string } {
  if (!support?.publish) {
    return { ok: false, reason: TEAM_WRITE_API_MISSING };
  }
  return { ok: false, reason: "发布未完成：响应不是带 published 状态的不可变 TeamVersion。" };
}

export function isPresetTeamId(id: string): boolean {
  return id === PRESET_TEAM_ID || id === LIVE_PRESET_TEAM_ID;
}

export function isPublishedTeamVersion(value: unknown): boolean {
  if (!isTeamVersionPayload(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.status !== "published" || record.immutable !== true) {
    return false;
  }
  if (record.publishedAt !== undefined) {
    return typeof record.publishedAt === "string" && record.publishedAt.length > 0;
  }
  return true;
}

export function isTeamVersionPayload(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const version = typeof record.version === "string" ? record.version : null;
  return Boolean(id || version);
}

export function interpretPublishResponse(
  value: unknown,
):
  | { ok: true; published: true; versionId: string }
  | { ok: false; published: false; reason: string } {
  if (!isPublishedTeamVersion(value)) {
    return {
      ok: false,
      published: false,
      reason: rejectCustomTeamPublish(
        supportFromFlags({ methodsPresent: true, versionRead: true, bindMethod: true }),
      ).reason,
    };
  }
  const record = value as Record<string, unknown>;
  const versionId =
    (typeof record.id === "string" && record.id) ||
    (typeof record.version === "string" && record.version) ||
    "";
  if (!versionId) {
    return { ok: false, published: false, reason: "发布响应缺少 TeamVersion id。" };
  }
  return { ok: true, published: true, versionId };
}

export function canBindTeamVersion(
  team: Pick<TeamView, "id" | "status" | "kind" | "versionId">,
): boolean {
  if (team.status !== "published") {
    return false;
  }
  return hasExactTeamVersionId(team);
}

export function hasExactTeamVersionId(
  team: Pick<TeamView, "id" | "kind" | "versionId">,
): boolean {
  if (team.versionId.length === 0) {
    return false;
  }
  if (team.kind === "custom" && team.versionId === team.id) {
    return false;
  }
  return true;
}

export function rejectUnpublishedBind(team: Pick<TeamView, "status">): {
  ok: boolean;
  reason: string | null;
} {
  if (team.status !== "published") {
    return { ok: false, reason: UNPUBLISHED_BIND_REASON };
  }
  return { ok: true, reason: null };
}

export function projectTeamVersionId(project: unknown): string | null {
  if (typeof project !== "object" || project === null) {
    return null;
  }
  const record = project as Record<string, unknown>;
  return typeof record.teamVersionId === "string" && record.teamVersionId.length > 0
    ? record.teamVersionId
    : null;
}

export function isTeamReadyForPlanning(input: {
  selection: TeamBindSelection | null;
  projectTeamVersionId: string | null;
}): boolean {
  if (!input.selection || input.selection.status !== "published") {
    return false;
  }
  if (input.selection.kind === "preset" || isPresetTeamId(input.selection.teamId)) {
    return true;
  }
  if (
    !hasExactTeamVersionId({
      id: input.selection.teamId,
      kind: input.selection.kind,
      versionId: input.selection.versionId,
    })
  ) {
    return false;
  }
  return input.projectTeamVersionId === input.selection.versionId;
}

export function bindableTeams(teams: TeamView[]): TeamView[] {
  return teams.filter((team) => canBindTeamVersion(team));
}

export function unpublishedTeams(teams: TeamView[]): TeamView[] {
  return teams.filter((team) => team.status === "draft");
}

export function mergeCatalogTeams(live: TeamView[]): TeamView[] {
  const mapped = live.map((team) =>
    isPresetTeamId(team.id) || team.name === PRESET_TEAM.name
      ? { ...team, kind: "preset" as const, readonly: true, status: "published" as const }
      : team,
  );
  const hasPreset = mapped.some((team) => team.kind === "preset" || isPresetTeamId(team.id));
  return hasPreset ? mapped : [PRESET_TEAM, ...mapped];
}

export function asTeamView(value: unknown): TeamView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  const active = pickActiveVersion(record);
  const name = typeof record.name === "string" ? record.name : record.id;
  const version =
    (typeof record.version === "string" && record.version.length > 0
      ? record.version
      : undefined) ??
    (active && typeof active.version === "string" ? active.version : undefined) ??
    PRESET_TEAM_VERSION;
  const status = record.status === "draft" ? "draft" : "published";
  const kind = isPresetTeamId(record.id) || name === PRESET_TEAM.name ? "preset" : "custom";
  const versionId = pickExactTeamVersionId(record, active, version, kind);
  const members = parseMembers(record, active);
  const publishedAt =
    typeof record.publishedAt === "string"
      ? record.publishedAt
      : typeof active?.publishedAt === "string"
        ? active.publishedAt
        : undefined;
  const definitionRevision =
    typeof record.definitionRevision === "number" ? record.definitionRevision : undefined;
  const stateRevision = typeof record.stateRevision === "number" ? record.stateRevision : undefined;
  const versionStateRevision =
    typeof active?.stateRevision === "number" ? active.stateRevision : undefined;
  return {
    id: record.id,
    name,
    version,
    versionId,
    kind,
    status,
    readonly: kind === "preset" || status === "published",
    runtime: { adapterId: PRESET_RUNTIME_ID, label: runtimeLabel(members) },
    members,
    workers: members.map(memberToWorker),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(definitionRevision !== undefined ? { definitionRevision } : {}),
    ...(stateRevision !== undefined ? { stateRevision } : {}),
    ...(versionStateRevision !== undefined ? { versionStateRevision } : {}),
  };
}

function pickActiveVersion(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(record.versions)) {
    return null;
  }
  const versions = record.versions.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
  const activeId = typeof record.activeVersionId === "string" ? record.activeVersionId : null;
  if (activeId) {
    const matched = versions.find(
      (item) =>
        item.id === activeId || item.version === activeId || item.teamVersionId === activeId,
    );
    if (matched) {
      return matched;
    }
  }
  if (record.status === "draft") {
    const draft = versions.find((item) => item.status === "draft");
    if (draft) {
      return draft;
    }
  }
  return (
    versions.find((item) => item.status === "published") ?? versions[versions.length - 1] ?? null
  );
}

function pickExactTeamVersionId(
  record: Record<string, unknown>,
  active: Record<string, unknown> | null,
  versionLabel: string,
  kind: "preset" | "custom",
): string {
  const teamId = typeof record.id === "string" ? record.id : "";
  const candidates = [
    typeof record.activeVersionId === "string" ? record.activeVersionId : null,
    typeof record.teamVersionId === "string" ? record.teamVersionId : null,
    typeof record.versionId === "string" ? record.versionId : null,
    active && typeof active.id === "string" ? active.id : null,
  ].filter((item): item is string => Boolean(item && item.length > 0));
  const exact =
    candidates.find((id) => id !== teamId && id !== versionLabel) ?? candidates[0] ?? "";
  if (kind === "custom") {
    return exact !== teamId ? exact : "";
  }
  return exact.length > 0 ? exact : versionLabel;
}

function parseMembers(
  record: Record<string, unknown>,
  active: Record<string, unknown> | null,
): TeamMemberView[] {
  if (active && Array.isArray(active.members)) {
    const parsed = active.members
      .map((item, index) => asMemberView(item, index))
      .filter((item): item is TeamMemberView => item !== null);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  if (Array.isArray(record.members)) {
    const parsed = record.members
      .map((item, index) => asMemberView(item, index))
      .filter((item): item is TeamMemberView => item !== null);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  if (Array.isArray(record.workers)) {
    const parsed = record.workers
      .map((item, index) => asMemberView(item, index))
      .filter((item): item is TeamMemberView => item !== null);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  if (Array.isArray(record.roles)) {
    const parsed = record.roles
      .map((item, index) => asRoleMember(item, index))
      .filter((item): item is TeamMemberView => item !== null);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return PRESET_MEMBERS;
}

function asMemberView(value: unknown, index: number): TeamMemberView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string" && record.role.length > 0 ? record.role : null;
  if (!role) {
    return null;
  }
  const id = typeof record.id === "string" ? record.id : `${role}-${index}`;
  const title = typeof record.title === "string" ? record.title : roleLabel(role);
  const runtimeProfile =
    typeof record.runtimeProfileId === "string"
      ? record.runtimeProfileId
      : typeof record.runtimeProfile === "string"
        ? record.runtimeProfile
        : typeof record.runtime === "string"
          ? record.runtime
          : PRESET_RUNTIME_ID;
  const quantity = parseQuantity(record.quantity);
  return { id, role, title, runtimeProfile, quantity };
}

function asRoleMember(value: unknown, index: number): TeamMemberView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : null;
  if (!role) {
    return null;
  }
  const id = typeof record.id === "string" ? record.id : `${role}-${index}`;
  return {
    id,
    role,
    title: roleLabel(role),
    runtimeProfile: PRESET_RUNTIME_ID,
    quantity: 1,
  };
}

export function parseQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed >= 1) {
      return parsed;
    }
  }
  return 1;
}

export function draftMembersValid(members: TeamMemberView[]): boolean {
  return (
    members.length > 0 &&
    members.every(
      (member) =>
        member.role.trim().length > 0 &&
        member.runtimeProfile.trim().length > 0 &&
        Number.isInteger(member.quantity) &&
        member.quantity >= 1,
    )
  );
}

export function emptyTeamDraftForm(): TeamDraftForm {
  return {
    name: "",
    members: PRESET_MEMBERS.map((member) => ({ ...member })),
    teamId: null,
    versionId: null,
    teamStatus: "draft",
    error: null,
    needsRefresh: false,
    submitting: false,
    lastAction: "idle",
    saved: false,
    published: false,
  };
}

export function draftFormFromTeam(team: TeamView): TeamDraftForm {
  return {
    name: team.name,
    members: team.members.map((member) => ({ ...member })),
    teamId: team.id,
    versionId: team.status === "draft" ? team.versionId : null,
    teamStatus: team.status,
    ...(team.definitionRevision !== undefined
      ? { definitionRevision: team.definitionRevision }
      : {}),
    ...(team.stateRevision !== undefined ? { teamStateRevision: team.stateRevision } : {}),
    ...(team.versionStateRevision !== undefined
      ? { versionStateRevision: team.versionStateRevision }
      : {}),
    error: null,
    needsRefresh: false,
    submitting: false,
    lastAction: "idle",
    saved: team.status === "draft",
    published: team.status === "published",
  };
}

export function reduceTeamDraftForm(
  state: TeamDraftForm,
  event: TeamDraftFormEvent,
): TeamDraftForm {
  switch (event.type) {
    case "changeName":
      return { ...state, name: event.value, error: null, published: false };
    case "setMembers":
      return { ...state, members: event.members, error: null, published: false, saved: false };
    case "submit":
      return {
        ...state,
        submitting: true,
        error: null,
        needsRefresh: false,
        lastAction: event.action,
      };
    case "saved":
      return {
        ...state,
        submitting: false,
        error: null,
        needsRefresh: false,
        saved: true,
        published: false,
        teamId: event.teamId,
        versionId: event.versionId,
        teamStatus: "draft",
        ...(event.definitionRevision !== undefined
          ? { definitionRevision: event.definitionRevision }
          : {}),
        ...(event.teamStateRevision !== undefined
          ? { teamStateRevision: event.teamStateRevision }
          : {}),
        ...(event.versionStateRevision !== undefined
          ? { versionStateRevision: event.versionStateRevision }
          : {}),
      };
    case "published":
      return {
        ...state,
        submitting: false,
        error: null,
        needsRefresh: false,
        saved: true,
        published: true,
        teamId: event.teamId,
        versionId: event.versionId,
      };
    case "failure":
      return applyDraftFailure(state, event.error, event.keepPublished === true);
  }
}

export function applyDraftFailure(
  form: TeamDraftForm,
  error: unknown,
  keepPublished = false,
): TeamDraftForm {
  const conflict = isRevisionConflictError(error);
  return {
    ...form,
    submitting: false,
    needsRefresh: conflict,
    published: keepPublished ? form.published : false,
    saved: form.saved,
    error: conflict
      ? "版本冲突（412 revision_conflict）。已保留你的成员编辑，请刷新后再提交。"
      : errorMessage(error),
  };
}

function isRevisionConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as { status?: number; problem?: { code?: string }; message?: string };
  if (record.status === 412 || record.problem?.code === "revision_conflict") {
    return true;
  }
  return typeof record.message === "string" && record.message.includes("revision_conflict");
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as { problem?: { detail?: string; title?: string }; message?: string };
    if (typeof record.problem?.detail === "string" && record.problem.detail.length > 0) {
      return record.problem.detail;
    }
    if (typeof record.problem?.title === "string" && record.problem.title.length > 0) {
      return record.problem.title;
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
  }
  return "请求失败";
}

export function defaultMember(role: string, index = 0): TeamMemberView {
  return {
    id: `${role}-${index}`,
    role,
    title: roleLabel(role),
    runtimeProfile: PRESET_RUNTIME_ID,
    quantity: 1,
  };
}

export function addDraftMember(members: TeamMemberView[], role = "developer"): TeamMemberView[] {
  return [...members, defaultMember(role, members.length)];
}

export function updateDraftMember(
  members: TeamMemberView[],
  index: number,
  patch: Partial<TeamMemberView>,
): TeamMemberView[] {
  return members.map((member, current) =>
    current === index
      ? {
          ...member,
          ...patch,
          title: patch.role ? roleLabel(patch.role) : (patch.title ?? member.title),
        }
      : member,
  );
}

export function removeDraftMember(members: TeamMemberView[], index: number): TeamMemberView[] {
  return members.filter((_, current) => current !== index);
}

export function membersToPayload(members: TeamMemberView[]): TeamMemberWritePayload[] {
  return members.map((member) => ({
    role: member.role,
    runtimeProfileId: member.runtimeProfile,
    quantity: member.quantity,
  }));
}

export function writeOptions(ifMatch?: number): TeamWriteOptions {
  const bytes = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  const options: TeamWriteOptions = {
    idempotencyKey: `idem_${bytes}`,
    operationId: `op_${bytes}`,
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readId(value: unknown): string | null {
  const record = asRecord(value);
  return record && typeof record.id === "string" && record.id.length > 0 ? record.id : null;
}

function readStateRevision(value: unknown): number | undefined {
  const record = asRecord(value);
  return record &&
    typeof record.stateRevision === "number" &&
    Number.isInteger(record.stateRevision)
    ? record.stateRevision
    : undefined;
}

export async function loadPublishedTeamCatalog(client: TeamWriteClient): Promise<TeamView[]> {
  if (typeof client.listTeams !== "function") {
    return [];
  }
  const published = await client.listTeams();
  const byId = new Map<string, TeamView>();
  for (const item of published.items) {
    const view = asTeamView(item);
    if (view && view.status === "published") {
      byId.set(view.id, view);
    }
  }
  return [...byId.values()];
}

export function findPublishedCatalogTeam(
  teams: TeamView[],
  input: { teamId: string; versionId: string },
): TeamView | null {
  return (
    teams.find(
      (team) =>
        team.id === input.teamId &&
        team.status === "published" &&
        team.versionId === input.versionId &&
        canBindTeamVersion(team),
    ) ?? null
  );
}

export async function confirmTeamPublishedInCatalog(
  client: TeamWriteClient,
  input: { teamId: string; versionId: string },
): Promise<{ ok: true; team: TeamView } | { ok: false; reason: string }> {
  if (typeof client.listTeams !== "function") {
    return { ok: false, reason: TEAM_WRITE_API_MISSING };
  }
  let catalog: TeamView[];
  try {
    catalog = await loadPublishedTeamCatalog(client);
  } catch (caught) {
    return { ok: false, reason: errorMessage(caught) };
  }
  const found = findPublishedCatalogTeam(catalog, input);
  if (!found) {
    return { ok: false, reason: PUBLISH_NOT_IN_CATALOG_REASON };
  }
  return { ok: true, team: found };
}

export async function loadTeamCatalog(client: TeamWriteClient): Promise<TeamView[]> {
  if (typeof client.listTeams !== "function") {
    return [];
  }
  const published = await loadPublishedTeamCatalog(client);
  const draftPage = await client.listTeams({ status: "draft" }).catch(() => ({ items: [] }));
  const byId = new Map<string, TeamView>();
  for (const item of draftPage.items) {
    const view = asTeamView(item);
    if (view) {
      byId.set(view.id, view);
    }
  }
  for (const team of published) {
    byId.set(team.id, team);
  }
  return [...byId.values()];
}

export async function loadTeamDetail(
  client: TeamWriteClient,
  teamId: string,
  catalog: TeamView[] = [],
): Promise<TeamView | null> {
  if (typeof client.getTeam === "function") {
    try {
      const loaded = asTeamView(await client.getTeam(teamId));
      if (loaded) {
        return loaded;
      }
    } catch {
      // Drafts are absent from GET /teams; a missing GET /teams/{id} is a real miss.
    }
  }
  return (
    teamById(catalog, teamId) ??
    (isPresetTeamId(teamId) || teamId === PRESET_TEAM.id ? PRESET_TEAM : null)
  );
}

export interface PersistTeamDraftInput {
  name: string;
  members: TeamMemberView[];
  teamId: string | null;
  versionId: string | null;
  teamStatus?: "draft" | "published";
  teamStateRevision?: number;
  versionStateRevision?: number;
}

export interface PersistTeamDraftResult {
  teamId: string;
  versionId: string;
  teamStateRevision?: number;
  versionStateRevision?: number;
  team: TeamView;
}

export async function persistTeamDraft(
  client: TeamWriteClient,
  input: PersistTeamDraftInput,
  options: (ifMatch?: number) => TeamWriteOptions = writeOptions,
): Promise<PersistTeamDraftResult> {
  if (!teamWriteMethodsPresent(client)) {
    throw new Error(TEAM_WRITE_API_MISSING);
  }
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("团队名称不能为空。");
  }
  if (!draftMembersValid(input.members)) {
    throw new Error("成员必须包含 role、RuntimeProfile 与 quantity ≥ 1。");
  }
  const members = membersToPayload(input.members);
  let teamId = input.teamId;
  let versionId = input.versionId;
  let teamStateRevision = input.teamStateRevision;
  let versionStateRevision = input.versionStateRevision;

  if (!teamId) {
    const created = await client.createTeam!({ name }, options());
    const createdId = readId(created);
    if (!createdId) {
      throw new Error("createTeam 未返回 Team id，未当作草稿成功。");
    }
    teamId = createdId;
    teamStateRevision = readStateRevision(created);
  } else if (input.teamStatus !== "published") {
    const patched = await client.patchTeam!(teamId, { name }, options(teamStateRevision));
    teamStateRevision = readStateRevision(patched) ?? teamStateRevision;
  }

  if (!versionId) {
    const version = await client.createTeamVersion!(
      teamId,
      { members },
      options(teamStateRevision),
    );
    const createdVersionId = readId(version);
    const record = asRecord(version);
    if (!createdVersionId) {
      throw new Error("createTeamVersion 未返回 Version id，未当作草稿成功。");
    }
    if (record?.status === "published") {
      throw new Error("创建版本的响应已是 published；未当作可继续编辑的草稿成功态。");
    }
    versionId = createdVersionId;
    versionStateRevision = readStateRevision(version);
  } else {
    const version = await client.patchTeamVersion!(
      teamId,
      versionId,
      { members },
      options(versionStateRevision),
    );
    versionId = readId(version) ?? versionId;
    versionStateRevision = readStateRevision(version) ?? versionStateRevision;
  }

  const confirmed = await loadTeamDetail(client, teamId);
  if (!confirmed) {
    throw new Error("保存后 GET /teams/{id} 未返回该团队，未当作草稿成功。");
  }
  const resolvedVersionId = confirmed.versionId || versionId;
  return {
    teamId,
    versionId: resolvedVersionId,
    ...(confirmed.stateRevision !== undefined
      ? { teamStateRevision: confirmed.stateRevision }
      : teamStateRevision !== undefined
        ? { teamStateRevision }
        : {}),
    ...(confirmed.versionStateRevision !== undefined
      ? { versionStateRevision: confirmed.versionStateRevision }
      : versionStateRevision !== undefined
        ? { versionStateRevision }
        : {}),
    team: { ...confirmed, versionId: resolvedVersionId },
  };
}

export async function publishPersistedTeamVersion(
  client: TeamWriteClient,
  input: { teamId: string; versionId: string; versionStateRevision?: number },
  options: (ifMatch?: number) => TeamWriteOptions = writeOptions,
): Promise<
  | { ok: true; published: true; versionId: string; team: TeamView }
  | { ok: false; published: false; reason: string }
> {
  if (typeof client.publishTeamVersion !== "function") {
    return { ok: false, published: false, reason: TEAM_WRITE_API_MISSING };
  }
  const response = await client.publishTeamVersion(
    input.teamId,
    input.versionId,
    options(input.versionStateRevision),
  );
  const interpreted = interpretPublishResponse(response);
  if (!interpreted.ok) {
    return interpreted;
  }
  const visible = await confirmTeamPublishedInCatalog(client, {
    teamId: input.teamId,
    versionId: interpreted.versionId,
  });
  if (!visible.ok) {
    return { ok: false, published: false, reason: visible.reason };
  }
  return {
    ok: true,
    published: true,
    versionId: interpreted.versionId,
    team: visible.team,
  };
}

export async function bindProjectToPublishedTeamVersion(
  client: TeamWriteClient,
  input: {
    projectId: string;
    team: Pick<TeamView, "id" | "kind" | "status" | "versionId">;
    projectStateRevision?: number;
  },
): Promise<{ ok: true; teamVersionId: string; project: unknown } | { ok: false; reason: string }> {
  if (input.team.status !== "published") {
    return { ok: false, reason: UNPUBLISHED_BIND_REASON };
  }
  if (input.team.kind !== "custom" || !canBindTeamVersion(input.team)) {
    return { ok: false, reason: CUSTOM_BIND_UNCONFIRMED_REASON };
  }
  if (typeof client.patchProject !== "function") {
    return { ok: false, reason: TEAM_WRITE_API_MISSING };
  }
  const patched = await client.patchProject(
    input.projectId,
    { teamVersionId: input.team.versionId },
    writeOptions(input.projectStateRevision),
  );
  const echoed = projectTeamVersionId(patched);
  if (echoed !== input.team.versionId) {
    return { ok: false, reason: CUSTOM_BIND_UNCONFIRMED_REASON };
  }
  return { ok: true, teamVersionId: echoed, project: patched };
}

export function teamById(teams: TeamView[], teamId: string): TeamView | null {
  return teams.find((team) => team.id === teamId) ?? null;
}

export function roleLabel(role: string): string {
  switch (role) {
    case "planner":
      return "Planner";
    case "developer":
      return "Developer";
    case "reviewer":
      return "Reviewer";
    default:
      return role;
  }
}

function runtimeLabel(members: TeamMemberView[]): string {
  const profile = members[0]?.runtimeProfile ?? PRESET_RUNTIME_ID;
  return profile === PRESET_RUNTIME_ID ? "Mock" : profile;
}

function memberToWorker(member: TeamMemberView): TeamWorkerView {
  return {
    id: member.id,
    role: member.role,
    title: member.title,
    runtime: member.runtimeProfile === PRESET_RUNTIME_ID ? "Mock" : member.runtimeProfile,
  };
}
