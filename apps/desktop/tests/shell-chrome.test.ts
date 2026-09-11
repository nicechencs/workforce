import type { WorkforcePreloadApi } from "@workforce/ui";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "../src/renderer/app/theme.js";
import { ShellApp } from "../src/renderer/app/shell-app.js";
import { renderShell } from "../src/renderer/app/shell.js";
import { ShellFrame } from "../src/renderer/components/shell-frame.js";
import { Page } from "../src/renderer/components/ui.js";
import { createRouteRegistry } from "../src/renderer/routes/registry.js";
import { installHappyDom, uninstallHappyDom } from "./install-happy-dom.js";

const NAV_COLLAPSED_KEY = "workforce:nav-collapsed";
const roots: Root[] = [];

beforeEach(() => {
  installHappyDom();
  window.localStorage.removeItem(NAV_COLLAPSED_KEY);
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
  delete (globalThis as { workforce?: WorkforcePreloadApi }).workforce;
  uninstallHappyDom();
});

function mount(node: ReactNode): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(node);
  });
  return host;
}

async function waitFor<T>(label: string, fn: () => T | undefined | null | false): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const value = fn();
    if (value) {
      return value;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`timeout waiting for ${label}; ui=${document.body.textContent?.slice(0, 500)}`);
}

function onlineView() {
  return renderShell({
    connection: { status: "online", protocolVersion: "0.1", mode: "spawn" },
    currentPath: "/",
    title: "工作台",
  });
}

function installPreload(): void {
  const online = { status: "online" as const, protocolVersion: "0.1", mode: "spawn" as const };
  const api: WorkforcePreloadApi = {
    connection: {
      getState: async () => online,
      reconnect: async () => online,
      subscribe: (listener) => {
        listener(online);
        return () => undefined;
      },
    },
    api: {
      request: async () => ({ ok: false, status: 503, code: "unused", message: "unused" }),
      subscribeEvents: async () => ({ subscriptionId: "sub_shell" }),
      unsubscribeEvents: async () => undefined,
      onEvent: () => () => undefined,
    },
    workspace: {
      pickDirectory: async () => ({
        ok: true,
        grant: { authorizationId: "wsauth_shell", displayLabel: "shell-ws" },
      }),
    },
    shell: { quitUi: async () => undefined },
  };
  window.workforce = api;
}

function PageOne(): ReactNode {
  const [label] = useState("one");
  return createElement("div", { "data-testid": "page-one" }, label);
}

function PageTwo(): ReactNode {
  const [a] = useState("a");
  const [b] = useState("b");
  return createElement("div", { "data-testid": "page-two" }, a + b);
}

describe("desktop shell chrome", () => {
  it("collapses the brand mark into the expand control instead of overlapping the toggle", async () => {
    mount(
      createElement(
        ThemeProvider,
        null,
        createElement(
          ShellFrame,
          { view: onlineView(), onNavigate: () => undefined },
          createElement(Page, { title: "项目详情", subtitle: "围绕一个 Project" }, "正文"),
        ),
      ),
    );

    expect(document.querySelector(".wf-brand-label")?.textContent).toBe("Workforce");
    expect(document.querySelector('[aria-label="收起侧栏"]')).not.toBeNull();
    expect(document.querySelector("h1.wf-topbar-page")?.textContent).toBe("项目详情");
    expect(document.querySelector(".wf-topbar-subtitle")?.textContent).toBe("围绕一个 Project");
    expect(document.querySelector(".wf-page-header-title")).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="收起侧栏"]')?.click();
    });

    expect(document.querySelector(".wf-shell")?.getAttribute("data-nav-collapsed")).toBe("true");
    expect(document.querySelector('[aria-label="展开侧栏"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="收起侧栏"]')).toBeNull();
    expect(document.querySelector(".wf-nav-brand-toggle .wf-brand-mark")?.textContent).toBe("W");
    expect(document.querySelector(".wf-nav-header .wf-nav-collapse")).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="展开侧栏"]')?.click();
    });
    expect(document.querySelector('[aria-label="收起侧栏"]')).not.toBeNull();
  });

  it("keeps the shell mounted when switching pages that use different hook counts", async () => {
    installPreload();
    const registry = createRouteRegistry();
    registry.registerFeatureModule({ slot: "dashboard", Page: PageOne });
    registry.registerFeatureModule({ slot: "projects", Page: PageTwo });

    mount(createElement(ThemeProvider, null, createElement(ShellApp, { registry })));

    await waitFor("page-one", () => document.querySelector('[data-testid="page-one"]'));
    const projects = await waitFor(
      "projects-nav",
      () =>
        [...document.querySelectorAll<HTMLButtonElement>(".wf-nav-item")].find((item) =>
          item.textContent?.includes("项目"),
        ) ?? null,
    );

    await act(async () => {
      projects.click();
    });

    await waitFor("page-two", () => document.querySelector('[data-testid="page-two"]'));
    expect(document.querySelector(".wf-shell")).not.toBeNull();
    expect(document.querySelector('[data-testid="page-one"]')).toBeNull();
    expect(document.body.textContent).not.toContain("页面无法显示");
  });
});
