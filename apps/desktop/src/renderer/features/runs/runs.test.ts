import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CapabilitiesDto, RunDto } from "@workforce/desktop-client";

import { RunConsoleView } from "./page.js";
import {
  canOfferRerun,
  formatRunUsage,
  runStatusLabel,
  shouldShowInput,
  shouldShowPause,
  timelineFromEvents,
} from "./model.js";

function sampleRun(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: "run_1",
    taskId: "task_1",
    projectId: "prj_1",
    status: "running",
    stateRevision: 3,
    definitionRevision: 1,
    generation: 1,
    attempt: 1,
    protocolVersion: "0.1",
    cancelRequested: false,
    usage: { costMinor: 0, currency: "USD", kind: "unknown" },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:01.000Z",
    ...overrides,
  };
}

function capabilities(run: Partial<CapabilitiesDto["run"]> = {}): CapabilitiesDto {
  return {
    protocolVersion: "0.1",
    apiVersion: "v1",
    run: { pause: false, resume: false, input: false, takeOver: false, ...run },
    project: { pause: false, resume: false, archive: false },
  };
}

function renderConsole(
  run: RunDto,
  options: {
    events?: unknown[];
    capabilities?: CapabilitiesDto;
    cancelAccepted?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(RunConsoleView, {
      run,
      events: options.events ?? [],
      capabilities: options.capabilities ?? capabilities(),
      ...(options.cancelAccepted === true ? { cancelAccepted: true } : {}),
    }),
  );
}

describe("run timeline", () => {
  it("dedupes duplicate events by id and ingestionPosition", () => {
    const rows = timelineFromEvents([
      {
        id: "evt_1",
        type: "run.status_changed",
        ingestionPosition: 1,
        time: "2026-09-10T00:00:01.000Z",
        data: { to: "running" },
      },
      {
        id: "evt_1",
        type: "run.status_changed",
        ingestionPosition: 1,
        time: "2026-09-10T00:00:01.000Z",
        data: { to: "running" },
      },
      {
        type: "command.output",
        ingestionPosition: 2,
        time: "2026-09-10T00:00:02.000Z",
        data: { chunk: "hello" },
      },
      {
        type: "command.output",
        ingestionPosition: 2,
        time: "2026-09-10T00:00:02.000Z",
        data: { chunk: "hello" },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.key)).toEqual(["id:evt_1", "pos:2"]);
  });

  it("renders a single timeline row when the same event is ingested twice", () => {
    const html = renderConsole(sampleRun(), {
      events: [
        {
          id: "evt_dup",
          type: "run.status_changed",
          ingestionPosition: 4,
          time: "2026-09-10T00:00:04.000Z",
          data: { to: "running" },
        },
        {
          id: "evt_dup",
          type: "run.status_changed",
          ingestionPosition: 4,
          time: "2026-09-10T00:00:04.000Z",
          data: { to: "running" },
        },
      ],
    });
    expect(html.match(/data-testid="timeline-row"/g)).toHaveLength(1);
  });
});

describe("run cancel 202", () => {
  it("keeps the console in 取消中 after cancel is accepted, not 已取消", () => {
    const running = sampleRun({ status: "running", cancelRequested: false });
    expect(runStatusLabel(running, { cancelAccepted: true })).toBe("取消中");
    expect(runStatusLabel({ ...running, cancelRequested: true })).toBe("取消中");
    expect(runStatusLabel(running, { cancelAccepted: true })).not.toBe("已取消");

    const html = renderConsole(running, { cancelAccepted: true });
    expect(html).toContain("取消中");
    expect(html).not.toContain("已取消");
    expect(html).not.toContain('data-testid="run-cancel"');
  });
});

describe("run pause capability", () => {
  it("hides pause when capabilities.run.pause is false", () => {
    expect(shouldShowPause(capabilities({ pause: false }))).toBe(false);
    const html = renderConsole(sampleRun(), { capabilities: capabilities({ pause: false }) });
    expect(html).not.toContain('data-testid="run-pause"');
    expect(html).not.toContain("暂停");
  });

  it("does not treat pause as available just because the run is running", () => {
    const html = renderConsole(sampleRun({ status: "running" }), {
      capabilities: capabilities({ pause: false, input: true }),
    });
    expect(html).not.toContain('data-testid="run-pause"');
  });
});

describe("run input capability", () => {
  it("hides input unless waiting_input and capabilities.run.input", () => {
    expect(shouldShowInput(sampleRun({ status: "running" }), capabilities({ input: true }))).toBe(
      false,
    );
    expect(
      shouldShowInput(sampleRun({ status: "waiting_input" }), capabilities({ input: false })),
    ).toBe(false);
    const html = renderConsole(sampleRun({ status: "waiting_input" }), {
      capabilities: capabilities({ input: false }),
    });
    expect(html).not.toContain('data-testid="run-input"');
  });
});

describe("run usage", () => {
  it("does not render unknown cost as 0", () => {
    const usage = { costMinor: 0, currency: "USD", kind: "unknown" as const };
    const label = formatRunUsage(usage);
    expect(label).toContain("未知成本");
    expect(label).not.toMatch(/\b0\b/);
    const html = renderConsole(sampleRun({ usage }));
    const match = html.match(/data-testid="run-usage"[^>]*>([^<]+)/);
    expect(match?.[1]).toContain("未知成本");
    expect(match?.[1]).not.toMatch(/\b0\b/);
  });

  it("still shows estimated and settled minor units", () => {
    expect(formatRunUsage({ costMinor: 42, currency: "USD", kind: "estimated" })).toContain("42");
    expect(formatRunUsage({ costMinor: 7, currency: "USD", kind: "settled" })).toContain("7");
  });
});

describe("unknown recovery", () => {
  it("does not show failed or offer rerun for an unknown run status", () => {
    expect(canOfferRerun("recovering")).toBe(false);
    expect(runStatusLabel(sampleRun({ status: "recovering" }))).toBe("状态未知");
    const html = renderConsole(sampleRun({ status: "recovering" }));
    expect(html).toContain("状态未知");
    expect(html).not.toContain(">失败<");
    expect(html).not.toContain('data-testid="run-rerun"');
    expect(html).not.toContain(">重跑<");
  });
});
