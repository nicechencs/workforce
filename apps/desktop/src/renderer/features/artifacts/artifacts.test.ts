import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArtifactsPage, ArtifactVersionView } from "./page.js";
import { isUnversionedArtifactPath } from "./model.js";

describe("artifact version view", () => {
  it("rejects unversioned or latest content routes", () => {
    expect(isUnversionedArtifactPath("latest")).toBe(true);
    expect(isUnversionedArtifactPath(undefined)).toBe(true);
    const html = renderToStaticMarkup(
      createElement(ArtifactsPage, {
        params: { artifactId: "art_1", versionId: "latest" },
        path: "/artifacts/art_1/versions/latest",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("必须指定 artifactId 与 versionId");
    expect(html).not.toContain("无版本内容已加载");
  });

  it("renders the pinned version id, hash and lineage", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactVersionView, {
        artifact: {
          id: "art_1",
          projectId: "prj_1",
          logicalName: "plan",
          kind: "plan",
          createdAt: "2026-09-10T00:00:00.000Z",
          versions: [],
        },
        version: {
          id: "av_2",
          artifactId: "art_1",
          version: 2,
          status: "available",
          hash: "sha256:fff",
          size: 12,
          mediaType: "text/markdown",
          createdAt: "2026-09-10T00:00:00.000Z",
        },
        content: "# Plan\n",
        lineage: { artifactVersionId: "av_2", parents: ["av_1"], children: [] },
      }),
    );
    expect(html).toContain("av_2");
    expect(html).toContain("sha256:fff");
    expect(html).toContain("av_1");
    expect(html).toContain("固定版本内容");
  });
});
