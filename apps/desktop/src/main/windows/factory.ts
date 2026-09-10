import {
  assertSecureWebPreferences,
  createRendererWebPreferences,
  type RendererWebPreferences,
} from "../security.js";

export interface BrowserWindowSpec {
  width: number;
  height: number;
  show: boolean;
  autoHideMenuBar: boolean;
  webPreferences: RendererWebPreferences;
}

export function createMainWindowSpec(preloadPath: string): BrowserWindowSpec {
  const webPreferences = createRendererWebPreferences(preloadPath);
  assertSecureWebPreferences(webPreferences);
  return {
    width: 1280,
    height: 800,
    show: true,
    autoHideMenuBar: true,
    webPreferences,
  };
}
