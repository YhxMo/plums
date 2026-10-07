import { createCommonPlatformSdk } from "@plums/sdk/common-client";
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
const resources = Object.freeze({
  list: () => call("resource", { operation: "list", request: {} }),
  read: (binding: string, key: string) =>
    call("resource", { operation: "read", request: { binding, key } }),
  write: (
    binding: string,
    key: string,
    expectedRevision: string,
    value: import("@plums/sdk").CommonJson,
  ) =>
    call("resource", {
      operation: "write",
      request: { binding, key, expectedRevision, value },
    }),
  delete: (binding: string, key: string, expectedRevision: string) =>
    call("resource", {
      operation: "delete",
      request: { binding, key, expectedRevision },
    }),
});
contextBridge.exposeInMainWorld(
  "__plumsFrontendBridge",
  Object.freeze({
    sdkVersion: "2",
    resources,
    common: createCommonPlatformSdk(
      (method, request) => call("common", { method, request }),
      resources,
    ),
    engine: Object.freeze({
      start: (engineId: string) =>
        call("engine", { operation: "start", engineId }),
      request: (
        engineId: string,
        method: string,
        input: unknown,
        requestId?: string,
      ) =>
        call("engine", {
          operation: "request",
          engineId,
          method,
          input,
          requestId,
        }),
      cancel: (engineId: string, requestId: string) =>
        call("engine", { operation: "cancel", engineId, requestId }),
      stop: (engineId: string) =>
        call("engine", { operation: "stop", engineId }),
      status: (engineId: string) =>
        call("engine", { operation: "status", engineId }),
    }),
    context: () => call("context"),
    protocols: Object.freeze({
      status: (requirementId: string) =>
        call("protocolStatus", { requirementId }),
      invoke: (requirementId: string, input: unknown) =>
        call("invokeProtocol", { requirementId, input }),
    }),
    panels: Object.freeze({
      open: (requirementId: string, panelId: string) =>
        call("openPanel", { requirementId, panelId }),
      close: (handle: string) => call("closePanel", { handle }),
      layout: (layout: import("@plums/sdk").PanelLayout) =>
        call("panelLayout", { layout }),
      post: (message: import("@plums/sdk").PanelPost) =>
        call("postPanel", { message }),
      respond: (
        messageId: string,
        kind: string,
        name: string,
        input: unknown,
      ) => call("panelRespond", { messageId, kind, name, input }),
      onMessage(
        callback: (message: import("@plums/sdk").PanelMessage) => void,
      ) {
        let subscribed = true;
        const fn = async (
          _event: unknown,
          value: import("@plums/sdk").PanelMessage,
        ) => {
          try {
            const context = await call("context");
            if (
              subscribed &&
              context.sessionId === value.sessionId &&
              context.handle === value.to
            )
              callback(value);
          } catch {}
        };
        ipcRenderer.on("panel-message", fn);
        return () => {
          subscribed = false;
          ipcRenderer.removeListener("panel-message", fn);
        };
      },
    }),
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

// Electron copies string keys across contextBridge. Construct the iterator's
// symbol in the consumer world while retaining all RPC/identity checks in preload.
contextBridge.executeInMainWorld({
  func: () => {
    const bridge = (window as any).__plumsFrontendBridge;
    const wrap = (call: any) => ({
      ...call,
      events: {
        [Symbol.asyncIterator]: () => ({
          next: () => call.events.next(),
          return: () => call.events.return(),
        }),
      },
    });
    const common = Object.freeze({
      ...bridge.common,
      invoke: async (...args: any[]) =>
        wrap(await bridge.common.invoke(...args)),
      attach: async (...args: any[]) =>
        wrap(await bridge.common.attach(...args)),
    });
    Object.defineProperty(window, "plums", {
      value: Object.freeze({ ...bridge, common }),
      writable: false,
      configurable: false,
    });
  },
});
