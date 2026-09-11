import {
  DEFAULT_ORCHESTRATION_MODE,
  isOrchestrationMode,
  type OrchestrationMode,
} from "@workforce/protocol";
import type {
  CapabilitiesDto,
  RuntimeCapabilitiesDto,
  StartProjectInput,
} from "@workforce/desktop-client";

/** Frozen D18 field. Old name `executionMode` is not accepted. */
export const ORCHESTRATION_MODES = ["workflow_bound", "direct"] as const;
export type { OrchestrationMode };

export const DEFAULT_MODE = DEFAULT_ORCHESTRATION_MODE;

export const DIRECT_CAPABILITY_NAME = "orchestration.direct";

export const DIRECT_UNSUPPORTED =
  "当前 capability probe 未声明 orchestration.direct。已禁用直接执行，避免假 mode。错误码：unsupported_capability。这不是生产 Codex direct，也不是 D19 Placement。";

export const WORKFLOW_BOUND_COPY =
  "跟随已发布工作流：只执行该项目已确认、已发布 WorkflowVersion 中轮到的节点。";

export const DIRECT_COPY =
  "直接执行：按当前任务目标即席执行，仍走 Policy、Workspace、预算与 Approval。不是 Renderer 直接 spawn。";

export const SLICE_NOTE =
  "T21 UI 切片：仅项目「开始执行」写入现有 POST /projects/{id}:start 的 orchestrationMode。Task 详情不挂未接线控件。不发明 /runs/{id}:direct。不宣称 M8 完成、headed PASS 或生产 Codex direct。";

export const MODE_LABELS: Record<OrchestrationMode, string> = {
  workflow_bound: "跟随已发布工作流",
  direct: "直接执行",
};

export interface OrchestrationProbe {
  workflowBound: true;
  direct: boolean;
  source: "capabilities" | "runtime" | "missing";
  reason: string;
}

export interface OrchestrationStartAccepted {
  ok: true;
  input: StartProjectInput;
}

export interface OrchestrationStartRefused {
  ok: false;
  code: "unsupported_capability";
  error: string;
}

export type OrchestrationStartResult = OrchestrationStartAccepted | OrchestrationStartRefused;

export function emptyOrchestrationProbe(): OrchestrationProbe {
  return {
    workflowBound: true,
    direct: false,
    source: "missing",
    reason: DIRECT_UNSUPPORTED,
  };
}

export function probeOrchestrationSupport(input: {
  capabilities?: CapabilitiesDto | null;
  runtimeCapabilities?: RuntimeCapabilitiesDto | null;
}): OrchestrationProbe {
  if (input.capabilities?.orchestration?.direct === true) {
    return {
      workflowBound: true,
      direct: true,
      source: "capabilities",
      reason: "GET /capabilities 声明 orchestration.direct。仍不是生产 Codex direct 验收。",
    };
  }
  const runtimeHit = input.runtimeCapabilities?.capabilities.some(
    (item) => item.name === DIRECT_CAPABILITY_NAME && item.available,
  );
  if (runtimeHit === true) {
    return {
      workflowBound: true,
      direct: true,
      source: "runtime",
      reason: "Runtime probe 声明 orchestration.direct。仍不是生产 Codex direct 验收。",
    };
  }
  return emptyOrchestrationProbe();
}

export function resolveSelectedMode(
  selected: OrchestrationMode,
  probe: OrchestrationProbe,
): OrchestrationMode {
  if (selected === "direct" && !probe.direct) {
    return DEFAULT_MODE;
  }
  return selected;
}

export function canSelectMode(mode: OrchestrationMode, probe: OrchestrationProbe): boolean {
  if (mode === "workflow_bound") {
    return true;
  }
  return probe.direct;
}

export function buildStartProjectInput(
  selected: OrchestrationMode,
  probe: OrchestrationProbe,
): OrchestrationStartResult {
  if (!isOrchestrationMode(selected)) {
    return {
      ok: false,
      code: "unsupported_capability",
      error: DIRECT_UNSUPPORTED,
    };
  }
  if (selected === "direct" && !probe.direct) {
    return {
      ok: false,
      code: "unsupported_capability",
      error: DIRECT_UNSUPPORTED,
    };
  }
  return {
    ok: true,
    input: { orchestrationMode: resolveSelectedMode(selected, probe) },
  };
}
