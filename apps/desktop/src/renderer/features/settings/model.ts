import type { CapabilitiesDto } from "@workforce/desktop-client";

import { LOCAL_HOST_RUNTIME_FIELD, type HostRuntimeView } from "../runtime/model.js";

export function capabilityFlag(value: boolean): string {
  return value ? "支持" : "不支持";
}

export function capabilityRows(
  capabilities: CapabilitiesDto,
  runtime?: HostRuntimeView | null,
): Array<{
  group: string;
  name: string;
  value: string;
}> {
  const rows = [
    { group: "运行", name: "暂停", value: capabilityFlag(capabilities.run.pause) },
    { group: "运行", name: "继续", value: capabilityFlag(capabilities.run.resume) },
    { group: "运行", name: "输入", value: capabilityFlag(capabilities.run.input) },
    { group: "运行", name: "接管", value: capabilityFlag(capabilities.run.takeOver) },
    { group: "项目", name: "暂停", value: capabilityFlag(capabilities.project.pause) },
    { group: "项目", name: "继续", value: capabilityFlag(capabilities.project.resume) },
    { group: "项目", name: "归档", value: capabilityFlag(capabilities.project.archive) },
    {
      group: "编排",
      name: "跟随工作流",
      value: capabilityFlag(capabilities.orchestration?.workflowBound !== false),
    },
    {
      group: "编排",
      name: "直接执行",
      value: capabilityFlag(capabilities.orchestration?.direct === true),
    },
  ];
  if (runtime) {
    rows.unshift(
      { group: "运行时", name: "当前 Host", value: runtime.fieldLabel },
      {
        group: "运行时",
        name: "编码",
        value: runtime.codingReady ? "支持（Codex CLI 已就绪）" : "未就绪（启动会失败）",
      },
    );
  }
  return rows;
}

export function runtimeCapabilityNote(runtime: HostRuntimeView | null | undefined): string {
  if (!runtime) {
    return `${LOCAL_HOST_RUNTIME_FIELD} 是产品默认 Host。能力探测待返回前不当成有本地执行器在干活。`;
  }
  return runtime.summary;
}

export const SETTINGS_TABS = ["appearance", "local", "capabilities"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  appearance: "外观",
  local: "本机",
  capabilities: "能力",
};

export function parseSettingsTab(value: string | null | undefined): SettingsTab {
  if (value === "local" || value === "capabilities") {
    return value;
  }
  return "appearance";
}

export function parseSettingsTabFromHash(hash: string): SettingsTab {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex < 0) {
    return "appearance";
  }
  return parseSettingsTab(new URLSearchParams(trimmed.slice(queryIndex + 1)).get("tab"));
}

export function settingsPath(tab: SettingsTab): string {
  return tab === "appearance" ? "/settings" : `/settings?tab=${tab}`;
}

export const BUDGET_NOTES = [
  "金额使用整数 costMinor 与 ISO-4217 currency，展示层不得把 5.0 当成契约。",
  "未知 / 估算 / 已结算必须区分。未知成本不是 0，也不能拿未知值做硬货币上限。",
  "V0.1 硬约束优先：调度预留、最大运行时长、尝试次数、并发。",
  "货币硬上限只对可计量且可停止的 Runtime 生效。",
] as const;
