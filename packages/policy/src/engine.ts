import type { ApprovalGate } from "@workforce/domain";

import { createCanonicalAction } from "./digest.js";
import { capabilitiesForRuntime, evaluateEnforcement } from "./enforcement.js";
import { InMemoryGrantStore } from "./grants.js";
import { authorizeWorkspacePath } from "./paths.js";
import type {
  ApprovalGrant,
  CanonicalAction,
  CapabilityRecord,
  Clock,
  GrantStore,
  PolicyDecision,
  PolicyEngine,
  PolicyRule,
  RequestedConstraint,
  WorkspaceGrant,
} from "./types.js";
import { DEFAULT_POLICY_VERSION } from "./types.js";

const DENY_ALWAYS = new Set([
  "credential.copy_env",
  "credential.copy_auth_json",
  "credential.export",
  "sandbox.bypass",
  "runtime.flag.dangerously-bypass-approvals-and-sandbox",
]);

export const DEFAULT_RULES: readonly PolicyRule[] = [
  { actionType: "workspace.read", decision: "allow" },
  { actionType: "workspace.write", decision: "allow" },
  { actionType: "run.inspect", decision: "allow" },
  { actionType: "runtime.start", decision: "allow" },
  { actionType: "process.spawn", decision: "allow" },
  { actionType: "git.push", decision: "require_approval", gate: "action" },
  { actionType: "git.force", decision: "require_approval", gate: "action" },
  { actionType: "network.connect", decision: "require_approval", gate: "action" },
  { actionType: "process.spawn.unrestricted", decision: "require_approval", gate: "action" },
  { actionType: "artifact.publish", decision: "require_approval", gate: "artifact" },
  { actionType: "plan.apply", decision: "require_approval", gate: "plan" },
  { actionType: "budget.override", decision: "require_approval", gate: "budget" },
  { actionType: "sandbox.bypass", decision: "deny" },
  { actionType: "credential.copy_env", decision: "deny" },
  { actionType: "credential.copy_auth_json", decision: "deny" },
  { actionType: "credential.export", decision: "deny" },
];

export interface InMemoryPolicyEngineOptions {
  principalId?: string;
  policyVersion?: string;
  clock?: Clock;
  grants?: GrantStore;
  rules?: readonly PolicyRule[];
  workspaceGrants?: readonly WorkspaceGrant[];
  allowedCommands?: readonly string[];
  capabilities?: Readonly<Record<string, readonly CapabilityRecord[]>>;
}

export class InMemoryPolicyEngine implements PolicyEngine {
  readonly principalId: string;
  readonly policyVersion: string;
  private readonly clock: Clock;
  private readonly grants: GrantStore;
  private readonly rules: Map<string, PolicyRule>;
  private readonly workspaceGrants: readonly WorkspaceGrant[];
  private readonly allowedCommands: readonly string[];
  private readonly capabilities: Readonly<Record<string, readonly CapabilityRecord[]>>;

  constructor(options: InMemoryPolicyEngineOptions = {}) {
    this.principalId = options.principalId ?? "usr_local";
    this.policyVersion = options.policyVersion ?? DEFAULT_POLICY_VERSION;
    this.clock = options.clock ?? { now: () => new Date() };
    this.grants = options.grants ?? new InMemoryGrantStore();
    this.rules = new Map((options.rules ?? DEFAULT_RULES).map((rule) => [rule.actionType, rule]));
    this.workspaceGrants = options.workspaceGrants ?? [];
    this.allowedCommands = options.allowedCommands ?? [];
    this.capabilities = options.capabilities ?? {
      mock: capabilitiesForRuntime("mock"),
      codex: capabilitiesForRuntime("codex"),
    };
  }

  async decide(action: CanonicalAction): Promise<PolicyDecision> {
    if (DENY_ALWAYS.has(action.type)) {
      return this.deny(`denied:${action.type}`);
    }

    if (action.type === "workspace.read" || action.type === "workspace.write") {
      const write = action.type === "workspace.write";
      if (!authorizeWorkspacePath(this.workspaceGrants, action.resource, write)) {
        return this.deny("unauthorized_path");
      }
    }

    if (action.type === "process.spawn" && !this.commandAllowed(action.resource)) {
      return this.deny("unauthorized_command");
    }

    const rule = this.rules.get(action.type);
    if (!rule) {
      return this.deny("default_deny");
    }
    if (rule.decision === "deny") {
      return this.deny(rule.reason ?? `denied:${action.type}`);
    }
    if (rule.decision === "allow") {
      return { decision: "allow", policyVersion: this.policyVersion };
    }

    const existing = await this.grants.find({
      actionType: action.type,
      digest: action.digest,
      resource: action.resource,
      principalId: this.principalId,
      policyVersion: this.policyVersion,
      ...(action.version !== undefined ? { version: action.version } : {}),
    });
    if (!existing) {
      return this.requireApproval(rule.gate);
    }
    if (Date.parse(existing.expiresAt) <= this.clock.now().getTime()) {
      return this.requireApproval(rule.gate, "grant_expired");
    }
    if (existing.consumedAt !== undefined) {
      return this.requireApproval(rule.gate, "grant_consumed");
    }
    const consumed = await this.grants.consume(existing.id, this.clock.now().toISOString());
    if (!consumed) {
      return this.requireApproval(rule.gate, "grant_consumed");
    }
    return { decision: "allow", policyVersion: this.policyVersion, reason: "grant_consumed" };
  }

  async decideStart(input: {
    runtime: string;
    requested: readonly RequestedConstraint[];
    params?: unknown;
    resource?: string;
  }): Promise<PolicyDecision> {
    const capabilities = this.capabilities[input.runtime] ?? capabilitiesForRuntime(input.runtime);
    const enforcement = evaluateEnforcement({
      requested: input.requested,
      capabilities,
      policyVersion: this.policyVersion,
    });
    if (enforcement.decision === "deny") {
      return enforcement;
    }
    return this.decide(
      createCanonicalAction({
        type: "runtime.start",
        resource: input.resource ?? `runtime:${input.runtime}`,
        params: input.params ?? { runtime: input.runtime, requested: input.requested },
      }),
    );
  }

  async recordGrant(input: {
    action: CanonicalAction;
    gate: ApprovalGate;
    expiresAt: string;
    principalId?: string;
    policyVersion?: string;
  }): Promise<ApprovalGrant> {
    const id = this.grants.nextId();
    const grant: ApprovalGrant = {
      id,
      actionType: input.action.type,
      digest: input.action.digest,
      resource: input.action.resource,
      principalId: input.principalId ?? this.principalId,
      policyVersion: input.policyVersion ?? this.policyVersion,
      gate: input.gate,
      expiresAt: input.expiresAt,
    };
    if (input.action.version !== undefined) {
      grant.version = input.action.version;
    }
    await this.grants.put(grant);
    return grant;
  }

  /**
   * External model/runtime text is data. It must not load rules or grants (D12).
   */
  observeExternalText(text: string): void {
    void text;
  }

  private commandAllowed(resource: string): boolean {
    const exe = resource.replace(/\\/g, "/").split("/").pop() ?? resource;
    const name = exe.toLowerCase().replace(/\.exe$/u, "");
    return this.allowedCommands.some((allowed) => allowed.toLowerCase() === name);
  }

  private deny(reason: string): PolicyDecision {
    return { decision: "deny", policyVersion: this.policyVersion, reason };
  }

  private requireApproval(gate: ApprovalGate | undefined, reason?: string): PolicyDecision {
    return {
      decision: "require_approval",
      policyVersion: this.policyVersion,
      reason: reason ?? (gate !== undefined ? `gate:${gate}` : "require_approval"),
    };
  }
}
