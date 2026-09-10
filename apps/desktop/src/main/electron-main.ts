import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain } from "electron";

import { resolveSmokeDirectoryOverride, shouldLaunchElectronHeadless } from "./smoke-env.js";
import { startDesktopApp } from "./start.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

if (process.env.WORKFORCE_STATE_DIR) {
  app.setPath("userData", path.join(process.env.WORKFORCE_STATE_DIR, "electron-user-data"));
}

if (shouldLaunchElectronHeadless(process.env)) {
  app.commandLine.appendSwitch("headless");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("no-sandbox");
}

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
    whenReady: () => app.whenReady().then(() => undefined),
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
      ipcMain.handle(channel, (_event, payload: unknown) => listener(payload));
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
