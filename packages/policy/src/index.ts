export const packageName = "@workforce/policy" as const;

export {
  createCanonicalAction,
  canonicalize,
  parameterDigest,
  sha256Hex,
  stableJson,
} from "./digest.js";
export {
  CODEX_WINDOWS_CAPABILITIES,
  MOCK_CAPABILITIES,
  capabilitiesForRuntime,
  evaluateEnforcement,
} from "./enforcement.js";
export { DEFAULT_RULES, InMemoryPolicyEngine } from "./engine.js";
export type { InMemoryPolicyEngineOptions } from "./engine.js";
export { InMemoryGrantStore } from "./grants.js";
export {
  CredentialBrokerError,
  InMemoryCredentialBroker,
  InMemorySecretStore,
} from "./credentials.js";
export type {
  CredentialBrokerErrorCode,
  CredentialBrokerOptions,
  SecretStore,
} from "./credentials.js";
export { authorizeWorkspacePath, normalizeLogicalPath, pathInsideGrant } from "./paths.js";
export { CONSTRAINT, DEFAULT_POLICY_VERSION } from "./types.js";
export type {
  ApprovalGrant,
  CanonicalAction,
  CapabilityRecord,
  Clock,
  ConstraintName,
  CredentialRef,
  CredentialStatus,
  EnforcementStatus,
  GrantKey,
  GrantStore,
  InjectRequest,
  InjectionMode,
  MinimalInjection,
  PolicyDecision,
  PolicyDecisionName,
  PolicyEngine,
  PolicyRule,
  RequestedConstraint,
  WorkspaceGrant,
} from "./types.js";
