import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isLocalNodeId } from "./model.js";
import { LocalNodeCard, NodesPage, RemoteNodePlaceholder } from "./page.js";

describe("local node", () => {
  it("labels the only node as 本机 / Mock and does not invent a remote fleet", () => {
    expect(isLocalNodeId("local")).toBe(true);
    const html = renderToStaticMarkup(
      createElement(LocalNodeCard, {
        nodeId: "local",
        health: null,
        ready: null,
        version: null,
      }),
    );
    expect(html).toContain("本机 / Mock");
    expect(html).toContain("探测结果待 Daemon 目录接口");
    expect(html).not.toContain("3/4");
    expect(html.toLowerCase()).not.toContain("online");
  });

  it("renders remote placeholders as offline, not healthy", () => {
    const html = renderToStaticMarkup(createElement(RemoteNodePlaceholder, { nodeId: "build-01" }));
    expect(html).toContain("离线占位");
    expect(html).toContain("不是在线机群");
    expect(html).not.toContain("可用节点已连接");
    expect(html.toLowerCase()).not.toMatch(/\bonline\b/);
    const page = renderToStaticMarkup(
      createElement(NodesPage, {
        params: { nodeId: "build-01" },
        path: "/nodes/build-01",
        navigate: () => undefined,
      }),
    );
    expect(page).toContain("远程节点（未接入）");
  });
});
