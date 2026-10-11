import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  Menu,
  protocol,
  nativeTheme,
  shell,
} from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Permission, ConfirmRequest } from "@plumsjs/core";
import { ConfirmPrompter } from "./confirm-window.js";
import { permissionCopy } from "./shared/permission-copy.js";
import {
  createAgentView,
  agentViewFingerprint,
  type AgentView,
  type AgentViewResource,
} from "./agent-view.js";
import type { PanelLayout } from "@plumsjs/sdk";

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
let active:
  | {
      instanceId: string;
      ownerId: string;
      name: string;
      sessionId: string;
      handle: string;
      diagnostics?: { viewId: string; reason: string }[];
    }
  | undefined;
const agentViews = new Map<number, AgentView>();
const attached = new Set<AgentView>();
let panelLayout: PanelLayout = {
  root: { x: 0, y: 0, width: 1, height: 1 },
  panels: [],
};
let renewingSession: string | undefined;
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
        diagnostics: active.diagnostics,
      }
    : null;
function sendRuntime() {
  if (!window.isDestroyed())
    window.webContents.send("manager-agent-state", runtimeState());
}
function hideAgent() {
  for (const record of attached)
    window.contentView.removeChildView(record.view);
  attached.clear();
  agentVisible = false;
  if (process.platform === "darwin")
    window.setWindowButtonPosition(MANAGER_BUTTONS);
  sendRuntime();
}
function showAgent() {
  agentVisible = !!agentView;
  if (process.platform === "darwin")
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
    serviceTargets?: Record<string, string[]>;
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
              `${permissionCopy(permission, entry.formatVersion, entry.serviceTargets?.[permission.id])}。${permission.reason}`,
          )
        : ["不访问外部资源"],
    })),
  });
}
let viewEpoch = 0;
let broker: ChildProcess;
let shutdownStarted = false;
let shutdownComplete = false;
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
function agentSender(event: Electron.IpcMainInvokeEvent): AgentView {
  const record = agentViews.get(event.sender.id);
  if (
    !active ||
    !agentView ||
    !record ||
    record.context.sessionId !== active.sessionId ||
    event.senderFrame !== record.view.webContents.mainFrame
  )
    throw Error("Invalid sender");
  return record;
}
function disposeView(record: AgentView): void {
  agentViews.delete(record.view.webContents.id);
  if (attached.delete(record)) window.contentView.removeChildView(record.view);
  record.dispose();
}
async function recover(
  cancelOpening = true,
  stopExecution = false,
): Promise<void> {
  if (cancelOpening) viewEpoch++;
  const previous = active;
  active = undefined;
  for (const record of [...agentViews.values()]) disposeView(record);
  agentView = undefined;
  panelLayout = { root: { x: 0, y: 0, width: 1, height: 1 }, panels: [] };
  agentVisible = false;
  if (process.platform === "darwin")
    window.setWindowButtonPosition(MANAGER_BUTTONS);
  sendRuntime();
  if (previous) {
    await rpc("closeFrontend", { sessionId: previous.sessionId }).catch(
      () => {},
    );
    if (stopExecution) await rpc("stop", { instanceId: previous.instanceId });
  }
  window.webContents.send("manager-refresh");
}
const resize = () => {
  const { width, height } = window.getContentBounds();
  const workingHeight = Math.max(0, height - RUNNING_BAR);
  for (const record of agentViews.values()) {
    const rect =
      record.context.handle === active?.handle
        ? panelLayout.root
        : panelLayout.panels.find((p) => p.handle === record.context.handle);
    if (rect) {
      const x = Math.round(rect.x * width),
        y = Math.round(rect.y * workingHeight);
      record.view.setBounds({
        x,
        y: RUNNING_BAR + y,
        width: Math.max(0, Math.round((rect.x + rect.width) * width) - x),
        height: Math.max(
          0,
          Math.round((rect.y + rect.height) * workingHeight) - y,
        ),
      });
    }
    if (agentVisible && rect && !attached.has(record)) {
      window.contentView.addChildView(record.view);
      attached.add(record);
    } else if ((!agentVisible || !rect) && attached.delete(record))
      window.contentView.removeChildView(record.view);
  }
};
async function openAgent(
  instanceId: string,
  componentId?: string,
): Promise<boolean | null> {
  const epoch = ++viewEpoch;
  await recover(false);
  if (epoch !== viewEpoch) return false;
  const task = (await rpc("taskScopePlan", {
    instanceId,
  })) as import("@plumsjs/core").TaskScopePlan & {
    name: string;
    active?: import("@plumsjs/core").TaskScopeState;
  };
  if (epoch !== viewEpoch) return false;
  if (!task.active && task.entries.length) {
    const selections = task.entries.flatMap((entry) =>
      entry.permissions.flatMap((p) =>
        (p.kind === "fs" ? p.operations : ["send" as const]).map(
          (operation) => ({
            packageId: entry.packageId,
            permissionId: p.id,
            operation,
          }),
        ),
      ),
    );
    const choice = await prompter.askTask({
      scopeOptions: selections.map((selection, index) => {
        const entry = task.entries.find(
          (e) => e.packageId === selection.packageId,
        )!;
        const permission = entry.permissions.find(
          (p) => p.id === selection.permissionId,
        )!;
        return {
          key: String(index),
          label: `${entry.name} · ${entry.serviceTargets?.[permission.id]?.join("、") || permission.target} · ${{ read: "读取", list: "列出", write: "写入", send: "联网" }[selection.operation]}`,
        };
      }),
      kind: "task",
      subject: task.name,
      action: "选择本次工作范围和有效期。范围内连续执行，停止即撤权。",
      permissions: [
        ...task.entries.map((entry) => ({
          name: entry.name,
          descriptions: entry.permissions.map(
            (p) =>
              `${permissionCopy(p, "2.0", entry.serviceTargets?.[p.id])}。${p.reason}`,
          ),
        })),
        ...Object.entries(task.roots).map(([name, directory]) => ({
          name: `目录 · ${name}`,
          descriptions: [directory],
        })),
      ],
    });
    if (!choice) return null;
    if (epoch !== viewEpoch) return false;
    await rpc("grantTaskScope", {
      instanceId,
      fingerprint: task.fingerprint,
      durationMs: choice.durationMs,
      selection: choice.selected.map((key) => selections[Number(key)]!),
    });
    if (epoch !== viewEpoch) {
      await rpc("revokeTaskScope", { instanceId });
      return false;
    }
  }
  const frontend = (await rpc("openFrontend", {
    instanceId,
    componentId,
  })) as AgentViewResource | null;
  if (epoch !== viewEpoch) {
    if (frontend)
      await rpc("closeFrontend", { sessionId: frontend.context.sessionId });
    return false;
  }
  if (!frontend) {
    window.webContents.send("manager-select", instanceId);
    return false;
  }
  const records = (await rpc("list")) as { instanceId: string; name: string }[];
  if (epoch !== viewEpoch) {
    await rpc("closeFrontend", { sessionId: frontend.context.sessionId });
    return false;
  }
  active = {
    instanceId,
    ownerId: frontend.context.componentId,
    name: records.find((r) => r.instanceId === instanceId)?.name ?? "Agent",
    sessionId: frontend.context.sessionId,
    handle: frontend.context.handle,
  };
  const record = createAgentView(frontend, base, () => {
    if (agentView === record.view) void recover();
  });
  agentView = record.view;
  agentViews.set(record.view.webContents.id, record);
  showAgent();
  try {
    await record.view.webContents.loadURL(record.url);
    const restored = (await rpc("restoreWorkspace", {
      sessionId: record.context.sessionId,
      source: record.context.handle,
    })) as {
      resources: AgentViewResource[];
      layout: PanelLayout;
      diagnostics: { viewId: string; reason: string }[];
    };
    if (epoch !== viewEpoch) return false;
    for (const resource of restored.resources)
      await mountPanelView(record, resource);
    if (epoch !== viewEpoch) return false;
    panelLayout = restored.layout;
    active.diagnostics = restored.diagnostics;
    resize();
    sendRuntime();
    return true;
  } catch {
    if (agentView === record.view) await recover();
    return false;
  }
}
async function openPanelView(
  source: AgentView,
  requirementId: string,
  panelId: string,
) {
  const context = { ...source.context };
  const resource = (await rpc("openPanel", {
    sessionId: context.sessionId,
    source: context.handle,
    requirementId,
    panelId,
  })) as AgentViewResource;
  if (
    active?.sessionId !== context.sessionId ||
    agentViews.get(source.view.webContents.id) !== source
  )
    throw Error("Frontend changed");
  return mountPanelView(source, resource);
}
async function mountPanelView(source: AgentView, resource: AgentViewResource) {
  const context = { ...source.context };
  const existing = [...agentViews.values()].find(
    (r) => r.context.handle === resource.context.handle,
  );
  if (existing) return existing.context;
  const record = createAgentView(resource, base, () => {
    if (agentViews.get(record.view.webContents.id) !== record) return;
    disposeView(record);
    panelLayout.panels = panelLayout.panels.filter(
      (p) => p.handle !== record.context.handle,
    );
    void rpc("closePanel", {
      sessionId: context.sessionId,
      source: context.handle,
      handle: record.context.handle,
    }).catch(() => {});
    resize();
  });
  agentViews.set(record.view.webContents.id, record);
  try {
    await record.view.webContents.loadURL(record.url);
    if (
      active?.sessionId !== context.sessionId ||
      agentViews.get(record.view.webContents.id) !== record
    )
      throw Error("Panel changed");
    resize();
    return record.context;
  } catch (error) {
    if (agentViews.get(record.view.webContents.id) === record)
      disposeView(record);
    await rpc("closePanel", {
      sessionId: context.sessionId,
      source: context.handle,
      handle: record.context.handle,
    }).catch(() => {});
    throw error;
  }
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
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
      ...Object.fromEntries(
        ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME"]
          .filter((k) => process.env[k] !== undefined)
          .map((k) => [k, process.env[k]!]),
      ),
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
      delivery: import("@plumsjs/host").PanelDelivery;
    };
    if (m.type === "reply") {
      const pending = requests.get(m.id);
      requests.delete(m.id);
      if (pending) m.ok ? pending.resolve(m.value) : pending.reject(m.error);
    } else if (m.type === "panel-event") {
      const delivery = m.delivery;
      if (
        active?.instanceId !== delivery.agentId ||
        active.sessionId !== delivery.sessionId
      )
        return;
      if (delivery.type === "message") {
        const record = [...agentViews.values()].find(
          (r) =>
            r.context.handle === delivery.message.to &&
            r.context.sessionId === delivery.sessionId,
        );
        if (record && !record.view.webContents.isDestroyed())
          record.view.webContents.send("panel-message", delivery.message);
      } else if (delivery.handle) {
        const record = [...agentViews.values()].find(
          (r) => r.context.handle === delivery.handle,
        );
        if (record) disposeView(record);
        panelLayout.panels = panelLayout.panels.filter(
          (p) => p.handle !== delivery.handle,
        );
        agentView?.webContents.send("agent-event", {
          topic: "panels.closed",
          data: { handle: delivery.handle },
        });
        resize();
      } else if (renewingSession !== delivery.sessionId)
        void recover(true, false);
      else {
        for (const record of [...agentViews.values()])
          if (record.view !== agentView) disposeView(record);
        panelLayout = { root: { x: 0, y: 0, width: 1, height: 1 }, panels: [] };
        resize();
      }
    } else if (m.type === "event") {
      const root = agentView && agentViews.get(agentView.webContents.id);
      if (
        active?.instanceId === m.instanceId &&
        root &&
        (root.legacyAgentEvents || root.context.componentId === m.packageId)
      )
        agentView?.webContents.send("agent-event", {
          packageId: m.packageId,
          topic: m.topic,
          data: m.data,
        });
      for (const record of agentViews.values())
        if (
          record.view !== agentView &&
          record.context.agentId === m.instanceId &&
          record.context.componentId === m.packageId
        )
          record.view.webContents.send("agent-event", {
            packageId: m.packageId,
            topic: m.topic,
            data: m.data,
          });
      if (["mcp.updated", "engine.status"].includes(m.topic))
        window.webContents.send("manager-refresh");
    } else if (m.type === "service-cancel") {
      approvals.get(m.id)?.abort();
    } else if (m.type === "service") {
      try {
        let value: unknown;
        if (m.method === "grant-confirm") {
          const controller = new AbortController();
          approvals.set(m.id, controller);
          const args = m.args as import("@plumsjs/host").GrantApproval;
          let selected: import("./confirm-window.js").TaskChoice | undefined;
          const allowed = await prompter.ask(
            {
              kind: "grant",
              subject: args.subject,
              action: "允许在所选有效期内处理以下数据并保存本地产出。",
              host: args.targets.join("、"),
              scopeOptions: [
                ...args.reads.map((r) => ({
                  key: "read:" + r.id,
                  label: "读取：" + r.title,
                })),
                ...args.outputs.map((r) => ({
                  key: "output:" + r.id,
                  label: "保存：" + r.title,
                })),
              ],
            },
            AbortSignal.any([AbortSignal.timeout(120_000), controller.signal]),
            (choice) => {
              selected = choice;
            },
          );
          value =
            allowed && selected
              ? {
                  durationMs: selected.durationMs,
                  reads: selected.selected
                    .filter((k) => k.startsWith("read:"))
                    .map((k) => k.slice(5)),
                  outputs: selected.selected
                    .filter((k) => k.startsWith("output:"))
                    .map((k) => k.slice(7)),
                }
              : null;
        } else if (m.method === "confirm") {
          const controller = new AbortController();
          approvals.set(m.id, controller);
          const args = m.args as ConfirmRequest;
          value = await prompter.ask(
            {
              kind:
                args.presentation === "engine-trust"
                  ? "engine-trust"
                  : args.presentation === "local-authorization"
                    ? "local-authorization"
                    : "capability",
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
        if (shutdownStarted) throw Error("Application is closing");
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
            "setProtocolBinding",
            "switchFoundation",
            "setFoundationEnabled",
            "retryFoundationRecovery",
          ].includes(method)
        )
          await recover();
        if (["grantTaskScope", "taskScopePlan"].includes(method))
          throw Error("Internal authorization method");
        if (method === "dataLocation")
          value = {
            profilePath: app.getPath("userData"),
            dataPath: process.env.PLUMS_DATA_DIR
              ? path.resolve(process.env.PLUMS_DATA_DIR)
              : path.join(app.getPath("userData"), "library"),
          };
        else if (method === "revealDataDirectory") {
          shell.showItemInFolder(app.getPath("userData"));
          value = null;
        } else if (method === "quitForBackup") {
          setImmediate(() => app.quit());
          value = null;
        } else if (method === "windowState")
          value = { fullscreen: window.isFullScreen() };
        else if (method === "agentState") value = runtimeState();
        else if (method === "hideAgent") {
          hideAgent();
          value = null;
        } else if (method === "showAgent") {
          showAgent();
          value = null;
        } else if (method === "revokeTaskScope") {
          if (active?.instanceId === args.instanceId) await recover(true, true);
          else await rpc("revokeTaskScope", args);
          value = null;
        } else if (method === "stopAgent") {
          await recover(true, true);
          value = null;
        } else if (method === "agentStatus") {
          try {
            const plan = (await rpc("agentEnablePlan", args)) as {
              missing: unknown[];
              missingProtocols?: unknown[];
              entries: { enabled: boolean; needsApproval: boolean }[];
            };
            value =
              plan.missing.length || plan.missingProtocols?.length
                ? "needs-config"
                : plan.entries.some((entry) => entry.needsApproval)
                  ? "disabled"
                  : "ready";
          } catch {
            value = "unavailable";
          }
        } else if (method === "openAgent")
          value = await openAgent(
            args.instanceId as string,
            args.componentId as string | undefined,
          );
        else if (method === "startAgent") {
          const plan = (await rpc("agentEnablePlan", args)) as {
            fingerprint: string;
            entries: {
              packageId: string;
              name: string;
              enabled: boolean;
              needsApproval: boolean;
              serviceTargets: Record<string, string[]>;
              permissions: {
                id: string;
                kind?: string;
                target: string;
                reason: string;
                operations?: string[];
              }[];
            }[];
            missing: unknown[];
            missingProtocols?: unknown[];
          };
          if (plan.missing.length || plan.missingProtocols?.length) {
            window.webContents.send("manager-select", args.instanceId);
            value = { needsSetup: true };
          } else {
            const disabled = plan.entries.filter((p) => p.needsApproval);
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
              const opened = await openAgent(args.instanceId as string);
              value = { opened, cancelled: opened === null };
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
        } else if (method === "revealComponentDraft") {
          const target = (await rpc("revealComponentDraft", {
            token: args.token,
            relative: args.relative,
          })) as string;
          if (args.relative === undefined) {
            if (await shell.openPath(target)) throw Error();
          } else shell.showItemInFolder(target);
          value = null;
        } else if (method === "saveComponentDraft") {
          const snapshot = (await rpc("componentDraftSnapshot", args)) as {
            source: import("@plumsjs/host").ComponentSource;
            manifest: import("@plumsjs/core").Manifest;
          };
          let approved = true;
          if (snapshot.source.kind === "agent")
            approved = await consent(
              snapshot.manifest.name,
              "保存新版本并更新当前 Agent，同意当前声明的权限。",
              [
                {
                  name: snapshot.manifest.name,
                  permissions: snapshot.manifest.permissions,
                  formatVersion: snapshot.manifest.formatVersion,
                },
              ],
            );
          if (approved) {
            if (
              snapshot.source.kind === "agent" &&
              active?.instanceId === snapshot.source.instanceId
            )
              await recover();
            value = await rpc("saveComponentDraft", {
              token: args.token,
              validationToken: args.validationToken,
              consent: snapshot.source.kind === "agent",
            });
            window.webContents.send("manager-refresh");
          } else
            value = { cancelled: true, librarySaved: false, applied: false };
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
              fingerprint: string;
              serviceTargets: Record<string, string[]>;
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
                serviceTargets: component.serviceTargets,
              },
            ],
          );
          if (approved)
            await rpc("enable", {
              ...args,
              expected: JSON.stringify(component.manifest),
              expectedAccess: component.fingerprint,
            });
          value = null;
        } else if (
          method === "export" ||
          method === "exportLibrary" ||
          method === "exportFoundation"
        ) {
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
        } else if (method === "bindControlledProgram") {
          const chosen = await dialog.showOpenDialog({
            title: "选择受控命令程序",
            properties: ["openFile"],
          });
          if (chosen.canceled) value = null;
          else
            value = await rpc(method, {
              ...args,
              program: chosen.filePaths[0],
            });
        } else if (method === "setDesktopTheme") {
          await rpc(method, args);
          const settings = (await rpc(
            "desktopSettings",
          )) as import("@plumsjs/host").DesktopSettings;
          nativeTheme.themeSource = settings.theme;
          value = null;
        } else if (
          [
            "foundationManagement",
            "listFoundations",
            "foundationPlan",
            "foundationStatus",
            "switchFoundation",
            "setFoundationEnabled",
            "retryFoundationRecovery",
            "restoreBuiltinFoundation",
            "removeFoundation",
            "list",
            "library",
            "inspectComponent",
            "openComponentDraft",
            "readComponentDraft",
            "retainComponentDraft",
            "writeComponentDraft",
            "discardComponentDraft",
            "validateComponentDraft",
            "planAssembly",
            "permitTaskTakeover",
            "commonTasks",
            "policyPlan",
            "selectPolicy",
            "grantPolicyScope",
            "revokePolicyScope",
            "stopCommonTask",
            "setComponentBackground",
            "resourcePlan",
            "createResourceGroup",
            "setResourceQualification",
            "setResourceBinding",
            "removeResourceGroup",
            "grantResourceRange",
            "revokeResourceRange",
            "protocolPlan",
            "workspacePlan",
            "setWorkspaceViews",
            "setProtocolBinding",
            "importLibrary",
            "importBundleComponents",
            "createAgent",
            "editAgent",
            "addLibraryComponent",
            "preview",
            "install",
            "resources",
            "agentReadinessPlan",
            "engineStatus",
            "tierPlan",
            "cacheStatus",
            "projectStatus",
            "refreshProjectConfiguration",
            "provideCredential",
            "revokeCredential",
            "clearCache",
            "tierStatus",
            "confirmTier",
            "lowerTier",
            "revokeLocal",
            "removeTierDirectory",
            "startEngine",
            "stopEngine",
            "revokeEngine",
            "disable",
            "unbindRoot",
            "settings",
            "audit",
            "approveMcp",
            "setStartup",
            "desktopSettings",
            "setDesktopSettings",
          ].includes(method)
        ) {
          value = await rpc(method, args);
          if (
            [
              "setComponentBackground",
              "stopCommonTask",
              "switchFoundation",
              "setFoundationEnabled",
              "retryFoundationRecovery",
              "restoreBuiltinFoundation",
              "removeFoundation",
              "importLibrary",
            ].includes(method)
          )
            window.webContents.send("manager-refresh");
        } else throw Error();
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
      const record = agentSender(event),
        bound = { ...record.context },
        agent = { ...active! };
      const binding = { sessionId: bound.sessionId, source: bound.handle };
      const guard = () => {
        if (
          active?.sessionId !== bound.sessionId ||
          agentViews.get(event.sender.id) !== record ||
          record.context.handle !== bound.handle
        )
          throw Error("Frontend changed");
      };
      try {
        if (
          Buffer.byteLength(JSON.stringify(args)) > 1024 * 1024 ||
          [
            "agentId",
            "instanceId",
            "ownerId",
            "source",
            "sessionId",
            "sender",
            "from",
          ].some((k) => Object.hasOwn(args, k))
        )
          throw Error("Invalid message");
        if (method === "manager") {
          hideAgent();
          return { ok: true, value: null };
        }
        if (method === "cancel") {
          if (bound.parentHandle) {
            await rpc("closePanel", { ...binding, handle: bound.handle });
            return { ok: true, value: null };
          }
          renewingSession = bound.sessionId;
          try {
            await rpc("stop", { instanceId: bound.agentId });
            const fresh = (await rpc("openFrontend", {
              instanceId: bound.agentId,
              componentId: bound.componentId,
            })) as AgentViewResource | null;
            guard();
            if (
              !fresh ||
              fresh.context.componentId !== bound.componentId ||
              agentViewFingerprint(fresh) !== record.snapshotFingerprint
            )
              throw Error("Frontend unavailable");
            record.context = fresh.context;
            record.legacyAgentEvents = fresh.legacyAgentEvents === true;
            active = {
              ...agent,
              sessionId: fresh.context.sessionId,
              handle: fresh.context.handle,
            };
            record.view.webContents.send("agent-event", {
              topic: "panels.session",
              data: fresh.context,
            });
            return { ok: true, value: null };
          } catch (error) {
            await recover();
            throw error;
          } finally {
            renewingSession = undefined;
          }
        }
        let value: unknown;
        if (method === "context") {
          const context = (await rpc(
            "frontendContext",
            binding,
          )) as import("@plumsjs/sdk").PanelContext;
          const { width, height } = window.getContentBounds();
          value = {
            ...context,
            instanceId: context.agentId,
            ownerId: context.componentId,
            name: agent.name,
            sdkVersion: "2",
            viewport: { width, height: Math.max(0, height - RUNNING_BAR) },
          };
        } else if (method === "openPanel")
          value = await openPanelView(
            record,
            args.requirementId as string,
            args.panelId as string,
          );
        else if (method === "closePanel")
          value = await rpc("closePanel", { ...binding, handle: args.handle });
        else if (method === "panelLayout") {
          const layout = (await rpc("panelLayout", {
            ...binding,
            layout: args.layout,
          })) as PanelLayout;
          guard();
          panelLayout = layout;
          resize();
          value = null;
        } else if (method === "postPanel")
          value = await rpc("postPanel", { ...binding, message: args.message });
        else if (method === "engine")
          value = await rpc("frontendEngine", {
            ...binding,
            operation: args.operation,
            args,
          });
        else if (method === "common")
          value = await rpc("frontendCommon", {
            ...binding,
            method: args.method,
            request: args.request,
          });
        else if (method === "resource")
          value = await rpc("frontendResource", {
            ...binding,
            operation: args.operation,
            request: args.request,
          });
        else if (method === "protocolStatus")
          value = await rpc("frontendProtocolStatus", {
            ...binding,
            requirementId: args.requirementId,
          });
        else if (["invoke", "invokeProtocol", "panelRespond"].includes(method))
          value = await rpc("frontendInvoke", {
            ...binding,
            request: {
              ...(method === "invokeProtocol"
                ? { requirementId: args.requirementId }
                : { kind: args.kind, name: args.name }),
              ...(method === "invoke" && args.packageId !== undefined
                ? { packageId: args.packageId }
                : {}),
              ...(method === "panelRespond"
                ? { messageId: args.messageId }
                : {}),
              input: args.input,
            },
          });
        else throw Error("Unknown interface");
        guard();
        return { ok: true, value: value ?? null };
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
  window.on("close", (event) => {
    if (!shutdownComplete) {
      event.preventDefault();
      app.quit();
    }
  });
  await ready;
  const settings = (await rpc(
    "desktopSettings",
  )) as import("@plumsjs/host").DesktopSettings;
  nativeTheme.themeSource = settings.theme;
  updateBackground();
  await window.loadFile(path.join(base, "renderer/index.html"));
  window.show();
});
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  prompter?.dispose();
  for (const controller of approvals.values()) controller.abort();
  const finish = () => {
    shutdownComplete = true;
    app.quit();
  };
  if (!broker || broker.exitCode !== null || broker.signalCode !== null)
    finish();
  else {
    // IPC disconnect makes the broker await DesktopHost.close() before exiting.
    broker.once("exit", finish);
    if (broker.connected) broker.disconnect();
    else broker.kill("SIGTERM");
  }
});
app.on("window-all-closed", () => app.quit());
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
