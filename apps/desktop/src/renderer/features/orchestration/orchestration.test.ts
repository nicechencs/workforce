import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CapabilitiesDto, RuntimeCapabilitiesDto } from "@workforce/desktop-client";

import { loadFeatureModules } from "../../app/feature-modules.js";
import { OrchestrationModeControl } from "./control.js";
import * as orchestrationModule from "./index.js";
import {
  DEFAULT_MODE,
  DIRECT_UNSUPPORTED,
  SLICE_NOTE,
  buildStartProjectInput,
  emptyOrchestrationProbe,
  probeOrchestrationSupport,
  resolveSelectedMode,
} from "./model.js";

function capabilities(direct?: boolean): CapabilitiesDto {
  return {
    protocolVersion: "0.1",
    apiVersion: "v1",
    run: { pause: false, resume: false, input: true, takeOver: false },
    project: { pause: false, resume: false, archive: false },
    ...(direct === undefined ? {} : { orchestration: { workflowBound: true, direct } }),
  };
}

function runtimeCapabilities(available: boolean): RuntimeCapabilitiesDto {
  return {
    runtimeId: "mock",
    input: true,
    pause: false,
    resume: false,
    takeOver: false,
    capabilities: [{ name: "orchestration.direct", version: "0.1", available }],
  };
}

describe("orchestration feature honesty", () => {
  it("does not register a feature slot that would overwrite catalog pages", () => {
    expect("feature" in orchestrationModule).toBe(false);
    expect(
      loadFeatureModules({
        "../features/orchestration/index.tsx": orchestrationModule,
      }),
    ).toEqual([]);
  });

  it("defaults to workflow_bound and treats a missing probe as unsupported direct", () => {
    expect(DEFAULT_MODE).toBe("workflow_bound");
    const probe = probeOrchestrationSupport({});
    expect(probe).toEqual(emptyOrchestrationProbe());
    expect(probe.direct).toBe(false);
    expect(probe.reason).toBe(DIRECT_UNSUPPORTED);
  });

  it("enables direct only when GET /capabilities or runtime probe declares it", () => {
    expect(probeOrchestrationSupport({ capabilities: capabilities() }).direct).toBe(false);
    expect(probeOrchestrationSupport({ capabilities: capabilities(false) }).direct).toBe(false);
    expect(probeOrchestrationSupport({ capabilities: capabilities(true) }).direct).toBe(true);
    expect(
      probeOrchestrationSupport({ runtimeCapabilities: runtimeCapabilities(false) }).direct,
    ).toBe(false);
    expect(
      probeOrchestrationSupport({ runtimeCapabilities: runtimeCapabilities(true) }).source,
    ).toBe("runtime");
  });
});

describe("start payload", () => {
  it("includes orchestrationMode when the user selects workflow_bound", () => {
    const result = buildStartProjectInput("workflow_bound", emptyOrchestrationProbe());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.input.orchestrationMode).toBe("workflow_bound");
  });

  it("refuses direct with unsupported_capability when the probe is missing", () => {
    const result = buildStartProjectInput("direct", emptyOrchestrationProbe());
    expect(result).toEqual({
      ok: false,
      code: "unsupported_capability",
      error: DIRECT_UNSUPPORTED,
    });
  });

  it("includes direct only when the probe allows it", () => {
    const probe = probeOrchestrationSupport({ capabilities: capabilities(true) });
    const result = buildStartProjectInput("direct", probe);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.input.orchestrationMode).toBe("direct");
  });

  it("snaps an unsupported direct selection back to workflow_bound", () => {
    expect(resolveSelectedMode("direct", emptyOrchestrationProbe())).toBe("workflow_bound");
    expect(
      resolveSelectedMode(
        "direct",
        probeOrchestrationSupport({ capabilities: capabilities(true) }),
      ),
    ).toBe("direct");
  });
});

describe("orchestration mode control", () => {
  it("renders workflow_bound selected and direct disabled without a probe", () => {
    const html = renderToStaticMarkup(
      createElement(OrchestrationModeControl, {
        selected: "workflow_bound",
        probe: emptyOrchestrationProbe(),
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("orchestration-mode-control");
    expect(html).toContain(SLICE_NOTE);
    expect(html).toContain('data-testid="orchestration-mode-workflow_bound"');
    expect(html).toContain('data-testid="orchestration-mode-direct"');
    expect(html).toContain("disabled");
    expect(html).toContain(DIRECT_UNSUPPORTED);
    expect(html).not.toContain("executionMode");
    expect(html).not.toContain("/runs/");
  });

  it("enables the direct button only when the probe says so", () => {
    const enabled = renderToStaticMarkup(
      createElement(OrchestrationModeControl, {
        selected: "direct",
        probe: probeOrchestrationSupport({ capabilities: capabilities(true) }),
        onChange: () => undefined,
      }),
    );
    expect(enabled).toContain('data-enabled="true"');
    expect(enabled).toContain('aria-checked="true"');
    const disabled = renderToStaticMarkup(
      createElement(OrchestrationModeControl, {
        selected: "workflow_bound",
        probe: emptyOrchestrationProbe(),
        onChange: () => undefined,
      }),
    );
    expect(disabled).toContain('data-enabled="false"');
  });
});
