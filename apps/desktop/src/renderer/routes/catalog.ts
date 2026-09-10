import { FEATURE_SLOTS, type FeatureOwner, type FeatureSlot } from "@workforce/ui";

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
] as const;

export const FEATURE_ENTRY_SLOTS = FEATURE_SLOTS;
