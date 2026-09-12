import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  createDesktopClient,
  type ClientTransport,
  type TransportRequest,
} from "@workforce/desktop-client";
import type { ApiRequest, ApiResponse } from "@workforce/ui";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../../daemon/src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../../daemon/src/bootstrap/index.js";
import { proxyConnectedApiRequest } from "../src/main/composition.js";
import { WorkforceProvider } from "../src/renderer/app/workforce-context.js";
import { WorkflowAuthoringPage } from "../src/renderer/features/workflow-authoring/page.js";
import {
  AGENT_REPLY_GAP,
  CHAT_SESSION_GAP,
  EMPTY_INTENT_NOTE,
} from "../src/renderer/features/workflow-authoring/model.js";
import { WorkflowsPage } from "../src/renderer/features/workflows/page.js";
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
  uninstallHappyDom();
  for (const item of harnesses.splice(0)) {
    await item.daemon.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
});

function uniqueLockPath(): string {
  const id = randomBytes(6).toString("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\WorkforceAuthoring-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-authoring-${process.pid}-${id}.lock.sock`);
}

async function startComposed(): Promise<StartedDaemon> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-authoring-"));
  const services = await createComposedAppServices({ stateDir, completeAfterMs: 5 });
  const daemon = await startDaemon({
    stateDir,
    services,
    lockPath: uniqueLockPath(),
    heartbeatMs: 30,
    pollMs: 20,
  });
  harnesses.push({ daemon, stateDir });
  return daemon;
}

function createElectronProxyTransport(daemon: StartedDaemon): ClientTransport {
  return {
    async request(req: TransportRequest) {
      const input: ApiRequest = { method: req.method, path: req.path };
      if (req.headers !== undefined) {
        input.headers = req.headers;
      }
      if (req.body !== undefined) {
        input.body = req.body;
      }
      const res: ApiResponse = await proxyConnectedApiRequest(input, {
        port: daemon.port,
        session: { sessionToken: daemon.sessionToken },
      });
      if (res.ok) {
        return { status: res.status, headers: {}, body: res.body };
      }
      return {
        status: res.status,
        headers: {},
        body: {
          type: `urn:workforce:error:${res.code}`,
          title: res.message,
          status: res.status,
          code: res.code,
          detail: res.message,
          instance: req.path,
          requestId: "",
          retryable: res.status >= 500,
        },
      };
    },
  };
}

function wrap(client: ReturnType<typeof createDesktopClient>, child: ReactNode): ReactNode {
  return createElement(
    WorkforceProvider,
    {
      value: {
        client,
        connection: { status: "online", protocolVersion: "0.1", mode: "spawn" },
        navigate: () => undefined,
        capabilities: null,
      },
    },
    child,
  );
}

async function waitFor<T>(
  label: string,
  fn: () => T | undefined | null | false,
  timeoutMs = 8_000,
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

function setInput(testId: string, value: string): void {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) {
    throw new Error(`missing field ${testId}`);
  }
  setNativeValue(node, value);
}

function commandOptions(prefix: string) {
  const id = randomBytes(4).toString("hex");
  return { idempotencyKey: `${prefix}-${id}`, operationId: `op-${prefix}-${id}` };
}

const openSession = {
  id: "cas_1",
  projectId: "prj_1",
  protocolVersion: "0.1",
  status: "open",
  messages: [] as Array<{ id: string; role: string; content: string; createdAt: string }>,
  turns: [] as unknown[],
  stateRevision: 1,
  createdAt: "2026-09-12T00:00:00.000Z",
  updatedAt: "2026-09-12T00:00:00.000Z",
};

describe("workflow authoring write path", () => {
  it(
    "keeps the workflows entry from looking like chat succeeded",
    { timeout: 20_000 },
    async () => {
      window.location.hash = "#/workflows";
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => {
        root.render(
          createElement(WorkflowsPage, {
            path: "/workflows",
            params: {},
            navigate: () => undefined,
          }),
        );
      });
      const open = await waitFor("authoring entry", () =>
        document.querySelector('[data-testid="workflow-authoring-open"]'),
      );
      expect(open).toBeInstanceOf(HTMLButtonElement);
      expect((open as HTMLButtonElement).disabled).toBe(false);
      expect(document.body.innerText).toContain(CHAT_SESSION_GAP);
      expect(document.querySelector('[data-testid="workflow-authoring-chat-disabled"]')).toBeNull();
      expect(document.body.innerText).not.toContain("会话已接通");
      expect(document.body.innerText).not.toContain("Agent 已生成");
    },
  );

  it(
    "sends through Daemon AuthoringSession and lands an unpublished draft after confirm",
    { timeout: 30_000 },
    async () => {
      const daemon = await startComposed();
      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });
      const created = await client.createProject(
        { name: "Authoring", objective: "chat draft" },
        commandOptions("create"),
      );
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);

      await act(async () => {
        root.render(
          wrap(
            client,
            createElement(WorkflowAuthoringPage, {
              path: `/workflows?authoring=1&projectId=${created.id}`,
              params: { projectId: created.id },
              navigate: () => undefined,
            }),
          ),
        );
      });

      const send = await waitFor("send button", () => {
        const button = document.querySelector('[data-testid="workflow-authoring-send-chat"]');
        return button instanceof HTMLButtonElement && !button.disabled ? button : null;
      });
      expect(document.body.innerText).toContain(AGENT_REPLY_GAP);

      await act(async () => {
        send.click();
      });
      const empty = await waitFor(
        "empty intent",
        () => document.querySelector('[data-testid="workflow-authoring-empty-intent"]')?.textContent,
      );
      expect(empty).toContain(EMPTY_INTENT_NOTE);

      await act(async () => {
        setInput("workflow-authoring-intent", "请生成完整工作流");
      });
      await act(async () => {
        send.click();
      });
      const messages = await waitFor(
        "user message",
        () => document.querySelector('[data-testid="workflow-authoring-messages"]')?.textContent,
        15_000,
      );
      expect(messages).toContain("请生成完整工作流");
      expect(document.body.innerText).not.toContain("Agent 已生成");

      const confirm = await waitFor(
        "proposal confirm",
        () => {
          const button = document.querySelector('[data-testid="workflow-authoring-confirm"]');
          return button instanceof HTMLButtonElement && !button.disabled ? button : null;
        },
        15_000,
      );
      await act(async () => {
        confirm.click();
      });
      const landed = await waitFor(
        "landed draft",
        () => document.querySelector('[data-testid="workflow-authoring-landed"]'),
        15_000,
      );
      expect(landed?.textContent).toContain("未发布");
      expect(document.querySelector('[data-testid="workflow-authoring-open-canvas"]')).toBeInstanceOf(
        HTMLButtonElement,
      );
      const idText =
        document.querySelector('[data-testid="workflow-authoring-workflow-id"]')?.textContent ?? "";
      expect(idText).toMatch(/wfd_|wf_/);
    },
  );

  it("preserves the intent when Daemon send fails", { timeout: 20_000 }, async () => {
    const session = { ...openSession, messages: [] };
    const client = createDesktopClient({
      transport: {
        async request(req) {
          if (req.method === "GET" && req.path.includes("/authoring-sessions")) {
            return { status: 200, headers: {}, body: { items: [] } };
          }
          if (req.method === "POST" && req.path.endsWith("/authoring-sessions")) {
            return { status: 201, headers: {}, body: session };
          }
          if (req.method === "GET" && /\/authoring-sessions\/cas_1$/.test(req.path)) {
            return { status: 200, headers: {}, body: session };
          }
          if (req.path.includes("/messages")) {
            return {
              status: 500,
              headers: {},
              body: {
                type: "urn:workforce:error:write_failed",
                title: "write failed",
                status: 500,
                code: "write_failed",
                detail: "POST /authoring-sessions failed",
                instance: req.path,
                requestId: "",
                retryable: true,
              },
            };
          }
          return {
            status: 500,
            headers: {},
            body: {
              type: "urn:workforce:error:write_failed",
              title: "write failed",
              status: 500,
              code: "write_failed",
              detail: "unexpected",
              instance: req.path,
              requestId: "",
              retryable: true,
            },
          };
        },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        wrap(
          client,
          createElement(WorkflowAuthoringPage, {
            path: "/workflows?authoring=1&projectId=prj_1",
            params: { projectId: "prj_1" },
            navigate: () => undefined,
          }),
        ),
      );
    });
    const send = await waitFor("send button", () => {
      const button = document.querySelector('[data-testid="workflow-authoring-send-chat"]');
      return button instanceof HTMLButtonElement && !button.disabled ? button : null;
    });
    await act(async () => {
      setInput("workflow-authoring-intent", "保留意图");
    });
    await act(async () => {
      send.click();
    });
    const error = await waitFor(
      "send failure",
      () => document.querySelector('[data-testid="workflow-authoring-error"]')?.textContent,
    );
    expect(error).toContain("POST /authoring-sessions failed");
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="workflow-authoring-intent"]')
        ?.value,
    ).toBe("保留意图");
    expect(document.querySelector('[data-testid="workflow-authoring-landed"]')).toBeNull();
  });

  it(
    "reloads Daemon session messages after remount instead of a local store",
    { timeout: 30_000 },
    async () => {
      const daemon = await startComposed();
      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });
      const created = await client.createProject(
        { name: "Reload", objective: "session" },
        commandOptions("reload"),
      );
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => {
        root.render(
          wrap(
            client,
            createElement(WorkflowAuthoringPage, {
              path: `/workflows?authoring=1&projectId=${created.id}`,
              params: { projectId: created.id },
              navigate: () => undefined,
            }),
          ),
        );
      });
      const sessionLabel = await waitFor(
        "daemon session",
        () => document.querySelector('[data-testid="workflow-authoring-session-id"]')?.textContent,
      );
      expect(sessionLabel).toContain("cas_");
      expect(sessionLabel).not.toContain("本地笔记/手工草稿空间");
      const sessionId = sessionLabel.match(/cas_[A-Za-z0-9]+/)?.[0];
      expect(sessionId).toBeTruthy();

      const send = await waitFor("enabled send", () => {
        const button = document.querySelector('[data-testid="workflow-authoring-send-chat"]');
        return button instanceof HTMLButtonElement && !button.disabled ? button : null;
      });
      await act(async () => {
        setInput("workflow-authoring-intent", "请记下这段用户意图");
      });
      await act(async () => {
        send.click();
      });
      const messages = await waitFor(
        "user message",
        () => document.querySelector('[data-testid="workflow-authoring-messages"]')?.textContent,
        15_000,
      );
      expect(messages).toContain("请记下这段用户意图");
      expect(document.body.innerText).toContain(AGENT_REPLY_GAP);
      expect(document.body.innerText).not.toContain("Agent 已生成");

      await act(async () => {
        root.unmount();
      });
      roots.pop();
      const remount = document.createElement("div");
      document.body.append(remount);
      const remountRoot = createRoot(remount);
      roots.push(remountRoot);
      await act(async () => {
        remountRoot.render(
          wrap(
            client,
            createElement(WorkflowAuthoringPage, {
              path: `/workflows?authoring=1&projectId=${created.id}`,
              params: { projectId: created.id },
              navigate: () => undefined,
            }),
          ),
        );
      });
      const reloaded = await waitFor(
        "reloaded user message from Daemon",
        () => document.querySelector('[data-testid="workflow-authoring-messages"]')?.textContent,
        15_000,
      );
      expect(reloaded).toContain("请记下这段用户意图");
      expect(
        document.querySelector('[data-testid="workflow-authoring-session-id"]')?.textContent,
      ).toContain(sessionId);
      expect(document.body.innerText).not.toContain("Agent 已生成");
    },
  );
});
