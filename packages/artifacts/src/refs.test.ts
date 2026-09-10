import { describe, expect, it } from "vitest";

import { requireArtifactVersionId } from "./refs.js";

describe("requireArtifactVersionId", () => {
  it("accepts an exact artifactVersionId for execution purposes", () => {
    expect(requireArtifactVersionId({ artifactVersionId: "arv_1" }, "input")).toBe("arv_1");
    expect(requireArtifactVersionId({ artifactVersionId: "arv_1" }, "approval")).toBe("arv_1");
    expect(requireArtifactVersionId({ artifactVersionId: "arv_1" }, "read")).toBe("arv_1");
  });

  it("rejects latest except for browse", () => {
    expect(() => requireArtifactVersionId({ artifactId: "art_1", latest: true }, "input")).toThrow(
      /latest is not allowed/,
    );
    expect(requireArtifactVersionId({ artifactId: "art_1", latest: true }, "browse")).toEqual({
      artifactId: "art_1",
      latest: true,
    });
  });
});
