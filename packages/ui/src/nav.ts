export const FEATURE_SLOTS = [
  "dashboard",
  "projects",
  "tasks",
  "teams",
  "role-library",
  "runs",
  "workflows",
  "artifacts",
  "approvals",
  "nodes",
  "settings",
  "chat",
] as const;

export type FeatureSlot = (typeof FEATURE_SLOTS)[number];

export type FeatureOwner = "t11" | "t12" | "t13";

export const ROLE_LIBRARY_PATH = "/role-library";
export const CHAT_PATH = "/chat";
export const WORKFLOW_AUTHORING_PATH = "/workflows/authoring";
export const CHAT_RETURN_STORAGE_KEY = "workforce:chat-return";

/** Full-page role detail. Same list→detail habit as `/teams/:teamId`. */
export function roleLibraryWorkerPath(workerId: string): string {
  const id = workerId.trim();
  return id.length === 0 ? ROLE_LIBRARY_PATH : `${ROLE_LIBRARY_PATH}/${id}`;
}

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
    id: "role-library",
    path: ROLE_LIBRARY_PATH,
    label: "角色库",
    slot: "role-library",
    owner: "t11",
    priority: "p1",
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

/**
 * Global Chat is a shell chrome action + `/chat` route, not a 一级导航
 * row and not a per-worker private inbox.
 */
export const SHELL_CHAT = {
  id: "chat",
  path: CHAT_PATH,
  label: "Chat",
  slot: "chat",
  owner: "t11",
} as const satisfies {
  id: string;
  path: typeof CHAT_PATH;
  label: string;
  slot: FeatureSlot;
  owner: FeatureOwner;
};

export function isChatPath(path: string): boolean {
  const trimmed = path.startsWith("#") ? path.slice(1) : path;
  const withoutQuery = (trimmed.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withSlash === CHAT_PATH;
}

function normalizeStoredNavPath(input: string): string {
  const trimmed = input.startsWith("#") ? input.slice(1) : input;
  if (trimmed.length === 0) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

type SessionStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function chatReturnStorage(): SessionStorageLike | null {
  const candidate = (globalThis as { sessionStorage?: SessionStorageLike }).sessionStorage;
  return candidate ?? null;
}

/** Remember the current hash path before opening Chat, so Chat can return. */
export function rememberChatReturnPath(currentPath: string): void {
  const path = normalizeStoredNavPath(currentPath);
  if (isChatPath(path)) {
    return;
  }
  const storage = chatReturnStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(CHAT_RETURN_STORAGE_KEY, path);
  } catch {
    // Storage may be blocked; Chat falls back to the workbench.
  }
}

export function readChatReturnPath(): string {
  const storage = chatReturnStorage();
  if (storage === null) {
    return "/";
  }
  try {
    const stored = storage.getItem(CHAT_RETURN_STORAGE_KEY);
    if (stored !== null && stored.length > 0 && !isChatPath(stored)) {
      return normalizeStoredNavPath(stored);
    }
  } catch {
    // Storage may be blocked.
  }
  return "/";
}
