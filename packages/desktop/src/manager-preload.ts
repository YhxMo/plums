import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld(
  "manager",
  Object.freeze({
    async call(method: string, args: unknown = {}) {
      const result = await ipcRenderer.invoke("manager", method, args);
      if (!result.ok) throw result.error;
      return result.value;
    },
    filePath(file: File) {
      return webUtils.getPathForFile(file);
    },
    onAgentState(callback: (value: unknown) => void) {
      const fn = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("manager-agent-state", fn);
      return () => ipcRenderer.removeListener("manager-agent-state", fn);
    },
    onWindowState(callback: (value: { fullscreen: boolean }) => void) {
      const fn = (_event: unknown, value: { fullscreen: boolean }) =>
        callback(value);
      ipcRenderer.on("manager-window-state", fn);
      return () => ipcRenderer.removeListener("manager-window-state", fn);
    },
    onRefresh(callback: () => void) {
      const fn = () => callback();
      ipcRenderer.on("manager-refresh", fn);
      return () => ipcRenderer.removeListener("manager-refresh", fn);
    },
    onSelect(callback: (instanceId: string) => void) {
      const fn = (_event: unknown, id: string) => callback(id);
      ipcRenderer.on("manager-select", fn);
      return () => ipcRenderer.removeListener("manager-select", fn);
    },
    onImport(callback: (preview: unknown) => void) {
      const fn = (_event: unknown, preview: unknown) => callback(preview);
      ipcRenderer.on("manager-import", fn);
      return () => ipcRenderer.removeListener("manager-import", fn);
    },
  }),
);
