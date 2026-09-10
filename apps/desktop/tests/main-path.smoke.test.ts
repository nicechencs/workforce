import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { createDesktopClient, createLoopbackTransport } from "@workforce/desktop-client";
import type { WorkforcePreloadApi } from "@workforce/ui";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../../daemon/src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../../daemon/src/bootstrap/index.js";
import { WorkforceProvider } from "../src/renderer/app/workforce-context.js";
import { ProjectsPage } from "../src/renderer/features/projects/page.js";
import { installHappyDom, uninstallHappyDom } from "./install-happy-dom.js";

interface Harness {
  daemon: StartedDaemon;
  stateDir: string;
}

const harnesses: Harness[] = [];
const roots: Root[] = [];

beforeEach(() => {
  installHappyDom();
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  delete (globalThis as { workforce?: WorkforcePreloadApi }).workforce;
  uninstallHappyDom();
  for (const item of harnesses.splice(0)) {
    await item.daemon.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
});

function uniqueLockPath(): string {
  const id = randomBytes(6).toString("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\WorkforceDesktopSmoke-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-desktop-smoke-${process.pid}-${id}.lock.sock`);
}

function installSmokePreload(): void {
  const api: WorkforcePreloadApi = {
    connection: {
      getState: async () => ({ status: "online", protocolVersion: "0.1", mode: "spawn" }),
      reconnect: async () => ({ status: "online", protocolVersion: "0.1", mode: "spawn" }),
      subscribe: () => () => undefined,
    },
    api: {
      request: async () => ({ ok: false, status: 503, code: "unused", message: "unused" }),
      subscribeEvents: async () => ({ subscriptionId: "sub_smoke" }),
      unsubscribeEvents: async () => undefined,
      onEvent: () => () => undefined,
    },
    workspace: {
      pickDirectory: async () => ({
        ok: true,
        grant: { authorizationId: "wsauth_smoke", displayLabel: "smoke-ws" },
      }),
    },
    shell: { quitUi: async () => undefined },
  };
  (globalThis as { workforce?: WorkforcePreloadApi }).workforce = api;
}

function SmokeHost(props: { client: ReturnType<typeof createDesktopClient> }): ReactNode {
  const [route, setRoute] = useState<{ path: string; params: Record<string, string> }>({
    path: "/projects",
    params: {},
  });
  const navigate = (next: string): void => {
    const match = /^\/projects\/([^/]+)/.exec(next);
    setRoute({
      path: next,
      params: match?.[1] ? { projectId: match[1] } : {},
    });
  };
  return createElement(
    WorkforceProvider,
    {
      value: {
        client: props.client,
        connection: { status: "online", protocolVersion: "0.1", mode: "spawn" },
        navigate,
        capabilities: null,
      },
    },
    createElement(ProjectsPage, { path: route.path, params: route.params, navigate }),
  );
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const setter =
    Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set ??
    Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) {
    throw new Error(`no value setter on ${el.constructor.name}`);
  }
  const tracker = (el as { _valueTracker?: { setValue(next: string): void } })._valueTracker;
  tracker?.setValue("");
  setter.call(el, value);
  const EventCtor = window.Event;
  el.dispatchEvent(new EventCtor("input", { bubbles: true }));
  el.dispatchEvent(new EventCtor("change", { bubbles: true }));
}

async function waitFor<T>(
  label: string,
  fn: () => T | undefined | null | false,
  timeoutMs = 12_000,
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = fn();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for ${label}; ui=${document.body.innerText.slice(0, 800)}`);
}

describe("desktop project main path", () => {
  it(
    "clicks create → bind workspace → plan → confirm → start against the composed mock daemon",
    { timeout: 25_000 },
    async () => {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-desktop-ui-smoke-"));
      const services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
      const daemon = await startDaemon({
        stateDir,
        services,
        lockPath: uniqueLockPath(),
        heartbeatMs: 30,
        pollMs: 20,
      });
      harnesses.push({ daemon, stateDir });

      const client = createDesktopClient({
        transport: createLoopbackTransport({
          port: daemon.port,
          getSessionToken: () => daemon.sessionToken,
        }),
      });
      installSmokePreload();

      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => {
        root.render(createElement(SmokeHost, { client }));
      });

      const name = await waitFor(
        "create-name",
        () => document.getElementById("wf-project-name") as HTMLInputElement | null,
      );
      const objective = await waitFor(
        "create-objective",
        () => document.getElementById("wf-project-objective") as HTMLTextAreaElement | null,
      );
      await act(async () => {
        setNativeValue(name, "Desktop UI smoke");
        setNativeValue(objective, "renderer click path against composed mock");
      });
      expect(name.value).toBe("Desktop UI smoke");
      expect(objective.value).toBe("renderer click path against composed mock");
      const createButton = await waitFor("create-button", () =>
        document.querySelector<HTMLButtonElement>('[data-testid="project-create"]'),
      );
      await act(async () => {
        createButton.click();
      });

      expect(document.querySelector('[data-testid="project-tab-panel-overview"]')).not.toBeNull();
      expect(document.querySelector('[data-testid="project-bind-workspace"]')).toBeNull();
      expect(document.querySelector('[data-testid="project-task-list"]')).toBeNull();

      const settingsTab = await waitFor("settings-tab", () =>
        document.querySelector<HTMLButtonElement>('[data-testid="project-tab-settings"]'),
      );
      await act(async () => {
        settingsTab.click();
      });
      const bindButton = await waitFor("bind-workspace", () =>
        document.querySelector<HTMLButtonElement>('[data-testid="project-bind-workspace"]'),
      );
      await act(async () => {
        bindButton.click();
      });

      const startPlanning = await waitFor("start-planning", () => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="project-action-startPlanning"]',
        );
        return button && !button.disabled ? button : null;
      });
      await act(async () => {
        startPlanning.click();
      });

      const confirm = await waitFor("confirm-plan", () => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="project-action-confirmPlan"]',
        );
        return button && !button.disabled ? button : null;
      });
      expect(document.querySelector('[data-testid="project-status"]')?.textContent).toContain(
        "规划中",
      );
      await act(async () => {
        confirm.click();
      });

      const start = await waitFor("start-project", () => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="project-action-startProject"]',
        );
        return button && !button.disabled ? button : null;
      });
      expect(document.querySelector('[data-testid="project-status"]')?.textContent).toContain(
        "就绪",
      );
      await act(async () => {
        start.click();
      });

      const status = await waitFor("running-status", () => {
        const text = document.querySelector('[data-testid="project-status"]')?.textContent?.trim();
        return text === "执行中" || text === "已完成" ? text : null;
      });
      const tasksTab = await waitFor("tasks-tab", () =>
        document.querySelector<HTMLButtonElement>('[data-testid="project-tab-tasks"]'),
      );
      await act(async () => {
        tasksTab.click();
      });
      const tasks = await waitFor("published-tasks", () => {
        const text =
          document.querySelector('[data-testid="project-task-list"]')?.textContent ??
          document.body.innerText;
        return text.includes("dev_alpha") && text.includes("dev_bravo") ? text : null;
      });

      expect(status === "执行中" || status === "已完成").toBe(true);
      expect(tasks).toContain("dev_alpha");
      expect(tasks).toContain("dev_bravo");

      for (const id of ["overview", "tasks", "runs", "artifacts", "activity", "settings"]) {
        const button = await waitFor(`project-tab-${id}`, () =>
          document.querySelector<HTMLButtonElement>(`[data-testid="project-tab-${id}"]`),
        );
        await act(async () => {
          button.click();
        });
        expect(document.querySelector(`[data-testid="project-tab-panel-${id}"]`)).not.toBeNull();
      }
      expect(document.querySelector('[data-testid="project-detail-tabs"]')?.textContent).toContain(
        "概览",
      );
    },
  );
});
