import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, session } from "electron";

import { IpcAccessDeniedError } from "../preload/contracts.js";
import { isAllowedRendererNavigationUrl, type RendererNavigationPolicy } from "./security.js";
import { resolveSmokeDirectoryOverride, shouldLaunchElectronHeadless } from "./smoke-env.js";
import { startDesktopApp } from "./start.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const rendererFileRoot = path.join(appRoot, "dist/renderer");
const allowedDevServerUrl = process.env.ELECTRON_RENDERER_URL ?? process.env.VITE_DEV_SERVER_URL;
const rendererNavigationPolicy: RendererNavigationPolicy =
  typeof allowedDevServerUrl === "string" && allowedDevServerUrl.length > 0
    ? { allowedDevServerUrl, rendererFileRoot }
    : { rendererFileRoot };

if (process.env.WORKFORCE_STATE_DIR) {
  app.setPath("userData", path.join(process.env.WORKFORCE_STATE_DIR, "electron-user-data"));
}

if (shouldLaunchElectronHeadless(process.env)) {
  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
}

app.on("web-contents-created", (_event, contents) => {
  applyRendererWebContentsGuards(contents, rendererNavigationPolicy);
});

void startDesktopApp({
  appRoot,
  env: process.env,
  ports: {
    requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    onSecondInstance: (listener) => {
      app.on("second-instance", listener);
    },
    onWindowAllClosed: (listener) => {
      app.on("window-all-closed", listener);
    },
    whenReady: () =>
      app.whenReady().then(() => {
        denyRendererPermissionRequests();
        return undefined;
      }),
    quit: () => {
      app.quit();
    },
    createWindow: (spec) => {
      const win = new BrowserWindow(spec);
      return {
        loadURL: (url) => win.loadURL(url),
        loadFile: (file) => win.loadFile(file),
        isDestroyed: () => win.isDestroyed(),
        isMinimized: () => win.isMinimized(),
        restore: () => {
          win.restore();
        },
        focus: () => {
          win.focus();
        },
        onClosed: (listener) => {
          win.on("closed", listener);
        },
        send: (channel, payload) => {
          if (!win.isDestroyed()) {
            win.webContents.send(channel, payload);
          }
        },
        openDevTools: () => {
          win.webContents.openDevTools({ mode: "detach" });
        },
        executeJavaScript: (code) => win.webContents.executeJavaScript(code),
      };
    },
    handleIpc: (channel, listener) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, payload: unknown) => {
        if (!isTrustedRendererIpcSender(event, rendererNavigationPolicy)) {
          throw new IpcAccessDeniedError(channel);
        }
        return listener(payload);
      });
    },
    pickDirectory: async () => {
      const smokeWorkspace = resolveSmokeDirectoryOverride(process.env);
      if (smokeWorkspace) {
        return smokeWorkspace;
      }
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
  },
});

function isDevToolsContents(contents: Electron.WebContents): boolean {
  const type = contents.getType() as string;
  const url = contents.getURL();
  return type === "devtools" || url.startsWith("devtools:") || url.startsWith("chrome-devtools:");
}

function denyRendererPermissionRequests(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function applyRendererWebContentsGuards(
  contents: Electron.WebContents,
  policy: RendererNavigationPolicy,
): void {
  if (isDevToolsContents(contents)) {
    return;
  }
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const denyIfUntrusted = (event: { preventDefault(): void }, url: string): void => {
    if (!isAllowedRendererNavigationUrl(url, policy)) {
      event.preventDefault();
    }
  };
  contents.on("will-navigate", (event, url) => {
    denyIfUntrusted(event, url);
  });
  contents.on("will-redirect", (event, url) => {
    denyIfUntrusted(event, url);
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

function isTrustedRendererIpcSender(
  event: {
    senderFrame?: { url: string } | null;
    sender?: { getURL?: () => string };
  },
  policy: RendererNavigationPolicy,
): boolean {
  const url = readIpcSenderUrl(event);
  return typeof url === "string" && isAllowedRendererNavigationUrl(url, policy);
}

function readIpcSenderUrl(event: {
  senderFrame?: { url: string } | null;
  sender?: { getURL?: () => string };
}): string | undefined {
  try {
    const frameUrl = event.senderFrame?.url;
    if (typeof frameUrl === "string" && frameUrl.length > 0) {
      return frameUrl;
    }
  } catch {
    // Frame may already be destroyed.
  }
  try {
    const contentsUrl = event.sender?.getURL?.();
    if (typeof contentsUrl === "string" && contentsUrl.length > 0) {
      return contentsUrl;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
