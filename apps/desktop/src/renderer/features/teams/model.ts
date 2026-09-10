export const PRESET_TEAM_ID = "software-development-team" as const;
export const PRESET_TEAM_VERSION = "0.1.0" as const;
export const PRESET_RUNTIME_ID = "mock" as const;

export interface TeamWorkerView {
  id: string;
  role: "planner" | "developer" | "reviewer";
  title: string;
  runtime: string;
}

export interface TeamView {
  id: string;
  name: string;
  version: string;
  readonly: true;
  runtime: { adapterId: string; label: string };
  workers: TeamWorkerView[];
}

export const PRESET_TEAM: TeamView = {
  id: PRESET_TEAM_ID,
  name: "Software Development Team",
  version: PRESET_TEAM_VERSION,
  readonly: true,
  runtime: { adapterId: PRESET_RUNTIME_ID, label: "Mock" },
  workers: [
    { id: "planner", role: "planner", title: "Planner", runtime: "Mock" },
    { id: "developer", role: "developer", title: "Developer", runtime: "Mock" },
    { id: "reviewer", role: "reviewer", title: "Reviewer", runtime: "Mock" },
  ],
};

export const LIVE_CATALOG_NOTE =
  "实时目录来自 GET /teams（可用时接入）。当前显示预设 Software Development Team。";

export type TeamActionId = "create" | "edit" | "save";

export interface TeamPageModel {
  readonly: true;
  canCreate: false;
  canEdit: false;
  saveLooksSuccessful: false;
  actions: TeamActionId[];
  teams: TeamView[];
  source: "preset" | "live";
  note: string | null;
}

export function teamPageModel(input: { liveTeams?: TeamView[] | null } = {}): TeamPageModel {
  const live = input.liveTeams;
  if (live && live.length > 0) {
    return {
      readonly: true,
      canCreate: false,
      canEdit: false,
      saveLooksSuccessful: false,
      actions: [],
      teams: live.map((team) => ({ ...team, readonly: true })),
      source: "live",
      note: null,
    };
  }
  return {
    readonly: true,
    canCreate: false,
    canEdit: false,
    saveLooksSuccessful: false,
    actions: [],
    teams: [PRESET_TEAM],
    source: "preset",
    note: LIVE_CATALOG_NOTE,
  };
}

export function rejectCustomTeamSave(): { ok: false; reason: string } {
  return { ok: false, reason: "自定义团队编排后置，当前仅只读预设，不会保存成功。" };
}

export function asTeamView(value: unknown): TeamView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  const name = typeof record.name === "string" ? record.name : record.id;
  const version = typeof record.version === "string" ? record.version : PRESET_TEAM_VERSION;
  const workers = Array.isArray(record.workers)
    ? record.workers
        .map((item) => asWorkerView(item))
        .filter((item): item is TeamWorkerView => item !== null)
    : PRESET_TEAM.workers;
  return {
    id: record.id,
    name,
    version,
    readonly: true,
    runtime: { adapterId: PRESET_RUNTIME_ID, label: "Mock" },
    workers: workers.length > 0 ? workers : PRESET_TEAM.workers,
  };
}

function asWorkerView(value: unknown): TeamWorkerView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = record.role;
  if (role !== "planner" && role !== "developer" && role !== "reviewer") {
    return null;
  }
  const id = typeof record.id === "string" ? record.id : role;
  const title = typeof record.title === "string" ? record.title : role;
  return { id, role, title, runtime: "Mock" };
}

export function teamById(teams: TeamView[], teamId: string): TeamView | null {
  return teams.find((team) => team.id === teamId) ?? null;
}
