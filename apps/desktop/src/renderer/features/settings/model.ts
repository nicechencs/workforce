import type { CapabilitiesDto } from "@workforce/desktop-client";

export function capabilityFlag(value: boolean): string {
  return value ? "支持" : "不支持";
}

export function capabilityRows(capabilities: CapabilitiesDto): Array<{
  group: string;
  name: string;
  value: string;
}> {
  return [
    { group: "运行", name: "暂停", value: capabilityFlag(capabilities.run.pause) },
    { group: "运行", name: "继续", value: capabilityFlag(capabilities.run.resume) },
    { group: "运行", name: "输入", value: capabilityFlag(capabilities.run.input) },
    { group: "运行", name: "接管", value: capabilityFlag(capabilities.run.takeOver) },
    { group: "项目", name: "暂停", value: capabilityFlag(capabilities.project.pause) },
    { group: "项目", name: "继续", value: capabilityFlag(capabilities.project.resume) },
    { group: "项目", name: "归档", value: capabilityFlag(capabilities.project.archive) },
  ];
}

export const BUDGET_NOTES = [
  "金额使用整数 costMinor 与 ISO-4217 currency，展示层不得把 5.0 当成契约。",
  "未知 / 估算 / 已结算必须区分。未知成本不是 0，也不能拿未知值做硬货币上限。",
  "V0.1 硬约束优先：调度预留、最大运行时长、尝试次数、并发。",
  "货币硬上限只对可计量且可停止的 Runtime 生效。",
] as const;
