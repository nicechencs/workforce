import { describe, expect, it } from "vitest";

import { createRendererWebPreferences } from "../src/main/security.js";
import { createMainWindowSpec } from "../src/main/windows/factory.js";

describe("renderer window security", () => {
  it("disables nodeIntegration and enables contextIsolation", () => {
    const prefs = createRendererWebPreferences("/tmp/preload.js");
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.webviewTag).toBe(false);
  });

  it("applies the same defaults to the main window spec", () => {
    const spec = createMainWindowSpec("preload.js");
    expect(spec.webPreferences.nodeIntegration).toBe(false);
    expect(spec.webPreferences.contextIsolation).toBe(true);
    expect(spec.webPreferences.preload).toBe("preload.js");
  });
});
