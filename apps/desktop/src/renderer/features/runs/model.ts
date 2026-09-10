import type { CapabilitiesDto, RunDto } from "@workforce/desktop-client";
import { isRunStatus, isUnknownCost } from "@workforce/protocol";

export const RUN_STATUS_LABELS: Record<string, string> = {
  pending: "等待中",
  starting: "启动中",
  running: "运行中",
  waiting_input: "等待输入",
  paused: "已暂停",
  succeeded: "已成功",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
};

export const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

export function isActiveRun(run: Pick<RunDto, "status">): boolean {
  return !TERMINAL_RUN_STATUSES.has(run.status);
}

export function isUnknownRunRecovery(status: string): boolean {
  return !isRunStatus(status);
}

export function runStatusLabel(
  run: Pick<RunDto, "status" | "cancelRequested">,
  options: { cancelAccepted?: boolean } = {},
): string {
  const cancelRequested = run.cancelRequested || options.cancelAccepted === true;
  if (run.status === "cancelled") {
    return "已取消";
  }
  if (cancelRequested) {
    return "取消中";
  }
  if (isUnknownRunRecovery(run.status)) {
    return "状态未知";
  }
  return RUN_STATUS_LABELS[run.status] ?? "状态未知";
}

export function canCancelRun(
  run: Pick<RunDto, "status" | "cancelRequested">,
  options: { cancelAccepted?: boolean } = {},
): boolean {
  if (options.cancelAccepted === true || run.cancelRequested) {
    return false;
  }
  return isActiveRun(run);
}

/** Run console never offers a dangerous rerun; unknown recovery especially must not. */
export function canOfferRerun(status: string): boolean {
  void status;
  return false;
}

export function shouldShowPause(capabilities: CapabilitiesDto | null | undefined): boolean {
  return capabilities?.run.pause === true;
}

export function shouldShowResume(capabilities: CapabilitiesDto | null | undefined): boolean {
  return capabilities?.run.resume === true;
}

export function shouldShowInput(
  run: Pick<RunDto, "status">,
  capabilities: CapabilitiesDto | null | undefined,
): boolean {
  return run.status === "waiting_input" && capabilities?.run.input === true;
}

export function shouldShowTakeOver(capabilities: CapabilitiesDto | null | undefined): boolean {
  return capabilities?.run.takeOver === true;
}

export function formatRunUsage(usage: RunDto["usage"]): string {
  if (usage.kind === "unknown" || isUnknownCost(usage)) {
    return `未知成本（${usage.currency}）`;
  }
  const amount = `${usage.costMinor} ${usage.currency}`;
  if (usage.kind === "estimated") {
    return `估算 ${amount}`;
  }
  return `已结算 ${amount}`;
}

export interface TimelineRow {
  key: string;
  type: string;
  time: string;
  summary: string;
  raw: boolean;
  id?: string;
  ingestionPosition?: number;
}

export function parseTimelineEvent(raw: unknown): TimelineRow | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const event = raw as Record<string, unknown>;
  const id = typeof event.id === "string" && event.id.length > 0 ? event.id : undefined;
  const ingestionPosition =
    typeof event.ingestionPosition === "number" && Number.isInteger(event.ingestionPosition)
      ? event.ingestionPosition
      : undefined;
  const type = typeof event.type === "string" && event.type.length > 0 ? event.type : "event";
  const time =
    typeof event.time === "string"
      ? event.time
      : typeof event.recordedAt === "string"
        ? event.recordedAt
        : "";
  let summary = type;
  if (event.data !== undefined) {
    try {
      summary = `${type} ${JSON.stringify(event.data)}`;
    } catch {
      summary = type;
    }
  }
  const row: TimelineRow = {
    key:
      id !== undefined
        ? `id:${id}`
        : ingestionPosition !== undefined
          ? `pos:${ingestionPosition}`
          : `anon:${type}:${time}:${summary}`,
    type,
    time,
    summary,
    raw: /log|output|stdout|stderr/i.test(type),
  };
  if (id !== undefined) {
    row.id = id;
  }
  if (ingestionPosition !== undefined) {
    row.ingestionPosition = ingestionPosition;
  }
  return row;
}

export function dedupeTimeline(rows: TimelineRow[]): TimelineRow[] {
  const seen = new Set<string>();
  const out: TimelineRow[] = [];
  for (const row of rows) {
    const identity =
      row.id !== undefined
        ? `id:${row.id}`
        : row.ingestionPosition !== undefined
          ? `pos:${row.ingestionPosition}`
          : null;
    if (identity !== null) {
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
    }
    out.push(row);
  }
  return out;
}

export function sortTimeline(rows: TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.ingestionPosition ?? Number.MAX_SAFE_INTEGER;
    const pb = b.ingestionPosition ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) {
      return pa - pb;
    }
    return a.time.localeCompare(b.time);
  });
}

export function mergeEventLists(base: unknown[], live: unknown[]): unknown[] {
  return [...base, ...live];
}

export function timelineFromEvents(items: unknown[]): TimelineRow[] {
  const parsed: TimelineRow[] = [];
  for (const item of items) {
    const row = parseTimelineEvent(item);
    if (row) {
      parsed.push(row);
    }
  }
  return sortTimeline(dedupeTimeline(parsed));
}
