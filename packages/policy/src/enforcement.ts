import {
  CONSTRAINT,
  DEFAULT_POLICY_VERSION,
  type CapabilityRecord,
  type PolicyDecision,
  type RequestedConstraint,
} from "./types.js";

/**
 * Mock Runtime: only constraints the Host/Mock can actually stop or bound.
 * Capability flags are not permissions (D12).
 */
export const MOCK_CAPABILITIES: readonly CapabilityRecord[] = [
  { name: CONSTRAINT.sandboxStrong, status: "unsupported", owner: "T07" },
  { name: CONSTRAINT.moneyHardCap, status: "unsupported", owner: "T07" },
  { name: CONSTRAINT.pause, status: "unsupported", owner: "T15" },
  { name: CONSTRAINT.eventResume, status: "unsupported", owner: "T15" },
  { name: CONSTRAINT.networkOff, status: "enforceable", owner: "T05" },
  { name: CONSTRAINT.workspaceWrite, status: "enforceable", owner: "T06" },
  { name: CONSTRAINT.timeLimit, status: "enforceable", owner: "T05" },
  { name: CONSTRAINT.retryLimit, status: "enforceable", owner: "T09" },
  { name: CONSTRAINT.concurrencyLimit, status: "enforceable", owner: "T09" },
  { name: CONSTRAINT.usageTokens, status: "enforceable", owner: "T05" },
  { name: CONSTRAINT.commandApproval, status: "enforceable", owner: "T07" },
];

/**
 * Codex CLI on the measured Windows host (docs/spikes): not a strong sandbox,
 * pause unsupported, money hard cap not enforceable, CLI flags ≠ policy.
 */
export const CODEX_WINDOWS_CAPABILITIES: readonly CapabilityRecord[] = [
  { name: CONSTRAINT.sandboxStrong, status: "unsupported", owner: "T07" },
  { name: CONSTRAINT.moneyHardCap, status: "unsupported", owner: "T07" },
  { name: CONSTRAINT.pause, status: "unsupported", owner: "T15" },
  { name: CONSTRAINT.eventResume, status: "unsupported", owner: "T15" },
  { name: CONSTRAINT.networkOff, status: "observable", owner: "T07" },
  { name: CONSTRAINT.workspaceWrite, status: "observable", owner: "T07" },
  { name: CONSTRAINT.commandApproval, status: "observable", owner: "T07" },
  { name: CONSTRAINT.usageTokens, status: "observable", owner: "T15" },
  { name: CONSTRAINT.timeLimit, status: "enforceable", owner: "T06" },
];

export function capabilitiesForRuntime(runtime: string): readonly CapabilityRecord[] {
  if (runtime === "mock") {
    return MOCK_CAPABILITIES;
  }
  if (runtime === "codex") {
    return CODEX_WINDOWS_CAPABILITIES;
  }
  return [];
}

/**
 * Hard limits may start only when the runtime can enforce them.
 * Observable / untested / unsupported are not treated as already executed.
 */
export function evaluateEnforcement(input: {
  requested: readonly RequestedConstraint[];
  capabilities: readonly CapabilityRecord[];
  policyVersion?: string;
}): PolicyDecision {
  const policyVersion = input.policyVersion ?? DEFAULT_POLICY_VERSION;
  const byName = new Map(input.capabilities.map((item) => [item.name, item]));

  for (const requested of input.requested) {
    if (!requested.hard) {
      continue;
    }
    const capability = byName.get(requested.name);
    const status = capability?.status ?? "unsupported";
    if (status === "enforceable") {
      continue;
    }
    const code =
      requested.name === CONSTRAINT.moneyHardCap
        ? "unknown_cost_not_enforceable"
        : "unsupported_capability";
    return {
      decision: "deny",
      policyVersion,
      reason: `${code}:${requested.name}:${status}`,
    };
  }

  return { decision: "allow", policyVersion };
}
