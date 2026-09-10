import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain } from "electron";

import { startDesktopApp } from "./start.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
      };
    },
    handleIpc: (channel, listener) => {
      ipcMain.handle(channel, (_event, payload: unknown) => listener(payload));
    },
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
  },
});
