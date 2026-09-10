export interface RendererWebPreferences {
  preload: string;
  nodeIntegration: false;
  contextIsolation: true;
  sandbox: true;
  nodeIntegrationInWorker: false;
  webviewTag: false;
}

export function createRendererWebPreferences(preload: string): RendererWebPreferences {
  return {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    nodeIntegrationInWorker: false,
    webviewTag: false,
  };
}

export function assertSecureWebPreferences(prefs: RendererWebPreferences): void {
  if (prefs.nodeIntegration !== false) {
    throw new Error("Renderer nodeIntegration must be false");
  }
  if (prefs.contextIsolation !== true) {
    throw new Error("Renderer contextIsolation must be true");
  }
  if (prefs.sandbox !== true) {
    throw new Error("Renderer sandbox must be true");
  }
}
