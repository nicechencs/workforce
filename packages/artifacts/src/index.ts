export const packageName = "@workforce/artifacts" as const;

export { ArtifactError, isArtifactError, type ArtifactErrorCode } from "./errors.js";
export { collectBytes, sha256Hex } from "./hash.js";
export {
  KIND_MEDIA_TYPES,
  REGISTRABLE_KINDS,
  inferKind,
  isRegistrableKind,
  parseTestResultPassed,
  summarizeRegistrableContent,
  verifyKindContent,
  type RegistrableKind,
} from "./kinds.js";
export { detectLineageCycle } from "./lineage/graph.js";
export { requireArtifactVersionId } from "./refs.js";
export {
  LocalArtifactStore,
  type LocalArtifactStoreOptions,
} from "./registration/local-artifact-store.js";
export {
  ArtifactEvaluator,
  type EvaluateCriterion,
  type EvaluateInput,
  type EvaluatorOptions,
  type PolicyPort,
  type ProcessPort,
} from "./evaluation/evaluator.js";
export {
  commandCriterionPassed,
  describeProcessExit,
  waitCapturedExit,
} from "./evaluation/command.js";
export type {
  AcceptanceBlocker,
  AcceptanceEvidence,
  AcceptanceReady,
  ArtifactBytes,
  ArtifactUsePurpose,
  ArtifactUseRef,
  ArtifactVersion,
  EvaluationRecord,
  LineageRelation,
  LineageSource,
  OutputBinding,
  QuarantineRecord,
  ReconcileResult,
  RetentionRecord,
  StageInput,
  StagingRef,
  StoredArtifactVersion,
} from "./types.js";
