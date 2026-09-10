import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApprovalDto } from "@workforce/desktop-client";

import { ApprovalCard } from "./page.js";
import { canApproveApproval, decisionPayload } from "./model.js";

function sampleApproval(overrides: Partial<ApprovalDto> = {}): ApprovalDto {
  return {
    id: "apr_1",
    projectId: "prj_1",
    gate: "artifact",
    status: "pending",
    stateRevision: 1,
    actionDigest: "sha256:abc",
    resource: "artifact-version:av_1",
    requestedAt: "2026-09-10T00:00:00.000Z",
    artifactVersionId: "av_1",
    ...overrides,
  };
}

describe("approval digest gate", () => {
  it("disables approve when digest is missing", () => {
    const approval = sampleApproval({ actionDigest: "" });
    expect(canApproveApproval(approval)).toBe(false);
    expect(decisionPayload(approval, "ok")).toBeNull();
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval,
        reason: "ok",
        onApprove: () => {
          throw new Error("must not approve without digest");
        },
        onReject: () => undefined,
        onRequestChanges: () => undefined,
      }),
    );
    expect(html).toContain("缺少动作摘要，无法批准");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="approval-approve"/);
  });

  it("sends the digest from the approval DTO rather than a stale copy", () => {
    const approval = sampleApproval({ actionDigest: "sha256:current", artifactVersionId: "av_9" });
    expect(decisionPayload(approval, "确认", undefined)).toEqual({
      decisionReason: "确认",
      digest: "sha256:current",
      artifactVersionId: "av_9",
    });
    const html = renderToStaticMarkup(
      createElement(ApprovalCard, {
        approval,
        reason: "确认",
        onApprove: () => undefined,
      }),
    );
    expect(html).toContain("sha256:current");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="approval-approve"/);
  });
});
