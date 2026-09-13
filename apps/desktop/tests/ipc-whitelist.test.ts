import { describe, expect, it } from "vitest";

import { IpcAccessDeniedError } from "../src/preload/contracts.js";
import { isAllowedApiRequest } from "../src/main/ipc/allowlist.js";
import { dispatchIpc } from "../src/main/ipc/router.js";
import { EventSubscriptionHub } from "../src/main/ipc/subscriptions.js";
import { WorkspaceGrantStore } from "../src/main/ipc/workspace-picker.js";

function deps() {
  return {
    getConnection: async () => ({ status: "loading" as const }),
    reconnect: async () => ({ status: "offline" as const }),
    requestApi: async () => ({ ok: true, status: 200, body: {} }),
    dialog: { pick: async () => null },
    grants: new WorkspaceGrantStore(),
    subscriptions: new EventSubscriptionHub(),
    quitUi: async () => undefined,
  };
}

describe("IPC whitelist", () => {
  it("rejects unknown channels including fs and shell", async () => {
    await expect(
      dispatchIpc("fs.readFile", { path: "C\\\\Windows\\\\system32" }, deps()),
    ).rejects.toBeInstanceOf(IpcAccessDeniedError);
    await expect(
      dispatchIpc("child_process.exec", { command: "whoami" }, deps()),
    ).rejects.toBeInstanceOf(IpcAccessDeniedError);
    await expect(dispatchIpc("workforce:open-path", { path: "/" }, deps())).rejects.toBeInstanceOf(
      IpcAccessDeniedError,
    );
  });

  it("rejects malformed api request payloads before proxying", async () => {
    await expect(dispatchIpc("workforce:api:request", null, deps())).rejects.toThrow(/allowlist/);
    await expect(dispatchIpc("workforce:api:request", "GET /health", deps())).rejects.toThrow(
      /allowlist/,
    );
  });

  it("ignores non-array event subscribe types instead of spreading a string", async () => {
    const d = deps();
    const result = await dispatchIpc(
      "workforce:events:subscribe",
      { types: "run.status_changed" },
      d,
    );
    expect(result).toEqual({ subscriptionId: "sub_1" });
    expect(d.subscriptions.list()[0]?.types).toEqual([]);
  });

  it("allows only capability-matrix API paths", () => {
    expect(isAllowedApiRequest({ method: "GET", path: "/health" })).toBe(true);
    expect(isAllowedApiRequest({ method: "GET", path: "/api/v1/projects" })).toBe(true);
    expect(isAllowedApiRequest({ method: "POST", path: "/api/v1/runs/run_1:cancel" })).toBe(true);
    expect(isAllowedApiRequest({ method: "GET", path: "/etc/passwd" })).toBe(false);
    expect(isAllowedApiRequest({ method: "GET", path: "/api/v1/../health" })).toBe(false);
    expect(isAllowedApiRequest({ method: "POST", path: "/api/v1/projects" })).toBe(true);
    expect(isAllowedApiRequest({ method: "DELETE", path: "/api/v1/projects" })).toBe(false);
  });

  it("allows workflow catalog read and write paths used by the desktop page", () => {
    const featureDelivery = "software-development-team.feature-delivery";
    expect(isAllowedApiRequest({ method: "GET", path: "/api/v1/workflows" })).toBe(true);
    expect(
      isAllowedApiRequest({
        method: "GET",
        path: `/api/v1/workflows/${featureDelivery}`,
      }),
    ).toBe(true);
    expect(
      isAllowedApiRequest({
        method: "GET",
        path: `/api/v1/workflows/${featureDelivery}/versions/0.1.0`,
      }),
    ).toBe(true);
    expect(
      isAllowedApiRequest({
        method: "GET",
        path: `/api/v1/workflows?limit=20`,
      }),
    ).toBe(true);
    expect(isAllowedApiRequest({ method: "POST", path: "/api/v1/workflows" })).toBe(true);
    expect(
      isAllowedApiRequest({
        method: "PATCH",
        path: `/api/v1/workflows/${featureDelivery}`,
      }),
    ).toBe(true);
    expect(
      isAllowedApiRequest({
        method: "POST",
        path: `/api/v1/workflows/${featureDelivery}/versions/0.1.0:publish`,
      }),
    ).toBe(true);
  });
});
