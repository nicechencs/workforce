import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RendererWebPreferences {
  preload: string;
  nodeIntegration: false;
  contextIsolation: true;
  sandbox: true;
  nodeIntegrationInWorker: false;
  webviewTag: false;
  webSecurity: true;
  allowRunningInsecureContent: false;
}

export interface RendererNavigationPolicy {
  allowedDevServerUrl?: string;
  rendererFileRoot?: string;
}

export function createRendererWebPreferences(preload: string): RendererWebPreferences {
  return {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
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
  if (prefs.webSecurity !== true) {
    throw new Error("Renderer webSecurity must be true");
  }
  if (prefs.allowRunningInsecureContent !== false) {
    throw new Error("Renderer allowRunningInsecureContent must be false");
  }
}

function isPathInsideRoot(filePath: string, rootDir: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Renderer may only stay on the packaged index.html tree or the Vite loopback
 * origin. Any other navigation would keep the privileged preload attached.
 */
export function isAllowedRendererNavigationUrl(
  url: string,
  policy: RendererNavigationPolicy = {},
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "file:") {
    const root = policy.rendererFileRoot;
    if (!root) {
      return false;
    }
    try {
      return isPathInsideRoot(fileURLToPath(parsed), root);
    } catch {
      return false;
    }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (
    parsed.hostname !== "127.0.0.1" &&
    parsed.hostname !== "localhost" &&
    parsed.hostname !== "::1"
  ) {
    return false;
  }
  const allowedDevServerUrl = policy.allowedDevServerUrl;
  if (typeof allowedDevServerUrl !== "string" || allowedDevServerUrl.length === 0) {
    return false;
  }
  try {
    return parsed.origin === new URL(allowedDevServerUrl).origin;
  } catch {
    return false;
  }
}
