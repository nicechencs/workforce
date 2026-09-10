import { ArtifactError } from "./errors.js";
import type { ArtifactUsePurpose, ArtifactUseRef } from "./types.js";

export function requireArtifactVersionId(
  ref: ArtifactUseRef,
  purpose: ArtifactUsePurpose,
): string | { artifactId: string; latest: true } | { artifactId: string; version: number } {
  if ("artifactVersionId" in ref) {
    if (ref.artifactVersionId.length === 0) {
      throw new ArtifactError("ARTIFACT_VERSION_REQUIRED", "artifactVersionId is empty", {
        details: { purpose },
      });
    }
    return ref.artifactVersionId;
  }
  if ("latest" in ref && ref.latest) {
    if (purpose !== "browse") {
      throw new ArtifactError(
        "ARTIFACT_VERSION_REQUIRED",
        `latest is not allowed for ${purpose}; pass artifactVersionId`,
        { details: { purpose, artifactId: ref.artifactId } },
      );
    }
    return { artifactId: ref.artifactId, latest: true as const };
  }
  if ("version" in ref) {
    return { artifactId: ref.artifactId, version: ref.version };
  }
  throw new ArtifactError(
    "ARTIFACT_VERSION_REQUIRED",
    `artifactVersionId required for ${purpose}`,
    {
      details: { purpose },
    },
  );
}
