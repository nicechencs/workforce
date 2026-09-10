/** IA §4.3.2 稳定 id。可见文案见 PROJECT_DETAIL_TAB_LABELS。 */
export const PROJECT_DETAIL_TABS = [
  "overview",
  "tasks",
  "runs",
  "artifacts",
  "activity",
  "settings",
] as const;

export type ProjectDetailTab = (typeof PROJECT_DETAIL_TABS)[number];

export const PROJECT_DETAIL_TAB_LABELS: Record<ProjectDetailTab, string> = {
  overview: "概览",
  tasks: "Tasks",
  runs: "Runs",
  artifacts: "Artifacts",
  activity: "Activity",
  settings: "Settings",
};

const TAB_SET = new Set<string>(PROJECT_DETAIL_TABS);

export function isProjectDetailTab(value: string): value is ProjectDetailTab {
  return TAB_SET.has(value);
}

export function parseProjectDetailTab(value: string | null | undefined): ProjectDetailTab {
  if (value !== undefined && value !== null && isProjectDetailTab(value)) {
    return value;
  }
  return "overview";
}

export function parseTabFromHash(hash: string): ProjectDetailTab {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex < 0) {
    return "overview";
  }
  const query = trimmed.slice(queryIndex + 1);
  return parseProjectDetailTab(new URLSearchParams(query).get("tab"));
}

export function hashWithProjectTab(path: string, tab: ProjectDetailTab): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const withoutQuery = normalized.split("?")[0] ?? normalized;
  if (tab === "overview") {
    return `#${withoutQuery}`;
  }
  return `#${withoutQuery}?tab=${tab}`;
}

export function projectDetailPath(projectId: string): string {
  return `/projects/${projectId}`;
}
