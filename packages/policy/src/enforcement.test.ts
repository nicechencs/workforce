import { describe, expect, it } from "vitest";

import {
  CODEX_WINDOWS_CAPABILITIES,
  MOCK_CAPABILITIES,
  evaluateEnforcement,
} from "./enforcement.js";
import { CONSTRAINT } from "./types.js";

describe("evaluateEnforcement", () => {
  it("allows Mock start when every hard limit is enforceable", () => {
    const decision = evaluateEnforcement({
      requested: [
        { name: CONSTRAINT.workspaceWrite, hard: true },
        { name: CONSTRAINT.timeLimit, hard: true },
        { name: CONSTRAINT.usageTokens, hard: true },
      ],
      capabilities: MOCK_CAPABILITIES,
    });
    expect(decision.decision).toBe("allow");
  });

  it("denies strong sandbox as unsupported instead of pretending it ran", () => {
    const decision = evaluateEnforcement({
      requested: [{ name: CONSTRAINT.sandboxStrong, hard: true }],
      capabilities: MOCK_CAPABILITIES,
    });
    expect(decision).toMatchObject({
      decision: "deny",
      reason: "unsupported_capability:sandbox.strong:unsupported",
    });
  });

  it("denies a monetary hard cap when cost cannot be enforced", () => {
    const decision = evaluateEnforcement({
      requested: [{ name: CONSTRAINT.moneyHardCap, hard: true }],
      capabilities: MOCK_CAPABILITIES,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/^unknown_cost_not_enforceable:budget.money.hard_cap/);
  });

  it("denies pause when the runtime cannot pause", () => {
    const decision = evaluateEnforcement({
      requested: [{ name: CONSTRAINT.pause, hard: true }],
      capabilities: MOCK_CAPABILITIES,
    });
    expect(decision.reason).toBe("unsupported_capability:lifecycle.pause:unsupported");
  });

  it("does not treat Codex observable flags as enforcement", () => {
    const decision = evaluateEnforcement({
      requested: [{ name: CONSTRAINT.networkOff, hard: true }],
      capabilities: CODEX_WINDOWS_CAPABILITIES,
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toBe("unsupported_capability:network.off:observable");
  });

  it("ignores soft (non-hard) requested constraints", () => {
    const decision = evaluateEnforcement({
      requested: [{ name: CONSTRAINT.sandboxStrong, hard: false }],
      capabilities: MOCK_CAPABILITIES,
    });
    expect(decision.decision).toBe("allow");
  });
});
