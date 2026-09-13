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
  navigateOnDragDrop: false;
  webPreferences: RendererWebPreferences;
}

export function createMainWindowSpec(
  preloadPath: string,
  options: { show?: boolean } = {},
): BrowserWindowSpec {
  const webPreferences = createRendererWebPreferences(preloadPath);
  assertSecureWebPreferences(webPreferences);
  return {
    width: 1280,
    height: 800,
    show: options.show ?? true,
    autoHideMenuBar: true,
    navigateOnDragDrop: false,
    webPreferences,
  };
}
