import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  createDesktopClient,
  type ClientTransport,
  type TransportRequest,
} from "@workforce/desktop-client";
import { parseWorkflowPage } from "@workforce/protocol";
import type { ApiRequest, ApiResponse } from "@workforce/ui";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../../daemon/src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../../daemon/src/bootstrap/index.js";
import { proxyConnectedApiRequest } from "../src/main/composition.js";
import { WorkforceProvider } from "../src/renderer/app/workforce-context.js";
import {
  EMPTY_CATALOG_NOTE,
  FEATURE_DELIVERY_WORKFLOW_ID,
  UNAVAILABLE_CATALOG_NOTE,
} from "../src/renderer/features/workflows/model.js";
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
    return `\\\\.\\pipe\\WorkforceWorkflowCatalog-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-workflow-catalog-${process.pid}-${id}.lock.sock`);
}

async function startComposed(): Promise<StartedDaemon> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-workflow-catalog-"));
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

describe("desktop workflow catalog via Electron proxy", () => {
  it(
    "lists the published feature-delivery template through allowlist + composed daemon",
    { timeout: 20_000 },
    async () => {
      const daemon = await startComposed();
      const listed = await proxyConnectedApiRequest(
        { method: "GET", path: "/api/v1/workflows" },
        { port: daemon.port, session: { sessionToken: daemon.sessionToken } },
      );
      expect(listed.ok).toBe(true);
      if (!listed.ok) {
        throw new Error(listed.message);
      }
      const page = parseWorkflowPage(listed.body);
      expect(page.items.map((item) => item.id)).toEqual([FEATURE_DELIVERY_WORKFLOW_ID]);
      expect(page.items[0]?.status).toBe("published");
      expect(page.items[0]?.versions[0]?.steps.map((step) => step.id)).toEqual([
        "planning",
        "implementation",
        "integration",
        "review",
        "acceptance",
      ]);

      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });
      const workflows = await client.listWorkflows();
      expect(workflows.items.some((item) => item.id === FEATURE_DELIVERY_WORKFLOW_ID)).toBe(true);
      const workflow = await client.getWorkflow(FEATURE_DELIVERY_WORKFLOW_ID);
      expect(workflow.activeVersionId).toBe("0.1.0");
      const version = await client.getWorkflowVersion(FEATURE_DELIVERY_WORKFLOW_ID, "0.1.0");
      expect(version.immutable).toBe(true);
      expect(version.entry).toBe("planning");
    },
  );

  it(
    "renders the Workflows page from the live catalog, not empty or unavailable",
    { timeout: 20_000 },
    async () => {
      const daemon = await startComposed();
      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => {
        root.render(
          createElement(
            WorkforceProvider,
            {
              value: {
                client,
                connection: { status: "online", protocolVersion: "0.1", mode: "spawn" },
                navigate: () => undefined,
                capabilities: null,
              },
            },
            createElement(WorkflowsPage, {
              path: "/workflows",
              params: {},
              navigate: () => undefined,
            }),
          ),
        );
      });

      const row = await waitFor("published workflow row", () =>
        document.querySelector(`[data-testid="workflow-row-${FEATURE_DELIVERY_WORKFLOW_ID}"]`),
      );
      expect(row?.textContent).toContain("Feature delivery");
      expect(document.querySelector('[data-testid="workflow-error"]')).toBeNull();
      expect(document.querySelector('[data-testid="workflow-empty"]')).toBeNull();
      expect(document.body.innerText).not.toContain(UNAVAILABLE_CATALOG_NOTE);
      expect(document.body.innerText).not.toContain(EMPTY_CATALOG_NOTE);
      expect(document.body.innerText).not.toContain("当前没有已发布的工作流模板。");
    },
  );
});
