import { describe, expect, it } from "vitest";

import { MOCK_PLAN_DOCUMENT } from "@workforce/application";
import { InMemoryPolicyEngine, createCanonicalAction } from "@workforce/policy";

import { CompositionPolicy, createCompositionPolicy } from "../src/composition/policy.js";
import { AppError } from "../src/modules/errors.js";

describe("CompositionPolicy", () => {
  it("allows a Mock start that does not request an unenforceable hard limit", async () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    await expect(
      policy.assertStartAllowed({ runtime: "mock", resource: "project:prj_1" }),
    ).resolves.toBeUndefined();
  });

  it("rejects a Mock start that requests a monetary hard cap", async () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    await expect(
      policy.assertStartAllowed({
        runtime: "mock",
        resource: "project:prj_1",
        budgetHardLimitMinor: 100,
      }),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "unknown_cost_not_enforceable",
    });
  });

  it("rejects pause when the runtime cannot enforce lifecycle.pause", async () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    await expect(policy.assertPauseAllowed("mock")).rejects.toMatchObject({
      name: "AppError",
      code: "unsupported_capability",
      message: "lifecycle.pause is unsupported",
    });
  });

  it("computes a stable plan.apply digest from the frozen plan document", () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    const action = policy.planApplyAction({
      resource: "artifactVersion:arv_plan",
      version: "arv_plan",
      plan: MOCK_PLAN_DOCUMENT,
    });
    const reordered = policy.planApplyAction({
      resource: "artifactVersion:arv_plan",
      version: "arv_plan",
      plan: { ...MOCK_PLAN_DOCUMENT },
    });
    expect(action.digest).toBe(reordered.digest);
    expect(action.digest).toBe(
      createCanonicalAction({
        type: "plan.apply",
        resource: "artifactVersion:arv_plan",
        version: "arv_plan",
        params: MOCK_PLAN_DOCUMENT,
      }).digest,
    );
    expect(action.type).toBe("plan.apply");
  });

  it("changes the artifact digest when the version or hash changes", () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    const first = policy.artifactPublishAction({
      resource: "artifactVersion:arv_1",
      version: "arv_1",
      hash: "aaa",
      slotId: "integrated",
    });
    const sameParamsNewVersion = policy.artifactPublishAction({
      resource: "artifactVersion:arv_2",
      version: "arv_2",
      hash: "aaa",
      slotId: "integrated",
    });
    const changedHash = policy.artifactPublishAction({
      resource: "artifactVersion:arv_1",
      version: "arv_1",
      hash: "bbb",
      slotId: "integrated",
    });
    expect(first.digest).not.toBe(changedHash.digest);
    expect(first.version).not.toBe(sameParamsNewVersion.version);
    expect(first.digest).toBe(sameParamsNewVersion.digest);
  });

  it("rejects a consume when the provided digest does not match", () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    const action = policy.planApplyAction({
      resource: "artifactVersion:arv_plan",
      plan: MOCK_PLAN_DOCUMENT,
    });
    expect(() => policy.assertDigestMatch(action.digest, "deadbeef")).toThrow(AppError);
    try {
      policy.assertDigestMatch(action.digest, "deadbeef");
    } catch (error) {
      expect(error).toMatchObject({ code: "conflict" });
    }
  });

  it("consumes a recorded grant on the matching canonical action", async () => {
    const policy = createCompositionPolicy({ principalId: "usr_test" });
    const action = policy.planApplyAction({
      resource: "artifactVersion:arv_plan",
      version: "arv_plan",
      plan: MOCK_PLAN_DOCUMENT,
    });
    await expect(
      policy.consumeGrant({
        action,
        gate: "plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ decision: "allow", reason: "grant_consumed" });
    await expect(
      policy.consumeGrant({
        action,
        gate: "plan",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets an injected engine deny runtime.start", async () => {
    const engine = new InMemoryPolicyEngine({
      principalId: "usr_test",
      rules: [{ actionType: "runtime.start", decision: "deny", reason: "denied:runtime.start" }],
    });
    const policy = new CompositionPolicy(engine);
    await expect(policy.assertStartAllowed({ runtime: "mock" })).rejects.toMatchObject({
      code: "forbidden",
      message: "denied:runtime.start",
    });
  });
});
