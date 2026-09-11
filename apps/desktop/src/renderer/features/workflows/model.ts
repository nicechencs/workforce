export const FEATURE_DELIVERY_WORKFLOW_ID = "software-development-team.feature-delivery" as const;
export const FEATURE_DELIVERY_VERSION = "0.1.0" as const;

export type WorkflowStepKind = "task" | "delivery" | "approval";
export type WorkflowCatalogSource = "loading" | "live" | "empty" | "unavailable";

export interface WorkflowStepView {
  id: string;
  kind: WorkflowStepKind;
  title: string;
  worker?: string;
  gate?: "plan" | "artifact";
  notes: string[];
}

export interface WorkflowVersionView {
  id: string;
  version: string;
  status: "published" | "draft";
  immutable: true;
  entry: string;
  steps: WorkflowStepView[];
}

export interface WorkflowTemplateView {
  id: string;
  name: string;
  description: string;
  activeVersionId: string;
  versions: WorkflowVersionView[];
  readonly: true;
}

export const FEATURE_DELIVERY_STEPS: WorkflowStepView[] = [
  {
    id: "planning",
    kind: "task",
    title: "规划",
    worker: "planner",
    gate: "plan",
    notes: ["产出 Plan Artifact", "发布 workflowVersion"],
  },
  {
    id: "implementation",
    kind: "task",
    title: "实现",
    worker: "developer",
    notes: ["并行", "节点模式 dev_*", "上游 outputs_ready", "不等待 reviewer 即可完成"],
  },
  {
    id: "integration",
    kind: "delivery",
    title: "整合",
    notes: ["按 stable Node ID 顺序", "独立 integration worktree", "冲突转人工"],
  },
  {
    id: "review",
    kind: "task",
    title: "审查",
    worker: "reviewer",
    notes: ["上游 outputs_ready", "绑定 integration digest"],
  },
  {
    id: "acceptance",
    kind: "approval",
    title: "验收",
    gate: "artifact",
    notes: ["绑定 integration digest"],
  },
];

export const FEATURE_DELIVERY_VERSION_VIEW: WorkflowVersionView = {
  id: FEATURE_DELIVERY_VERSION,
  version: FEATURE_DELIVERY_VERSION,
  status: "published",
  immutable: true,
  entry: "planning",
  steps: FEATURE_DELIVERY_STEPS,
};

export const FEATURE_DELIVERY_WORKFLOW: WorkflowTemplateView = {
  id: FEATURE_DELIVERY_WORKFLOW_ID,
  name: "Feature delivery",
  description:
    "确认 Plan Artifact，按稳定 Node ID 整合两个隔离 Developer Task，再对同一 digest 做 Review 与人工产物审批。",
  activeVersionId: FEATURE_DELIVERY_VERSION,
  versions: [FEATURE_DELIVERY_VERSION_VIEW],
  readonly: true,
};

export const CATALOG_LOADING_NOTE = "正在读取已发布工作流目录…";
export const LIVE_CATALOG_NOTE =
  "只读已发布模板与结构化步骤。不是画布编辑器，也不表示 Mock/Codex Runtime 可执行这些定义。";
export const EMPTY_CATALOG_NOTE =
  "已发布工作流目录为空。此页只读展示已发布模板、版本和结构化步骤，不会回退本地夹具冒充已接通。";
export const UNAVAILABLE_CATALOG_NOTE =
  "无法读取 GET /workflows。目录未加载；不回退到本地夹具冒充已接通。";

export type WorkflowActionId = "create" | "edit" | "canvas";

export interface WorkflowPageModel {
  readonly: true;
  canCreate: false;
  canEdit: false;
  hasCanvasEditor: false;
  actions: WorkflowActionId[];
  workflows: WorkflowTemplateView[];
  source: WorkflowCatalogSource;
  note: string;
}

export function workflowPageModel(
  input: {
    liveWorkflows?: WorkflowTemplateView[] | null;
    status?: "loading" | "ok" | "empty" | "error";
  } = {},
): WorkflowPageModel {
  const base = {
    readonly: true as const,
    canCreate: false as const,
    canEdit: false as const,
    hasCanvasEditor: false as const,
    actions: [] as WorkflowActionId[],
  };
  const live = input.liveWorkflows;
  if (live && live.length > 0) {
    return {
      ...base,
      workflows: live.map((workflow) => ({ ...workflow, readonly: true })),
      source: "live",
      note: LIVE_CATALOG_NOTE,
    };
  }
  if (input.status === "empty" || (Array.isArray(live) && live.length === 0)) {
    return { ...base, workflows: [], source: "empty", note: EMPTY_CATALOG_NOTE };
  }
  if (input.status === "error") {
    return { ...base, workflows: [], source: "unavailable", note: UNAVAILABLE_CATALOG_NOTE };
  }
  return { ...base, workflows: [], source: "loading", note: CATALOG_LOADING_NOTE };
}

export function rejectWorkflowCanvas(): { ok: false; reason: string } {
  return {
    ok: false,
    reason: "V0.1 不提供可视化 Workflow 编辑器；页面只展示模板、版本和结构化步骤。",
  };
}

export function asWorkflowView(value: unknown): WorkflowTemplateView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  const name = typeof record.name === "string" ? record.name : record.id;
  const description = typeof record.description === "string" ? record.description : "";
  const versions = Array.isArray(record.versions)
    ? record.versions
        .map((item) => asVersionView(item))
        .filter((item): item is WorkflowVersionView => item !== null)
    : [];
  const fallback = versions[0]?.id ?? "";
  const activeVersionId =
    typeof record.activeVersionId === "string" ? record.activeVersionId : fallback;
  return {
    id: record.id,
    name,
    description,
    activeVersionId,
    versions,
    readonly: true,
  };
}

function asVersionView(value: unknown): WorkflowVersionView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version : null;
  const id = typeof record.id === "string" ? record.id : version;
  if (!id || !version) {
    return null;
  }
  const status = record.status === "draft" ? "draft" : "published";
  const steps = Array.isArray(record.steps)
    ? record.steps
        .map((item) => asStepView(item))
        .filter((item): item is WorkflowStepView => item !== null)
    : [];
  return {
    id,
    version,
    status,
    immutable: true,
    entry: typeof record.entry === "string" ? record.entry : "",
    steps,
  };
}

function asStepView(value: unknown): WorkflowStepView | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") {
    return null;
  }
  const kind = record.kind;
  if (kind !== "task" && kind !== "delivery" && kind !== "approval") {
    return null;
  }
  const title = typeof record.title === "string" ? record.title : record.id;
  const notes = Array.isArray(record.notes)
    ? record.notes.filter((item): item is string => typeof item === "string")
    : [];
  const step: WorkflowStepView = { id: record.id, kind, title, notes };
  if (typeof record.worker === "string") {
    step.worker = record.worker;
  }
  if (record.gate === "plan" || record.gate === "artifact") {
    step.gate = record.gate;
  }
  return step;
}

export function workflowById(
  workflows: WorkflowTemplateView[],
  workflowId: string,
): WorkflowTemplateView | null {
  return workflows.find((workflow) => workflow.id === workflowId) ?? null;
}

export function versionById(
  workflow: WorkflowTemplateView,
  versionId: string | undefined,
): WorkflowVersionView | null {
  if (versionId !== undefined && versionId.length > 0) {
    return (
      workflow.versions.find((item) => item.id === versionId || item.version === versionId) ?? null
    );
  }
  return (
    workflow.versions.find((item) => item.id === workflow.activeVersionId) ??
    workflow.versions[0] ??
    null
  );
}

export function stepKindLabel(kind: WorkflowStepKind): string {
  switch (kind) {
    case "task":
      return "任务";
    case "delivery":
      return "交付";
    case "approval":
      return "审批";
  }
}
