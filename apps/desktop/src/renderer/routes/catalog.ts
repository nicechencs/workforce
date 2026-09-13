import {
  CHAT_PATH,
  FEATURE_SLOTS,
  ROLE_LIBRARY_PATH,
  type FeatureOwner,
  type FeatureSlot,
} from "@workforce/ui";

export interface ShellRoute {
  id: string;
  path: string;
  title: string;
  slot: FeatureSlot;
  owner: FeatureOwner;
  placeholder: true;
}

export const SHELL_ROUTES: readonly ShellRoute[] = [
  {
    id: "dashboard",
    path: "/",
    title: "工作台",
    slot: "dashboard",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "projects",
    path: "/projects",
    title: "项目",
    slot: "projects",
    owner: "t12",
    placeholder: true,
  },
  {
    id: "project",
    path: "/projects/:projectId",
    title: "项目详情",
    slot: "projects",
    owner: "t12",
    placeholder: true,
  },
  {
    id: "task",
    path: "/projects/:projectId/tasks/:taskId",
    title: "任务详情",
    slot: "tasks",
    owner: "t12",
    placeholder: true,
  },
  { id: "teams", path: "/teams", title: "AI 团队", slot: "teams", owner: "t12", placeholder: true },
  {
    id: "team",
    path: "/teams/:teamId",
    title: "团队详情",
    slot: "teams",
    owner: "t12",
    placeholder: true,
  },
  {
    id: "role-library",
    path: ROLE_LIBRARY_PATH,
    title: "角色版本库",
    slot: "role-library",
    owner: "t11",
    placeholder: true,
  },
  {
    id: "nodes",
    path: "/nodes",
    title: "执行节点",
    slot: "nodes",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "node",
    path: "/nodes/:nodeId",
    title: "节点详情",
    slot: "nodes",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "approvals",
    path: "/approvals",
    title: "审批中心",
    slot: "approvals",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "approval",
    path: "/approvals/:approvalId",
    title: "审批卡",
    slot: "approvals",
    owner: "t13",
    placeholder: true,
  },
  { id: "runs", path: "/runs", title: "运行记录", slot: "runs", owner: "t13", placeholder: true },
  {
    id: "run",
    path: "/runs/:runId",
    title: "Run 控制台",
    slot: "runs",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "workflows",
    path: "/workflows",
    title: "工作流",
    slot: "workflows",
    owner: "t12",
    placeholder: true,
  },
  {
    id: "workflow",
    path: "/workflows/:workflowId",
    title: "工作流详情",
    slot: "workflows",
    owner: "t12",
    placeholder: true,
  },
  {
    id: "workflow-version",
    path: "/workflows/:workflowId/versions/:versionId",
    title: "工作流版本",
    slot: "workflows",
    owner: "t12",
    placeholder: true,
  },
  {
    id: "artifact-version",
    path: "/artifacts/:artifactId/versions/:versionId",
    title: "产物",
    slot: "artifacts",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "settings",
    path: "/settings",
    title: "设置",
    slot: "settings",
    owner: "t13",
    placeholder: true,
  },
  {
    id: "chat",
    path: CHAT_PATH,
    title: "Chat",
    slot: "chat",
    owner: "t11",
    placeholder: true,
  },
] as const;

export const FEATURE_ENTRY_SLOTS = FEATURE_SLOTS;

/** Slots reserved by T11. Feature pages glob-load later; missing module is an unwired empty shell. */
export const UNWIRED_SHELL_SLOTS: readonly FeatureSlot[] = ["role-library", "chat"];

export function isUnwiredShellSlot(slot: FeatureSlot | undefined): boolean {
  return slot !== undefined && (UNWIRED_SHELL_SLOTS as readonly FeatureSlot[]).includes(slot);
}

export function unwiredShellDescription(slot: FeatureSlot | undefined): string | undefined {
  if (slot === "chat") {
    return "全局语言入口尚未接通。创建角色、创建流程、询问进度和交流工作需要库与 Chat 契约及 Daemon HTTP；当前没有写接口，不能把对话当成已创建或已完成。";
  }
  if (slot === "role-library") {
    return "角色版本库尚未接通。查找、搜索、引用关系和归档需要库契约及 Daemon HTTP；当前没有写接口，不能把条目当成已创建或已发布。";
  }
  return undefined;
}
