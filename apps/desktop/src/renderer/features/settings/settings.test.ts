import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { capabilityRows } from "./model.js";
import { SettingsView } from "./page.js";

describe("settings", () => {
  it("shows probe results, unsupported capabilities, and budget notes", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsView, {
        health: {
          ok: true,
          pid: 42,
          port: 3456,
          startIdentity: "sid_1",
          protocolVersion: "0.1",
        },
        ready: { ready: true, checks: { sqlite: true } },
        version: { protocolVersion: "0.1", apiVersion: "v1" },
        capabilities: {
          protocolVersion: "0.1",
          apiVersion: "v1",
          run: { pause: false, resume: false, input: true, takeOver: false },
          project: { pause: false, resume: false, archive: false },
        },
      }),
    );
    expect(html).toContain("Daemon 已连接");
    expect(html).toContain("暂停：不支持");
    expect(html).toContain("输入：支持");
    expect(html).toContain("未知成本不是 0");
    expect(
      capabilityRows({
        protocolVersion: "0.1",
        apiVersion: "v1",
        run: { pause: false, resume: false, input: true, takeOver: false },
        project: { pause: false, resume: false, archive: false },
      }).find((row) => row.name === "暂停")?.value,
    ).toBe("不支持");
  });
});
