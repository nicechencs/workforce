export const FEATURE_SLOTS = [
  "dashboard",
  "projects",
  "tasks",
  "teams",
  "runs",
  "workflows",
  "artifacts",
  "approvals",
  "nodes",
  "settings",
] as const;

export type FeatureSlot = (typeof FEATURE_SLOTS)[number];

export type FeatureOwner = "t12" | "t13";

export type NavPriority = "p0" | "p1";

export interface ShellNavItem {
  id: string;
  path: string;
  label: string;
  slot: FeatureSlot;
  owner: FeatureOwner;
  priority: NavPriority;
  primary: boolean;
}

/**
 * Sidebar membership follows IA §2: every 一级导航 row is `primary`.
 * `priority` is slice depth (P0 = M3 path, P1 = thinner V0.1 page), not visibility.
 */
export const SHELL_NAV_ITEMS: readonly ShellNavItem[] = [
  {
    id: "dashboard",
    path: "/",
    label: "工作台",
    slot: "dashboard",
    owner: "t13",
    priority: "p0",
    primary: true,
  },
  {
    id: "projects",
    path: "/projects",
    label: "项目",
    slot: "projects",
    owner: "t12",
    priority: "p0",
    primary: true,
  },
  {
    id: "teams",
    path: "/teams",
    label: "AI 团队",
    slot: "teams",
    owner: "t12",
    priority: "p0",
    primary: true,
  },
  {
    id: "nodes",
    path: "/nodes",
    label: "执行节点",
    slot: "nodes",
    owner: "t13",
    priority: "p0",
    primary: true,
  },
  {
    id: "approvals",
    path: "/approvals",
    label: "审批中心",
    slot: "approvals",
    owner: "t13",
    priority: "p0",
    primary: true,
  },
  {
    id: "runs",
    path: "/runs",
    label: "运行记录",
    slot: "runs",
    owner: "t13",
    priority: "p1",
    primary: true,
  },
  {
    id: "workflows",
    path: "/workflows",
    label: "工作流",
    slot: "workflows",
    owner: "t12",
    priority: "p1",
    primary: true,
  },
  {
    id: "settings",
    path: "/settings",
    label: "设置",
    slot: "settings",
    owner: "t13",
    priority: "p0",
    primary: true,
  },
] as const;

export function primaryNavItems(): ShellNavItem[] {
  return SHELL_NAV_ITEMS.filter((item) => item.primary);
}

export function navItemByPath(path: string): ShellNavItem | undefined {
  return SHELL_NAV_ITEMS.find((item) => item.path === path);
}
