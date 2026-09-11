import type { ApprovalGate } from "@workforce/domain";

/** Matches `packages/application` PolicyEngine port (T02). */
export type PolicyDecisionName = "allow" | "deny" | "require_approval";

/** Matches `packages/application` CanonicalAction port (T02). */
export interface CanonicalAction {
  type: string;
  digest: string;
  resource: string;
  version?: string;
}

/** Matches `packages/application` PolicyDecision port (T02). */
export interface PolicyDecision {
  decision: PolicyDecisionName;
  policyVersion: string;
  reason?: string;
}

/** Matches `packages/application` PolicyEngine port (T02). */
export interface PolicyEngine {
  decide(action: CanonicalAction): Promise<PolicyDecision>;
}

export interface Clock {
  now(): Date;
}

export const DEFAULT_POLICY_VERSION = "0.1.0" as const;

export const CONSTRAINT = {
  sandboxStrong: "sandbox.strong",
  moneyHardCap: "budget.money.hard_cap",
  pause: "lifecycle.pause",
  eventResume: "event.resume",
  networkOff: "network.off",
  workspaceWrite: "workspace.write",
  timeLimit: "time.limit",
  retryLimit: "retry.limit",
  concurrencyLimit: "concurrency.limit",
  usageTokens: "usage.tokens",
  commandApproval: "command.approval",
} as const;

export type ConstraintName = (typeof CONSTRAINT)[keyof typeof CONSTRAINT] | (string & {});

export type EnforcementStatus = "enforceable" | "observable" | "unsupported" | "untested";

export interface CapabilityRecord {
  name: string;
  status: EnforcementStatus;
  owner?: string;
}

export interface RequestedConstraint {
  name: string;
  hard: boolean;
}

export interface PolicyRule {
  actionType: string;
  decision: PolicyDecisionName;
  gate?: ApprovalGate;
  reason?: string;
}

export interface WorkspaceGrant {
  workspaceId: string;
  /** Logical root. Host absolute paths stay inside this grant, not in public DTOs. */
  root: string;
  mode: "read" | "readwrite";
}

export interface ApprovalGrant {
  id: string;
  actionType: string;
  digest: string;
  resource: string;
  version?: string;
  principalId: string;
  policyVersion: string;
  gate: ApprovalGate;
  expiresAt: string;
  consumedAt?: string;
}

export interface GrantKey {
  actionType: string;
  digest: string;
  resource: string;
  version?: string;
  principalId: string;
  policyVersion: string;
}

export interface GrantStore {
  nextId(): string;
  put(grant: ApprovalGrant): Promise<void>;
  find(key: GrantKey): Promise<ApprovalGrant | undefined>;
  consume(id: string, consumedAt: string): Promise<boolean>;
}

export type CredentialStatus = "active" | "revoked" | "expired";

export interface CredentialRef {
  id: string;
  provider: string;
  displayName: string;
  scopes: string[];
  status: CredentialStatus;
  expiresAt?: string;
  lastVerifiedAt?: string;
  rotationId?: string;
}

export type InjectionMode = "stdin" | "env_key";

export interface InjectRequest {
  credentialRefId: string;
  mode: InjectionMode;
  envKey?: string;
}

export interface MinimalInjection {
  credentialRefId: string;
  mode: InjectionMode;
  extraEnv?: Readonly<{ key: string; value: string }>;
  stdinSecret?: string;
}
