import { describe, expect, it } from "vitest";

import { ArtifactError } from "../errors.js";
import { detectLineageCycle } from "./graph.js";

describe("detectLineageCycle", () => {
  it("allows a new version derived from an existing one", () => {
    expect(() =>
      detectLineageCycle({
        outputArtifactVersionId: "arv_2",
        sources: [{ artifactVersionId: "arv_1", relation: "derived_from" }],
        edges: new Map([["arv_1", []]]),
      }),
    ).not.toThrow();
  });

  it("rejects a cycle through existing edges", () => {
    expect(() =>
      detectLineageCycle({
        outputArtifactVersionId: "arv_1",
        sources: [{ artifactVersionId: "arv_2", relation: "derived_from" }],
        edges: new Map([["arv_2", [{ artifactVersionId: "arv_1", relation: "derived_from" }]]]),
      }),
    ).toThrow(ArtifactError);
  });
});
