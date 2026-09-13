import { describe, expect, it } from "vitest";

import {
  createRendererWebPreferences,
  isAllowedRendererNavigationUrl,
} from "../src/main/security.js";
import { createMainWindowSpec } from "../src/main/windows/factory.js";

describe("renderer window security", () => {
  it("disables nodeIntegration and enables contextIsolation", () => {
    const prefs = createRendererWebPreferences("/tmp/preload.js");
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.webviewTag).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.allowRunningInsecureContent).toBe(false);
  });

  it("applies the same defaults to the main window spec", () => {
    const spec = createMainWindowSpec("preload.js");
    expect(spec.webPreferences.nodeIntegration).toBe(false);
    expect(spec.webPreferences.contextIsolation).toBe(true);
    expect(spec.webPreferences.preload).toBe("preload.js");
    expect(spec.navigateOnDragDrop).toBe(false);
  });

  it("only allows packaged renderer files or the Vite loopback origin", () => {
    const rendererFileRoot = "/app/dist/renderer";
    expect(
      isAllowedRendererNavigationUrl("file:///app/dist/renderer/index.html", { rendererFileRoot }),
    ).toBe(true);
    expect(isAllowedRendererNavigationUrl("file:///etc/passwd", { rendererFileRoot })).toBe(false);
    expect(
      isAllowedRendererNavigationUrl("https://example.com/", {
        allowedDevServerUrl: "http://127.0.0.1:5173/",
        rendererFileRoot,
      }),
    ).toBe(false);
    expect(
      isAllowedRendererNavigationUrl("http://127.0.0.1:5173/", {
        allowedDevServerUrl: "http://127.0.0.1:5173/",
        rendererFileRoot,
      }),
    ).toBe(true);
    expect(
      isAllowedRendererNavigationUrl("http://127.0.0.1:3456/api/v1/projects", {
        allowedDevServerUrl: "http://127.0.0.1:5173/",
        rendererFileRoot,
      }),
    ).toBe(false);
  });
});
