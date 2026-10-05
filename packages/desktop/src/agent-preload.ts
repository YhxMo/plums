import { contextBridge, ipcRenderer, webUtils } from "electron";
document.addEventListener(
  "dragover",
  (event) => {
    if (event.isTrusted) event.preventDefault();
  },
  true,
);
document.addEventListener(
  "drop",
  (event) => {
    const file = event.dataTransfer?.files[0];
    if (!event.isTrusted || !file || !/\.(zip|json|png)$/i.test(file.name))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void ipcRenderer.invoke("agent-drop", webUtils.getPathForFile(file));
  },
  true,
);
async function call(method: string, args: unknown = {}) {
  const result = await ipcRenderer.invoke("agent", method, args);
  if (!result.ok) throw result.error;
  return result.value;
}
contextBridge.exposeInMainWorld(
  "plums",
  Object.freeze({
    sdkVersion: "1",
    context: () => call("context"),
    invoke: (kind: string, name: string, input: unknown, packageId?: string) =>
      call("invoke", { kind, name, input, packageId }),
    openManager: () => call("manager"),
    cancel: () => call("cancel"),
    onEvent(callback: (event: unknown) => void) {
      const fn = (_event: unknown, value: unknown) => callback(value);
      ipcRenderer.on("agent-event", fn);
      return () => ipcRenderer.removeListener("agent-event", fn);
    },
  }),
);
