export const packageName = "@workforce/artifacts" as const;

export { ArtifactError, isArtifactError, type ArtifactErrorCode } from "./errors.js";
export { collectBytes, sha256Hex } from "./hash.js";
export {
  KIND_MEDIA_TYPES,
  REGISTRABLE_KINDS,
  inferKind,
  isRegistrableKind,
  parseTestResultPassed,
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
  type EvaluateInput,
  type EvaluatorOptions,
} from "./evaluation/evaluator.js";
export type {
  AcceptanceReady,
  ArtifactBytes,
  ArtifactUsePurpose,
  ArtifactUseRef,
  ArtifactVersion,
  EvaluationRecord,
  LineageRelation,
  LineageSource,
  OutputBinding,
  ReconcileResult,
  StageInput,
  StagingRef,
  StoredArtifactVersion,
} from "./types.js";
