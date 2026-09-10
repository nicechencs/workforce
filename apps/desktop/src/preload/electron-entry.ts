import { contextBridge, ipcRenderer } from "electron";

import { installPreloadBridge, type IpcRendererPort } from "./bridge.js";

const ipc: IpcRendererPort = {
  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel, listener) {
    const wrapped = (_event: unknown, next: unknown): void => {
      listener(next);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

installPreloadBridge(
  {
    exposeInMainWorld(key, api) {
      contextBridge.exposeInMainWorld(key, api);
    },
  },
  ipc,
);
