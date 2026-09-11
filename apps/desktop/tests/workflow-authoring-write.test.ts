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
} from "../src/renderer/features/workflow-authoring/model.js";
import {
  reloadDefaultAuthoringSessionStoreForTests,
  resetDefaultAuthoringSessionStoreForTests,
} from "../src/renderer/features/workflow-authoring/session-store.js";
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
  resetDefaultAuthoringSessionStoreForTests();
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
      const chat = await waitFor("disabled chat entry", () =>
        document.querySelector('[data-testid="workflow-authoring-chat-disabled"]'),
      );
      expect(chat).toBeInstanceOf(HTMLButtonElement);
      expect((chat as HTMLButtonElement).disabled).toBe(true);
      expect(document.body.innerText).toContain(CHAT_SESSION_GAP);
      expect(
        document.querySelector('[data-testid="workflow-authoring-chat-ready"]')?.textContent,
      ).toContain("本机用户消息已接线");
      expect(document.body.innerText).not.toContain("会话已接通");
      expect(document.body.innerText).not.toContain("Agent 已生成");
    },
  );

  it(
    "lands an unpublished draft through M7 write APIs and preserves input on failure",
    {
      timeout: 20_000,
    },
    async () => {
      const daemon = await startComposed();
      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);

      await act(async () => {
        root.render(
          wrap(
            client,
            createElement(WorkflowAuthoringPage, {
              path: "/workflows",
              params: {},
              navigate: () => undefined,
            }),
          ),
        );
      });

      const send = await waitFor("send control", () =>
        document.querySelector('[data-testid="workflow-authoring-send-chat"]'),
      );
      expect(send).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        setInput("workflow-authoring-intent", "请生成完整工作流");
      });
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>('[data-testid="workflow-authoring-land-draft"]')
          ?.click();
      });
      const empty = await waitFor(
        "empty intent",
        () => document.querySelector('[data-testid="workflow-authoring-error"]')?.textContent,
      );
      expect(empty).toContain("编排 Agent 尚未接线");
      expect(
        document.querySelector<HTMLTextAreaElement>('[data-testid="workflow-authoring-intent"]')
          ?.value,
      ).toBe("请生成完整工作流");
      expect(document.querySelector('[data-testid="workflow-authoring-landed"]')).toBeNull();

      await act(async () => {
        setInput("workflow-authoring-name", "对话草稿");
        setInput("workflow-authoring-description", "未发布");
        setInput("workflow-authoring-roles", "planner\ndeveloper");
        setInput("workflow-authoring-steps", "规划\n实现");
      });
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>('[data-testid="workflow-authoring-land-draft"]')
          ?.click();
      });

      const landed = await waitFor("landed draft", () =>
        document.querySelector('[data-testid="workflow-authoring-landed"]'),
      );
      expect(landed?.textContent).toContain("POST /workflows");
      expect(landed?.textContent).toContain("不是对话生成成功");
      expect(
        document.querySelector('[data-testid="workflow-authoring-open-canvas"]'),
      ).toBeInstanceOf(HTMLButtonElement);
      expect(
        (
          document.querySelector(
            '[data-testid="workflow-authoring-open-canvas"]',
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      expect(document.body.innerText).not.toContain("Agent 已生成");

      const note =
        document.querySelector('[data-testid="workflow-authoring-landed-note"]')?.textContent ?? "";
      expect(note).toContain("未发布");
      const idText =
        document.querySelector('[data-testid="workflow-authoring-workflow-id"]')?.textContent ?? "";
      const idMatch = idText.match(/wfd_[A-Za-z0-9]+/);
      expect(idMatch?.[0]).toBeTruthy();
      const created = await client.getWorkflow(idMatch![0]!);
      expect(created.status).toBe("draft");
      expect(created.name).toBe("对话草稿");
      const versionId = created.versions[0]?.id;
      expect(versionId).toBeTruthy();
      expect(created.versions[0]?.status).toBe("draft");
      expect(created.versions[0]?.immutable).toBe(false);
      const listed = await client.listWorkflows();
      expect(listed.items.some((item) => item.id === created.id)).toBe(false);
    },
  );

  it("preserves fields when POST /workflows fails", { timeout: 20_000 }, async () => {
    const client = createDesktopClient({
      transport: {
        async request() {
          return {
            status: 500,
            headers: {},
            body: {
              type: "urn:workforce:error:write_failed",
              title: "write failed",
              status: 500,
              code: "write_failed",
              detail: "POST /workflows failed",
              instance: "/api/v1/workflows",
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
            path: "/workflows",
            params: {},
            navigate: () => undefined,
          }),
        ),
      );
    });
    await act(async () => {
      setInput("workflow-authoring-name", "保留名称");
      setInput("workflow-authoring-intent", "保留意图");
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="workflow-authoring-land-draft"]')
        ?.click();
    });
    const error = await waitFor(
      "write failure",
      () => document.querySelector('[data-testid="workflow-authoring-error"]')?.textContent,
    );
    expect(error).toContain("POST /workflows failed");
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="workflow-authoring-name"]')?.value,
    ).toBe("保留名称");
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="workflow-authoring-intent"]')
        ?.value,
    ).toBe("保留意图");
    expect(document.querySelector('[data-testid="workflow-authoring-landed"]')).toBeNull();
  });

  it(
    "appends a user message into the in-process store and reloads it",
    { timeout: 20_000 },
    async () => {
      const requests: string[] = [];
      const client = createDesktopClient({
        transport: {
          async request(req) {
            requests.push(`${req.method} ${req.path}`);
            return {
              status: 500,
              headers: {},
              body: {
                type: "urn:workforce:error:write_failed",
                title: "write failed",
                status: 500,
                code: "write_failed",
                detail: "POST /workflows failed",
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
              path: "/workflows",
              params: {},
              navigate: () => undefined,
            }),
          ),
        );
      });
      const sessionLabel = await waitFor(
        "local session",
        () => document.querySelector('[data-testid="workflow-authoring-session-id"]')?.textContent,
      );
      expect(sessionLabel).toContain("cas_");
      expect(sessionLabel).toContain("Desktop-local");
      const sessionId = sessionLabel.match(/cas_[A-Za-z0-9]+/)?.[0];
      expect(sessionId).toBeTruthy();

      const send = await waitFor("enabled user append", () => {
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
      );
      expect(messages).toContain("请记下这段用户意图");
      expect(messages).toContain("用户");
      expect(document.body.innerText).toContain(AGENT_REPLY_GAP);
      expect(document.body.innerText).not.toContain("Agent 已生成");
      expect(document.querySelector('[data-testid="workflow-authoring-chat-empty"]')).toBeNull();
      expect(requests.some((item) => /chat|authoring-session/i.test(item))).toBe(false);

      await act(async () => {
        setInput("workflow-authoring-name", "保留名称");
        setInput("workflow-authoring-intent", "失败后也要在");
      });
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>('[data-testid="workflow-authoring-land-draft"]')
          ?.click();
      });
      const error = await waitFor(
        "write failure keeps chat",
        () => document.querySelector('[data-testid="workflow-authoring-error"]')?.textContent,
      );
      expect(error).toContain("POST /workflows failed");
      expect(
        document.querySelector('[data-testid="workflow-authoring-messages"]')?.textContent,
      ).toContain("请记下这段用户意图");
      expect(
        document.querySelector<HTMLTextAreaElement>('[data-testid="workflow-authoring-intent"]')
          ?.value,
      ).toBe("失败后也要在");

      await act(async () => {
        root.unmount();
      });
      roots.pop();
      reloadDefaultAuthoringSessionStoreForTests();
      const remount = document.createElement("div");
      document.body.append(remount);
      const remountRoot = createRoot(remount);
      roots.push(remountRoot);
      await act(async () => {
        remountRoot.render(
          wrap(
            client,
            createElement(WorkflowAuthoringPage, {
              path: "/workflows",
              params: {},
              navigate: () => undefined,
            }),
          ),
        );
      });
      const reloaded = await waitFor(
        "reloaded user message after renderer-store rebuild",
        () => document.querySelector('[data-testid="workflow-authoring-messages"]')?.textContent,
      );
      expect(reloaded).toContain("请记下这段用户意图");
      expect(
        document.querySelector('[data-testid="workflow-authoring-session-id"]')?.textContent,
      ).toContain(sessionId);
      expect(document.body.innerText).not.toContain("Agent 已生成");
    },
  );
});
