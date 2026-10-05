import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  Menu,
  protocol,
  session,
  safeStorage,
  nativeTheme,
} from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Permission, ConfirmRequest } from "@plums/core";
import { ConfirmPrompter } from "./confirm-window.js";
import { permissionCopy } from "./shared/permission-copy.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "plums-agent",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
if (process.env.PLUMS_DATA_DIR) {
  const profile = path.resolve(process.env.PLUMS_DATA_DIR);
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
if (!app.requestSingleInstanceLock()) app.exit(0);
let window: BrowserWindow;
let agentView: WebContentsView | undefined;
let active: { instanceId: string; ownerId: string; name: string } | undefined;
let agentVisible = false;
const RUNNING_BAR = 40;
const MANAGER_BUTTONS = { x: 20, y: 21 };
const RUNNING_BUTTONS = { x: 16, y: 13 };
let prompter: ConfirmPrompter;
const runtimeState = () =>
  active
    ? {
        instanceId: active.instanceId,
        name: active.name,
        visible: agentVisible,
      }
    : null;
function sendRuntime() {
  if (!window.isDestroyed())
    window.webContents.send("manager-agent-state", runtimeState());
}
function hideAgent() {
  if (agentView && agentVisible) window.contentView.removeChildView(agentView);
  agentVisible = false;
  window.setWindowButtonPosition(MANAGER_BUTTONS);
  sendRuntime();
}
function showAgent() {
  if (agentView && !agentVisible) window.contentView.addChildView(agentView);
  agentVisible = !!agentView;
  window.setWindowButtonPosition(
    agentVisible ? RUNNING_BUTTONS : MANAGER_BUTTONS,
  );
  resize();
  sendRuntime();
}
function consent(
  subject: string,
  action: string,
  entries: {
    name: string;
    permissions: Permission[];
    formatVersion?: string;
  }[],
) {
  return prompter.ask({
    kind: "consent",
    subject,
    action,
    permissions: entries.map((entry) => ({
      name: entry.name,
      descriptions: entry.permissions.length
        ? entry.permissions.map(
            (permission) =>
              `${permissionCopy(permission, entry.formatVersion)}。${permission.reason}`,
          )
        : ["不访问外部资源"],
    })),
  });
}
let viewEpoch = 0;
let broker: ChildProcess;
let next = 0;
const requests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (e: unknown) => void }
>();
const approvals = new Map<string, AbortController>();
function replyService(id: string, ok: boolean, value?: unknown) {
  if (broker.connected)
    broker.send({ type: "service-reply", id, ok, value }, () => {});
}
const rpc = (method: string, args: unknown = {}): Promise<unknown> =>
  new Promise((resolve, reject) => {
    if (!broker?.connected) {
      reject({
        code: "HOST_STOPPED",
        message: "运行底座已停止。请重新打开应用。",
      });
      return;
    }
    const id = String(++next);
    requests.set(id, { resolve, reject });
    broker.send({ type: "request", id, method, args }, (error) => {
      if (error) {
        requests.delete(id);
        reject({ code: "HOST_STOPPED", message: "运行底座已停止。" });
      }
    });
  });
const base = fileURLToPath(new URL("./", import.meta.url));
function managerSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw Error("Invalid sender");
}
function agentSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    !active ||
    !agentView ||
    event.sender !== agentView.webContents ||
    event.senderFrame !== agentView.webContents.mainFrame
  )
    throw Error("Invalid sender");
}
async function recover(cancelOpening = true): Promise<void> {
  if (cancelOpening) viewEpoch++;
  const previous = active;
  active = undefined;
  if (agentView) {
    const isolated = agentView.webContents.session;
    isolated.protocol.unhandle("plums-agent");
    isolated.webRequest.onBeforeRequest(null);
    if (agentVisible) window.contentView.removeChildView(agentView);
    agentView.webContents.close();
    agentView = undefined;
  }
  agentVisible = false;
  window.setWindowButtonPosition(MANAGER_BUTTONS);
  sendRuntime();
  if (previous) await rpc("stop", { instanceId: previous.instanceId });
  window.webContents.send("manager-refresh");
}
const resize = () => {
  const { width, height } = window.getContentBounds();
  agentView?.setBounds({
    x: 0,
    y: RUNNING_BAR,
    width,
    height: Math.max(0, height - RUNNING_BAR),
  });
};
async function openAgent(instanceId: string): Promise<boolean> {
  const epoch = ++viewEpoch;
  await recover(false);
  if (epoch !== viewEpoch) return false;
  const frontend = (await rpc("frontend", { instanceId })) as {
    packageId: string;
    entry: string;
    files: Record<string, number[]>;
  } | null;
  if (epoch !== viewEpoch) return false;
  if (!frontend) {
    window.webContents.send("manager-select", instanceId);
    return false;
  }
  const isolated = session.fromPartition(`agent-${instanceId}-${Date.now()}`);
  isolated.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) =>
      callback({
        cancel: !details.url.startsWith(`plums-agent://${instanceId}/`),
      }),
  );
  isolated.protocol.handle("plums-agent", (request) => {
    const url = new URL(request.url);
    let at: string;
    try {
      at = decodeURIComponent(url.pathname.slice(1));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (
      url.hostname !== instanceId ||
      !Object.hasOwn(frontend.files, at) ||
      at.split("/").some((p) => p === ".." || p === ".") ||
      at.includes("\\")
    )
      return new Response(null, { status: 404 });
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
    return new Response(new Uint8Array(frontend.files[at]!), {
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
  agentView = view;
  const records = (await rpc("list")) as { instanceId: string; name: string }[];
  if (epoch !== viewEpoch) {
    if (!view.webContents.isDestroyed()) view.webContents.close();
    return false;
  }
  active = {
    instanceId,
    ownerId: frontend.packageId,
    name:
      records.find((record) => record.instanceId === instanceId)?.name ??
      "Agent",
  };
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url),
        at = decodeURIComponent(target.pathname.slice(1));
      if (
        target.protocol === "plums-agent:" &&
        target.hostname === instanceId &&
        Object.hasOwn(frontend.files, at) &&
        /\.html?$/i.test(at)
      )
        return;
    } catch {}
    event.preventDefault();
  });
  view.webContents.on("will-redirect", (event) => event.preventDefault());
  view.webContents.on("render-process-gone", () => {
    if (agentView === view) void recover();
  });
  view.webContents.on("unresponsive", () => {
    if (agentView === view) void recover();
  });
  showAgent();
  try {
    await view.webContents.loadURL(
      `plums-agent://${instanceId}/${frontend.entry}`,
    );
    return epoch === viewEpoch;
  } catch {
    if (agentView === view) await recover();
    return false;
  }
}
app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 640,
    title: "Plums",
    titleBarStyle: "hidden",
    trafficLightPosition: MANAGER_BUTTONS,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141311" : "#f7f6f3",
    webPreferences: {
      preload: path.join(base, "manager-preload.cjs"),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  prompter = new ConfirmPrompter(window, base);
  const updateBackground = () =>
    window.setBackgroundColor(
      nativeTheme.shouldUseDarkColors ? "#141311" : "#f7f6f3",
    );
  nativeTheme.on("updated", updateBackground);
  window.once("closed", () =>
    nativeTheme.removeListener("updated", updateBackground),
  );
  const sendWindowState = () =>
    window.webContents.send("manager-window-state", {
      fullscreen: window.isFullScreen(),
    });
  window.on("enter-full-screen", sendWindowState);
  window.on("leave-full-screen", sendWindowState);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const nodePath = app.isPackaged
    ? path.join(process.resourcesPath, "node/bin/node")
    : process.env.PLUMS_NODE;
  if (!nodePath) throw Error("Start through pnpm desktop:dev");
  broker = fork(path.join(base, "broker.mjs"), [], {
    execPath: nodePath,
    execArgv: ["--no-node-snapshot"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      PLUMS_DATA_DIR:
        process.env.PLUMS_DATA_DIR ??
        path.join(app.getPath("userData"), "library"),
    },
  });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Host startup timed out")),
      20_000,
    );
    broker.on("message", (raw) => {
      if ((raw as { type: string }).type === "ready") {
        clearTimeout(timer);
        resolve();
      }
    });
    broker.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Host stopped during startup"));
    });
  });
  broker.on("message", async (raw: unknown) => {
    const m = raw as {
      type: string;
      id: string;
      ok: boolean;
      value: unknown;
      error: unknown;
      method: string;
      args: unknown;
      instanceId: string;
      packageId: string;
      topic: string;
      data: unknown;
    };
    if (m.type === "reply") {
      const pending = requests.get(m.id);
      requests.delete(m.id);
      if (pending) m.ok ? pending.resolve(m.value) : pending.reject(m.error);
    } else if (m.type === "event") {
      if (active?.instanceId === m.instanceId)
        agentView?.webContents.send("agent-event", {
          packageId: m.packageId,
          topic: m.topic,
          data: m.data,
        });
      if (m.topic === "mcp.updated") window.webContents.send("manager-refresh");
    } else if (m.type === "service-cancel") {
      approvals.get(m.id)?.abort();
    } else if (m.type === "service") {
      try {
        let value: unknown;
        if (m.method === "confirm") {
          const controller = new AbortController();
          approvals.set(m.id, controller);
          const args = m.args as ConfirmRequest;
          value = await prompter.ask(
            {
              kind: "capability",
              operation: args.host
                ? "egress"
                : args.action?.includes("运行程序")
                  ? "exec"
                  : "write",
              subject: args.subject ?? "组件操作",
              action: args.action ?? args.message,
              ...(args.host ? { host: args.host } : {}),
              ...(args.reason ? { reason: args.reason } : {}),
            },
            AbortSignal.any([AbortSignal.timeout(120_000), controller.signal]),
          );
        } else if (m.method === "encrypt") {
          if (!(await safeStorage.isAsyncEncryptionAvailable())) throw Error();
          value = (
            await safeStorage.encryptStringAsync(m.args as string)
          ).toString("base64");
        } else if (m.method === "decrypt") {
          value = (
            await safeStorage.decryptStringAsync(
              Buffer.from(m.args as string, "base64"),
            )
          ).result;
        } else throw Error();
        replyService(m.id, true, value);
      } catch {
        replyService(m.id, false);
      } finally {
        approvals.delete(m.id);
      }
    }
  });
  broker.on("exit", () => {
    prompter.dispose();
    for (const controller of approvals.values()) controller.abort();
    approvals.clear();
    for (const p of requests.values())
      p.reject({
        code: "HOST_STOPPED",
        message: "运行底座已停止。请重新打开应用。",
      });
    requests.clear();
    void recover().catch(() => {});
  });
  ipcMain.handle(
    "manager",
    async (event, method: string, args: Record<string, unknown> = {}) => {
      managerSender(event);
      try {
        let value: unknown;
        if (
          active?.instanceId === args.instanceId &&
          [
            "remove",
            "uninstall",
            "disable",
            "editAgent",
            "addLibraryComponent",
            "setStartup",
            "chooseRoot",
            "unbindRoot",
            "updateFromLibrary",
            "settings",
          ].includes(method)
        )
          await recover();
        if (method === "windowState")
          value = { fullscreen: window.isFullScreen() };
        else if (method === "agentState") value = runtimeState();
        else if (method === "hideAgent") {
          hideAgent();
          value = null;
        } else if (method === "showAgent") {
          showAgent();
          value = null;
        } else if (method === "stopAgent") {
          await recover();
          value = null;
        } else if (method === "agentStatus") {
          try {
            const plan = (await rpc("agentEnablePlan", args)) as {
              missing: unknown[];
              entries: { enabled: boolean }[];
            };
            value = plan.missing.length
              ? "needs-config"
              : plan.entries.some((entry) => !entry.enabled)
                ? "disabled"
                : "ready";
          } catch {
            value = "unavailable";
          }
        } else if (method === "openAgent")
          value = await openAgent(args.instanceId as string);
        else if (method === "startAgent") {
          const plan = (await rpc("agentEnablePlan", args)) as {
            fingerprint: string;
            entries: {
              packageId: string;
              name: string;
              enabled: boolean;
              permissions: {
                id: string;
                kind?: string;
                target: string;
                reason: string;
                operations?: string[];
              }[];
            }[];
            missing: unknown[];
          };
          if (plan.missing.length) {
            window.webContents.send("manager-select", args.instanceId);
            value = { needsSetup: true };
          } else {
            const disabled = plan.entries.filter((p) => !p.enabled);
            let approved = true;
            if (disabled.length) {
              const detail = (await rpc("resources", args)) as {
                packages: { id: string; manifest: { formatVersion: string } }[];
              };
              approved = await consent(
                "Agent 所需组件",
                "查看声明的权限，同意后启用组件。",
                disabled.map((entry) => ({
                  ...entry,
                  permissions: entry.permissions as Permission[],
                  formatVersion: detail.packages.find(
                    (p) => p.id === entry.packageId,
                  )?.manifest.formatVersion,
                })),
              );
            }
            if (approved) {
              await rpc("enableAgent", {
                ...args,
                fingerprint: plan.fingerprint,
              });
              value = { opened: await openAgent(args.instanceId as string) };
            } else value = { cancelled: true };
          }
        } else if (method === "chooseImport") {
          const selected = await dialog.showOpenDialog(window, {
            properties: ["openFile"],
            filters: [
              { name: "Plums 包与角色卡", extensions: ["zip", "json", "png"] },
            ],
          });
          value = selected.canceled
            ? null
            : await rpc("preview", { path: selected.filePaths[0] });
        } else if (method === "chooseRoot") {
          const selected = await dialog.showOpenDialog(window, {
            properties: ["openDirectory"],
          });
          if (!selected.canceled)
            await rpc("bindRoot", { ...args, path: selected.filePaths[0] });
          value = null;
        } else if (method === "updateFromLibrary") {
          const preview = (await rpc("previewLibraryUpdate", args)) as {
            token: string;
            manifest: {
              id: string;
              name: string;
              permissions: unknown[];
              formatVersion: string;
            };
          };
          if (preview.manifest.id !== args.packageId) throw Error();
          const approved = await consent(
            preview.manifest.name,
            "更新此组件，并同意当前声明的权限。",
            [
              {
                name: preview.manifest.name,
                permissions: preview.manifest.permissions as Permission[],
                formatVersion: preview.manifest.formatVersion,
              },
            ],
          );
          if (approved)
            await rpc("update", {
              ...args,
              token: preview.token,
              consent: true,
            });
          value = null;
        } else if (method === "invoke") {
          value = await rpc("invoke", {
            ...args,
            ownerId: args.packageId,
            targetId: args.packageId,
          });
        } else if (method === "enable") {
          const details = (await rpc("resources", {
            instanceId: args.instanceId,
          })) as {
            packages: {
              id: string;
              name: string;
              manifest: { permissions: unknown[]; formatVersion: string };
            }[];
          };
          const component = details.packages.find(
            (p) => p.id === args.packageId,
          );
          if (!component) throw Error();
          const approved = await consent(
            component.name,
            "启用此组件。请确认你信任组件来源。",
            [
              {
                name: component.name,
                permissions: component.manifest.permissions as Permission[],
                formatVersion: component.manifest.formatVersion,
              },
            ],
          );
          if (approved)
            await rpc("enable", {
              ...args,
              expected: JSON.stringify(component.manifest),
            });
          value = null;
        } else if (method === "export" || method === "exportLibrary") {
          const selected = await dialog.showSaveDialog(window, {
            defaultPath: method === "export" ? "agent.zip" : "component.zip",
            filters: [{ name: "Agent ZIP", extensions: ["zip"] }],
          });
          if (!selected.canceled && selected.filePath)
            await writeFile(
              selected.filePath,
              new Uint8Array((await rpc(method, args)) as number[]),
            );
          value = null;
        } else if (
          method === "remove" ||
          method === "uninstall" ||
          method === "removeLibrary"
        ) {
          await rpc(method, args);
          value = null;
        } else if (
          [
            "list",
            "library",
            "planAssembly",
            "importLibrary",
            "importBundleComponents",
            "createAgent",
            "editAgent",
            "addLibraryComponent",
            "preview",
            "install",
            "resources",
            "disable",
            "unbindRoot",
            "settings",
            "audit",
            "approveMcp",
            "setStartup",
            "desktopSettings",
            "setDesktopSettings",
          ].includes(method)
        )
          value = await rpc(method, args);
        else throw Error();
        return { ok: true, value: value ?? null };
      } catch (error) {
        return {
          ok: false,
          error:
            typeof error === "object" && error !== null && "code" in error
              ? error
              : { code: "DESKTOP_FAILED", message: "操作未完成。" },
        };
      }
    },
  );
  ipcMain.handle(
    "agent",
    async (event, method: string, args: Record<string, unknown> = {}) => {
      agentSender(event);
      const bound = { ...active! };
      try {
        if (JSON.stringify(args).length > 1024 * 1024)
          throw Error("Message exceeds limit");
        if (method === "manager") {
          hideAgent();
          return { ok: true, value: null };
        }
        if (method === "cancel") {
          await rpc("stop", { instanceId: bound.instanceId });
          return { ok: true, value: null };
        }
        if (method === "context")
          return { ok: true, value: { ...bound, sdkVersion: "1" } };
        if (method === "invoke") {
          const value = await rpc("invoke", {
            instanceId: bound.instanceId,
            ownerId: bound.ownerId,
            targetId: args.packageId ?? bound.ownerId,
            kind: args.kind,
            name: args.name,
            input: args.input,
          });
          return { ok: true, value };
        }
        throw Error();
      } catch (error) {
        return {
          ok: false,
          error:
            typeof error === "object" && error !== null && "code" in error
              ? error
              : { code: "EXTENSION_FAILED", message: "扩展调用未完成。" },
        };
      }
    },
  );
  ipcMain.handle("agent-drop", async (event, file: string) => {
    agentSender(event);
    try {
      if (
        typeof file !== "string" ||
        ![".zip", ".json", ".png"].includes(path.extname(file).toLowerCase())
      )
        throw Error();
      const preview = await rpc("preview", { path: file });
      await recover();
      window.webContents.send("manager-import", preview);
    } catch {
      await recover();
      await dialog.showMessageBox(window, {
        type: "error",
        message: "此文件无法导入。支持 Plums ZIP、角色 JSON 和 PNG。",
      });
    }
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Plums",
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "返回管理 / 切换 Agent",
            accelerator: "CmdOrCtrl+Shift+M",
            click: () => {
              hideAgent();
            },
          },
          {
            label: "停止当前 Agent",
            accelerator: "CmdOrCtrl+.",
            click: () => {
              void recover();
            },
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "窗口",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          {
            label: "恢复默认界面",
            click: () => {
              void recover();
            },
          },
        ],
      },
    ]),
  );
  window.on("resize", resize);
  window.on("closed", () => {
    broker?.kill();
    app.quit();
  });
  await ready;
  await window.loadFile(path.join(base, "renderer/index.html"));
});
app.on("before-quit", () => broker?.kill());
app.on("window-all-closed", () => app.quit());
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
