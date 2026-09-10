export { contentDigest, parsePatchPaths } from "./digest.js";
export { integratePatches, PatchConflictError, previousApprovalStillValid } from "./integrate.js";
export { recordTargetMergeIntent } from "./merge-target.js";
export type {
  ConflictedDelivery,
  IntegratedDelivery,
  IntegratePatchesCommand,
  IntegratePatchesDeps,
  IntegrationOutcome,
  IntegrationStore,
  IntegrationWorkspacePort,
  PatchContribution,
  ReviewDigestBinding,
} from "./ports.js";
export type { ExplicitTargetMerge, TargetMergeIntent } from "./merge-target.js";
