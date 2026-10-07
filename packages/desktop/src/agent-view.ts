import { WebContentsView, session } from "electron";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import type { PanelContext } from "@plums/sdk";

export interface AgentViewResource {
  context: PanelContext;
  entry: string;
  files: Record<string, number[]>;
  legacyAgentEvents?: boolean;
}
export interface AgentView {
  view: WebContentsView;
  context: PanelContext;
  url: string;
  snapshotFingerprint: string;
  legacyAgentEvents: boolean;
  dispose(): void;
}
export function agentViewFingerprint(resource: AgentViewResource) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        resource.entry,
        Object.entries(resource.files).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("hex");
}
/** Each component owns a separate session, origin snapshot and preload bridge. */
export function createAgentView(
  resource: AgentViewResource,
  base: string,
  gone: () => void,
): AgentView {
  const { context, entry, files } = resource;
  const isolated = session.fromPartition(
    `agent-${context.agentId}-${randomUUID()}`,
  );
  const localPath = (raw: string): string | undefined => {
    try {
      const url = new URL(raw),
        at = decodeURIComponent(url.pathname.slice(1));
      if (
        url.protocol === "plums-agent:" &&
        url.hostname === context.agentId &&
        !url.username &&
        !url.password &&
        !url.port &&
        Object.hasOwn(files, at) &&
        !at.split("/").some((p) => p === "." || p === "..") &&
        !at.includes("\\")
      )
        return at;
    } catch {}
    return undefined;
  };
  isolated.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) =>
      callback({ cancel: localPath(details.url) === undefined }),
  );
  isolated.protocol.handle("plums-agent", (request) => {
    const at = localPath(request.url);
    if (at === undefined) return new Response(null, { status: 404 });
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".woff2": "font/woff2",
    };
    return new Response(new Uint8Array(files[at]!), {
      headers: {
        "Content-Type": mime[path.extname(at)] ?? "application/octet-stream",
        "Content-Security-Policy":
          "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(base, "agent-preload.cjs"),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      session: isolated,
    },
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => {
    const at = localPath(url);
    if (at !== entry) event.preventDefault();
  });
  view.webContents.on("will-frame-navigate", (event) => {
    if (!event.isMainFrame) event.preventDefault();
  });
  view.webContents.on("will-redirect", (event) => event.preventDefault());
  view.webContents.on("will-attach-webview", (event) => event.preventDefault());
  view.webContents.on("render-process-gone", gone);
  view.webContents.on("unresponsive", gone);
  return {
    view,
    context: structuredClone(context),
    snapshotFingerprint: agentViewFingerprint(resource),
    legacyAgentEvents: resource.legacyAgentEvents === true,
    url: `plums-agent://${context.agentId}/${entry}`,
    dispose() {
      view.webContents.removeListener("render-process-gone", gone);
      view.webContents.removeListener("unresponsive", gone);
      isolated.protocol.unhandle("plums-agent");
      isolated.webRequest.onBeforeRequest(null);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
