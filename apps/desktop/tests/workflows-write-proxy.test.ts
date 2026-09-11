import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  createDesktopClient,
  type ClientTransport,
  type TransportRequest,
} from "@workforce/desktop-client";
import { parseWorkflow, parseWorkflowVersion } from "@workforce/protocol";
import type { ApiRequest, ApiResponse } from "@workforce/ui";
import { afterEach, describe, expect, it } from "vitest";

import { createComposedAppServices } from "../../daemon/src/composition/index.js";
import { startDaemon, type StartedDaemon } from "../../daemon/src/bootstrap/index.js";
import { proxyConnectedApiRequest } from "../src/main/composition.js";
import { addNode, connectNodes } from "../src/renderer/features/workflows/graph/operations.js";
import {
  emptyCanvasGraph,
  toGraphPayload,
} from "../src/renderer/features/workflows/graph/types.js";
import { loadCanvasSession } from "../src/renderer/features/workflows/canvas/page.js";
import {
  persistWorkflowDraft,
  publishWorkflowDraft,
} from "../src/renderer/features/workflows/write-client.js";

interface Harness {
  daemon: StartedDaemon;
  stateDir: string;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const item of harnesses.splice(0)) {
    await item.daemon.close();
    fs.rmSync(item.stateDir, { recursive: true, force: true });
  }
});

function uniqueLockPath(): string {
  const id = randomBytes(6).toString("hex");
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\WorkforceWorkflowWrite-${process.pid}-${id}`;
  }
  return path.join(os.tmpdir(), `workforce-workflow-write-${process.pid}-${id}.lock.sock`);
}

async function startComposed(): Promise<StartedDaemon> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-workflow-write-"));
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

function linearDraftGraph() {
  const first = addNode(emptyCanvasGraph(), "task", "plan");
  const second = addNode(first, "task", "build");
  return connectNodes(second, "plan", "build", "outputs_ready").graph;
}

describe("desktop workflow writes via Electron proxy", () => {
  it(
    "saves an unpublished draft through allowlisted write paths and reloads the same graph",
    { timeout: 20_000 },
    async () => {
      const daemon = await startComposed();
      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });
      const graph = linearDraftGraph();

      const saved = await persistWorkflowDraft(client, {
        workflowId: null,
        versionId: "draft",
        name: "Canvas draft",
        description: "truewindow save",
        graph: toGraphPayload(graph),
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) {
        throw new Error(saved.error);
      }

      const publishedList = await client.listWorkflows();
      expect(publishedList.items.some((item) => item.id === saved.workflowId)).toBe(false);

      const reloaded = await client.getWorkflow(saved.workflowId);
      const workflow = parseWorkflow(reloaded);
      expect(workflow.name).toBe("Canvas draft");
      expect(workflow.status).toBe("draft");
      const version = workflow.versions.find((item) => item.id === saved.versionId);
      expect(version?.status).toBe("draft");
      expect(version?.nodes?.map((node) => node.id)).toEqual(["plan", "build"]);
      expect(version?.edges?.map((edge) => `${edge.from}->${edge.to}`)).toEqual(["plan->build"]);

      const versionDto = parseWorkflowVersion(
        await client.getWorkflowVersion(saved.workflowId, saved.versionId),
      );
      expect(versionDto.nodes?.map((node) => node.id)).toEqual(["plan", "build"]);

      const session = await loadCanvasSession(client, saved.workflowId, saved.versionId);
      expect(session.draft.name).toBe("Canvas draft");
      expect(session.draft.graph.nodes.map((node) => node.id)).toEqual(["plan", "build"]);
      expect(session.draft.graph.edges).toHaveLength(1);
      expect(session.mode).toBe("edit");
    },
  );

  it(
    "publishes a valid saved draft and honestly fails an empty graph",
    { timeout: 20_000 },
    async () => {
      const daemon = await startComposed();
      const client = createDesktopClient({ transport: createElectronProxyTransport(daemon) });

      const emptySaved = await persistWorkflowDraft(client, {
        workflowId: null,
        versionId: "draft",
        name: "Empty draft",
        description: "",
        graph: toGraphPayload(emptyCanvasGraph()),
      });
      expect(emptySaved.ok).toBe(true);
      if (!emptySaved.ok) {
        throw new Error(emptySaved.error);
      }
      const emptyPublish = await publishWorkflowDraft(client, {
        workflowId: emptySaved.workflowId,
        versionId: emptySaved.versionId,
        versionRevision: emptySaved.revisions.versionRevision,
      });
      expect(emptyPublish.ok).toBe(false);
      if (!emptyPublish.ok) {
        expect(emptyPublish.error).toMatch(/finite DAG|nodes/i);
      }
      const stillDraft = await client.getWorkflowVersion(
        emptySaved.workflowId,
        emptySaved.versionId,
      );
      expect(stillDraft.status).toBe("draft");

      const saved = await persistWorkflowDraft(client, {
        workflowId: null,
        versionId: "draft",
        name: "Publishable",
        description: "",
        graph: toGraphPayload(linearDraftGraph()),
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) {
        throw new Error(saved.error);
      }
      const published = await publishWorkflowDraft(client, {
        workflowId: saved.workflowId,
        versionId: saved.versionId,
        versionRevision: saved.revisions.versionRevision,
      });
      expect(published.ok).toBe(true);
      const version = await client.getWorkflowVersion(saved.workflowId, saved.versionId);
      expect(version.status).toBe("published");
      expect(version.immutable).toBe(true);
    },
  );
});
