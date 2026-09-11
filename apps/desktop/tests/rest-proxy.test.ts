import { describe, expect, it } from "vitest";

import { assertSafeApiRequest, sanitizeRendererHeaders } from "../src/main/ipc/allowlist.js";
import { buildLoopbackUrl } from "../src/main/ipc/rest-proxy.js";

describe("REST proxy", () => {
  it("only targets loopback and strips renderer Authorization", () => {
    expect(buildLoopbackUrl(3456, "/health")).toBe("http://127.0.0.1:3456/health");
    expect(() => buildLoopbackUrl(0, "/health")).toThrow(/invalid loopback port/);
    const headers = sanitizeRendererHeaders({
      Authorization: "Bearer stolen",
      Cookie: "session=1",
      "If-Match": "3",
      "Idempotency-Key": "k1",
    });
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
    expect(headers["If-Match"]).toBe("3");
    expect(headers["Idempotency-Key"]).toBe("k1");
  });

  it("keeps allowlisted requests without leaking host URLs from the renderer", () => {
    const safe = assertSafeApiRequest({
      method: "GET",
      path: "/api/v1/runs/run_1",
      headers: { Authorization: "Bearer x" },
    });
    expect(safe.path).toBe("/api/v1/runs/run_1");
    expect(safe.headers).toBeUndefined();
  });

  it("preserves list query strings after allowlist checks", () => {
    const safe = assertSafeApiRequest({
      method: "GET",
      path: "/api/v1/projects?limit=20&cursor=abc",
    });
    expect(safe.path).toBe("/api/v1/projects?limit=20&cursor=abc");
  });

  it("lets the desktop page proxy published workflow catalog reads", () => {
    const listed = assertSafeApiRequest({
      method: "GET",
      path: "/api/v1/workflows?limit=20",
    });
    expect(listed.path).toBe("/api/v1/workflows?limit=20");
    const version = assertSafeApiRequest({
      method: "GET",
      path: "/api/v1/workflows/software-development-team.feature-delivery/versions/0.1.0",
    });
    expect(version.path).toBe(
      "/api/v1/workflows/software-development-team.feature-delivery/versions/0.1.0",
    );
    expect(() =>
      assertSafeApiRequest({
        method: "POST",
        path: "/api/v1/workflows",
      }),
    ).toThrow(/not on the Desktop allowlist/);
  });
});
