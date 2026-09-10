import { afterEach, describe, expect, it } from "vitest";

import { createDesktopClient, type ClientTransport } from "@workforce/desktop-client";
import type { ApiRequest, ApiResponse, WorkforcePreloadApi } from "@workforce/ui";

import {
  asCatalogClient,
  createPreloadTransport,
  getWorkforceClient,
  hasCatalogMethod,
  setWorkforceClientForTests,
} from "./_client-fallback.js";

afterEach(() => {
  setWorkforceClientForTests(null);
  delete (globalThis as { workforce?: WorkforcePreloadApi }).workforce;
});

describe("preload transport", () => {
  it("wraps window.workforce.api.request without loopback HTTP", async () => {
    const calls: ApiRequest[] = [];
    const api: WorkforcePreloadApi = {
      connection: {
        getState: async () => ({ status: "online", protocolVersion: "0.1", mode: "spawn" }),
        reconnect: async () => ({ status: "online", protocolVersion: "0.1", mode: "spawn" }),
        subscribe: () => () => undefined,
      },
      api: {
        request: async (input) => {
          calls.push(input);
          const res: ApiResponse = { ok: true, status: 200, body: { id: "prj_1" } };
          return res;
        },
        subscribeEvents: async () => ({ subscriptionId: "sub_1" }),
        unsubscribeEvents: async () => undefined,
        onEvent: () => () => undefined,
      },
      workspace: {
        pickDirectory: async () => ({
          ok: true,
          grant: { authorizationId: "wsauth_1", displayLabel: "repo" },
        }),
      },
      shell: { quitUi: async () => undefined },
    };
    const transport = createPreloadTransport(api);
    const client = createDesktopClient({ transport });
    await client.getProject("prj_1");
    expect(calls[0]?.path).toBe("/api/v1/projects/prj_1");
    expect(calls[0]?.method).toBe("GET");
  });

  it("lets tests inject a fake client", async () => {
    const transport: ClientTransport = {
      async request() {
        return {
          status: 200,
          headers: {},
          body: { items: [], page: { nextCursor: null, hasMore: false } },
        };
      },
    };
    const fake = createDesktopClient({ transport });
    setWorkforceClientForTests(fake);
    expect(getWorkforceClient()).toBe(fake);
    const page = await getWorkforceClient().listProjects();
    expect(page.items).toEqual([]);
  });

  it("sees T10 catalog methods on the typed client", () => {
    const client = createDesktopClient({
      transport: {
        async request() {
          return { status: 200, headers: {}, body: {} };
        },
      },
    });
    const catalog = asCatalogClient(client);
    expect(hasCatalogMethod(catalog, "listTeams")).toBe(true);
    expect(hasCatalogMethod(catalog, "createProjectWorkspace")).toBe(true);
    expect(hasCatalogMethod(catalog, "getProjectBudget")).toBe(true);
  });
});
