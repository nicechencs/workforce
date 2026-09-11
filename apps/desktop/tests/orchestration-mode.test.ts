import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OrchestrationModeControl } from "../src/renderer/features/orchestration/control.js";
import {
  DIRECT_UNSUPPORTED,
  buildStartProjectInput,
  emptyOrchestrationProbe,
  probeOrchestrationSupport,
  type OrchestrationProbe,
} from "../src/renderer/features/orchestration/model.js";
import { installHappyDom, uninstallHappyDom } from "./install-happy-dom.js";

const roots: Root[] = [];

beforeEach(() => {
  installHappyDom();
});

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount();
    });
  }
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  uninstallHappyDom();
});

function supportedProbe(): OrchestrationProbe {
  return probeOrchestrationSupport({
    capabilities: {
      protocolVersion: "0.1",
      apiVersion: "v1",
      run: { pause: false, resume: false, input: true, takeOver: false },
      project: { pause: false, resume: false, archive: false },
      orchestration: { workflowBound: true, direct: true },
    },
  });
}

async function renderControl(
  probe: OrchestrationProbe,
  onChange: (mode: "workflow_bound" | "direct") => void,
  selected: "workflow_bound" | "direct" = "workflow_bound",
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(OrchestrationModeControl, {
        selected,
        probe,
        onChange,
      }),
    );
  });
  return host;
}

describe("orchestration mode happy-dom", () => {
  it("keeps direct disabled and refuses a fake start when probe is missing", async () => {
    const selected: Array<"workflow_bound" | "direct"> = [];
    await renderControl(emptyOrchestrationProbe(), (mode) => {
      selected.push(mode);
    });
    const direct = document.querySelector(
      '[data-testid="orchestration-mode-direct"]',
    ) as HTMLButtonElement;
    const bound = document.querySelector(
      '[data-testid="orchestration-mode-workflow_bound"]',
    ) as HTMLButtonElement;
    expect(direct.disabled).toBe(true);
    expect(bound.disabled).toBe(false);
    expect(bound.getAttribute("aria-checked")).toBe("true");
    await act(async () => {
      direct.click();
    });
    expect(selected).toEqual([]);
    expect(document.body.innerText).toContain(DIRECT_UNSUPPORTED);
    expect(buildStartProjectInput("direct", emptyOrchestrationProbe()).ok).toBe(false);
  });

  it("selects direct and builds the frozen start field when probe allows it", async () => {
    const selected: Array<"workflow_bound" | "direct"> = [];
    const probe = supportedProbe();
    await renderControl(probe, (mode) => {
      selected.push(mode);
    });
    const direct = document.querySelector(
      '[data-testid="orchestration-mode-direct"]',
    ) as HTMLButtonElement;
    expect(direct.disabled).toBe(false);
    await act(async () => {
      direct.click();
    });
    expect(selected).toEqual(["direct"]);
    const payload = buildStartProjectInput("direct", probe);
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.input.orchestrationMode).toBe("direct");
    }
  });
});
