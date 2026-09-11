import { describe, expect, it } from "vitest";

import {
  ACCENT_IDS,
  ACCENT_STATES,
  AGENT_COLOR_IDS,
  CANVAS_IDS,
  CANVAS_PALETTES,
  DEFAULT_ACCENT_ID,
  DEFAULT_CANVAS_ID,
  RADIUS,
  SPACE,
  THEME,
  TYPE_SCALE,
  contrastRatio,
  isAccentId,
  isAgentColorId,
  isCanvasId,
  tokensAsCssVariables,
  type ThemeScheme,
} from "./tokens.js";

describe("design tokens", () => {
  it("defaults to the AgentHub-aligned accent and canvas", () => {
    expect(DEFAULT_ACCENT_ID).toBe("blue");
    expect(DEFAULT_CANVAS_ID).toBe("gray");
  });

  it("keeps the four-step type scale and 8/12/16 radius ladder", () => {
    expect(Object.keys(TYPE_SCALE)).toEqual(["display", "title", "body", "meta"]);
    expect(TYPE_SCALE.body.size).toBe("14px");
    expect(TYPE_SCALE.title.size).toBe("18px");
    expect(TYPE_SCALE.meta.size).toBe("12px");
    expect(TYPE_SCALE.display.size).toBe("22px");
    expect(RADIUS).toMatchObject({ btn: "8px", card: "12px", lg: "16px", mark: "22%" });
  });

  it("uses the 4/8/12/16/24/32 spacing ladder", () => {
    expect(Object.values(SPACE)).toEqual(["4px", "8px", "12px", "16px", "24px", "32px"]);
  });

  it("guards palette ids", () => {
    expect(isAccentId("teal")).toBe(true);
    expect(isAccentId("cyan")).toBe(false);
    expect(isCanvasId("mist")).toBe(true);
    expect(isCanvasId("neon")).toBe(false);
    expect(isAgentColorId("claude")).toBe(true);
    expect(isAgentColorId("unknown-agent")).toBe(false);
    expect(ACCENT_IDS).toHaveLength(5);
    expect(CANVAS_IDS).toHaveLength(8);
    expect(AGENT_COLOR_IDS).toContain("mock");
  });

  it("emits light, dark, accent and canvas variable blocks", () => {
    const css = tokensAsCssVariables();
    expect(css).toContain(":root {");
    expect(css).toContain("html.dark {");
    expect(css).toContain("--wf-bg-canvas: #f3f3f5;");
    expect(css).toContain("--wf-bg-canvas: #111113;");
    expect(css).toContain("--wf-radius-btn: 8px;");
    expect(css).toContain("--wf-font-body: 14px;");
    expect(css).toContain("--wf-space-12: 12px;");
    expect(css).toContain("--wf-shadow-md:");
    expect(css).toContain("--wf-agent-mock:");
    for (const accent of ACCENT_IDS) {
      expect(css).toContain(`html[data-accent="${accent}"]:not(.dark)`);
      expect(css).toContain(`html.dark[data-accent="${accent}"]`);
    }
    for (const canvas of CANVAS_IDS) {
      expect(css).toContain(`html[data-canvas="${canvas}"]:not(.dark)`);
    }
    expect(css).toContain(`--wf-bg-canvas: ${CANVAS_PALETTES.mist.canvas};`);
  });

  it("keeps text and accent pairs readable in both schemes", () => {
    const schemes: ThemeScheme[] = ["light", "dark"];
    for (const scheme of schemes) {
      const theme = THEME[scheme];
      expect(contrastRatio(theme["text-primary"], theme["bg-canvas"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme["text-secondary"], theme["bg-panel"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme["text-muted"], theme["bg-panel"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme["text-muted"], theme["bg-canvas"])).toBeGreaterThanOrEqual(4.5);
    }
    for (const accent of ACCENT_IDS) {
      for (const scheme of schemes) {
        const tone = ACCENT_STATES[accent][scheme];
        expect(contrastRatio(tone.foreground, tone.fill)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
