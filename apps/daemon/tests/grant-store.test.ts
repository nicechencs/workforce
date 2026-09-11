import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCanonicalAction } from "@workforce/policy";

import { ComposedAppServices, createComposedAppServices } from "../src/composition/index.js";

const dirs: string[] = [];
const services: ComposedAppServices[] = [];

afterEach(async () => {
  for (const item of services.splice(0)) {
    await item.close();
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function openServices(stateDir?: string): Promise<ComposedAppServices> {
  const dir = stateDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "wf-grant-"));
  if (!stateDir) {
    dirs.push(dir);
  }
  const opened = await createComposedAppServices({ stateDir: dir, completeAfterMs: 5 });
  services.push(opened);
  return opened;
}

describe("composed SqliteGrantStore restart", () => {
  it("keeps an unconsumed grant enforceable after restarting the same stateDir", async () => {
    const first = await openServices();
    const action = createCanonicalAction({
      type: "git.push",
      resource: "origin",
      params: { remote: "origin", force: false },
    });
    await first.policy.engine.recordGrant({
      action,
      gate: "action",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const stateDir = first.stateDir;
    await first.close();

    fs.unlinkSync(path.join(stateDir, "world.json"));

    const second = await openServices(stateDir);
    await expect(second.policy.engine.decide(action)).resolves.toMatchObject({
      decision: "allow",
      reason: "grant_consumed",
    });
    await expect(second.policy.engine.decide(action)).resolves.toMatchObject({
      decision: "require_approval",
      reason: "grant_consumed",
    });
  });

  it("does not reuse a consumed grant after restart", async () => {
    const first = await openServices();
    const action = createCanonicalAction({
      type: "plan.apply",
      resource: "plan:restart",
      params: { revision: 1 },
    });
    await first.policy.consumeGrant({
      action,
      gate: "plan",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const stateDir = first.stateDir;
    await first.close();

    const second = await openServices(stateDir);
    await expect(second.policy.engine.decide(action)).resolves.toMatchObject({
      decision: "require_approval",
      reason: "grant_consumed",
    });
    await expect(
      second.policy.consumeGrant({
        action,
        gate: "plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("still denies copy-env after restart even if a grant row was recorded", async () => {
    const first = await openServices();
    const action = createCanonicalAction({
      type: "credential.copy_env",
      resource: "env",
    });
    await first.policy.engine.recordGrant({
      action,
      gate: "action",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const stateDir = first.stateDir;
    await first.close();

    const second = await openServices(stateDir);
    await expect(second.policy.engine.decide(action)).resolves.toMatchObject({
      decision: "deny",
      reason: "denied:credential.copy_env",
    });
  });
});
