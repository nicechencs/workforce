export const CANVAS_PAGE_TITLE_NEW = "新建工作流画布";
export const CANVAS_PAGE_TITLE_EDIT = "在画布中编辑";

export const UNPUBLISHED_RUNTIME_NOTE =
  "未发布，Runtime 不会执行此图。只有发布后的不可变 WorkflowVersion 才能在确认计划后绑定到项目执行。";

export const PROJECT_LOOP_NOTE =
  "画布属于项目制循环：为项目编排可复用工作流，不是脱离项目的通用 IDE，也不是 Runtime。";

export const D02_FREEZE_NOTE =
  "已发布版本不可变。确认计划后的活动执行图按 D02 冻结，不能在画布上原地改。要改流程请新建未发布 version。";

export const EMPTY_CANVAS_NOTE =
  "画布是空的。添加任务、审批、条件或并行节点并连线。未保存的本地草稿不会出现在已发布目录里。";

export const PUBLISH_NEEDS_VALID_DAG =
  "发布前须通过有限 DAG 校验（无循环、无自环、有入口、节点可达）。";

export const SAVE_PRESERVE_NOTE = "保存或发布失败时会保留画布内容，不会假装已发布。";

export const FORK_FROM_PUBLISHED_NOTE =
  "正在从未发布草稿编辑。若从已发布模板进入，这是一份本地新 version，不会改原已发布图。";

export const CATALOG_WITH_CANVAS_NOTE =
  "只读已发布模板与结构化步骤仍可浏览。新建/编辑走画布上的未发布 WorkflowVersion。未发布图不会被 Mock/Codex Runtime 执行。";

export const EMPTY_CATALOG_WITH_CREATE_NOTE =
  "已发布工作流目录为空。可以新建空白画布；未发布草稿不会回退本地夹具冒充已接通，也不会被 Runtime 执行。";
