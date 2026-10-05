import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("confirmation", {
  load: () => ipcRenderer.invoke("confirm:load"),
  answer: (token: string, allow: boolean, choice?: unknown) =>
    ipcRenderer.invoke("confirm:answer", { token, allow, choice }),
});
