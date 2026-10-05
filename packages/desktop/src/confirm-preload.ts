import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("confirmation", {
  load: () => ipcRenderer.invoke("confirm:load"),
  answer: (token: string, allow: boolean) =>
    ipcRenderer.invoke("confirm:answer", { token, allow }),
});
