import { BrowserWindow, ipcMain, nativeTheme, session } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
export interface ConfirmationView {
  kind:
    | "capability"
    | "consent"
    | "task"
    | "grant"
    | "engine-trust"
    | "local-authorization";
  subject: string;
  action: string;
  reason?: string;
  host?: string;
  operation?: "egress" | "write" | "exec";
  scopeOptions?: { key: string; label: string }[];
  permissions?: { name: string; descriptions: string[] }[];
}
export interface TaskChoice {
  selected: string[];
  durationMs: number;
}
interface Pending {
  choose?: (choice: TaskChoice) => void;
  view: ConfirmationView;
  signal: AbortSignal;
  resolve: (allowed: boolean) => void;
  abort: () => void;
}
/** Only this main-process queue can create an authorization window. */
export class ConfirmPrompter {
  private queue: Pending[] = [];
  private current?: {
    window: BrowserWindow;
    token: string;
    readyAt: number;
    view: ConfirmationView;
    finish: (allowed: boolean) => void;
    choose?: (choice: TaskChoice) => void;
  };
  private disposed = false;
  constructor(
    private parent: BrowserWindow,
    private base: string,
  ) {
    ipcMain.handle("confirm:load", (event) => {
      const current = this.current;
      if (
        !current ||
        event.sender !== current.window.webContents ||
        event.senderFrame !== current.window.webContents.mainFrame
      )
        throw Error("Invalid sender");
      return { ...current.view, token: current.token };
    });
    ipcMain.handle(
      "confirm:answer",
      (
        event,
        answer: { token?: unknown; allow?: unknown; choice?: TaskChoice },
      ) => {
        const current = this.current;
        if (
          !current ||
          event.sender !== current.window.webContents ||
          event.senderFrame !== current.window.webContents.mainFrame ||
          answer?.token !== current.token
        )
          return false;
        if (answer.allow === true && Date.now() < current.readyAt) return false;
        if (answer.allow === true && current.view.scopeOptions) {
          const choice = answer.choice;
          if (
            !choice ||
            ![900_000, 3_600_000].includes(choice.durationMs) ||
            !Array.isArray(choice.selected) ||
            choice.selected.some(
              (key) =>
                !current.view.scopeOptions!.some(
                  (option) => option.key === key,
                ),
            )
          )
            return false;
          current.choose?.(structuredClone(choice));
        }
        current.finish(answer.allow === true);
        return true;
      },
    );
    parent.once("closed", () => this.dispose());
  }
  ask(
    view: ConfirmationView,
    signal: AbortSignal = AbortSignal.timeout(120_000),
    choose?: (choice: TaskChoice) => void,
  ): Promise<boolean> {
    if (this.disposed || signal.aborted || this.parent.isDestroyed())
      return Promise.resolve(false);
    return new Promise((resolve) => {
      const pending: Pending = {
        choose,
        view: structuredClone(view),
        signal,
        resolve,
        abort: () => {
          const index = this.queue.indexOf(pending);
          if (index >= 0) {
            this.queue.splice(index, 1);
            signal.removeEventListener("abort", pending.abort);
            resolve(false);
          }
        },
      };
      signal.addEventListener("abort", pending.abort, { once: true });
      this.queue.push(pending);
      this.next();
    });
  }
  async askTask(view: ConfirmationView): Promise<TaskChoice | undefined> {
    let choice: TaskChoice | undefined;
    const allowed = await this.ask(
      view,
      AbortSignal.timeout(120_000),
      (value) => {
        choice = value;
      },
    );
    return allowed ? choice : undefined;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.current?.finish(false);
    for (const pending of this.queue.splice(0)) {
      pending.signal.removeEventListener("abort", pending.abort);
      pending.resolve(false);
    }
    ipcMain.removeHandler("confirm:load");
    ipcMain.removeHandler("confirm:answer");
  }
  private next(): void {
    if (this.current || this.disposed) return;
    const pending = this.queue.shift();
    if (!pending) return;
    pending.signal.removeEventListener("abort", pending.abort);
    if (pending.signal.aborted) {
      pending.resolve(false);
      this.next();
      return;
    }
    const isolated = session.fromPartition("plums-confirm");
    isolated.setPermissionRequestHandler((_w, _p, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    const rendererURL = pathToFileURL(
      path.join(this.base, "renderer") + path.sep,
    ).href;
    isolated.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith(rendererURL) }),
    );
    const child = new BrowserWindow({
      parent: this.parent,
      modal: true,
      show: false,
      width: 420,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Plums · 安全确认",
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 14, y: 14 },
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#141311" : "#f7f6f3",
      webPreferences: {
        preload: path.join(this.base, "confirm-preload.cjs"),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        session: isolated,
      },
    });
    let finished = false;
    let focused = false;
    const updateBackground = () => {
      if (!child.isDestroyed())
        child.setBackgroundColor(
          nativeTheme.shouldUseDarkColors ? "#141311" : "#f7f6f3",
        );
    };
    const finish = (allowed: boolean) => {
      if (finished) return;
      finished = true;
      pending.signal.removeEventListener("abort", abort);
      nativeTheme.removeListener("updated", updateBackground);
      this.current = undefined;
      if (!child.isDestroyed()) child.destroy();
      pending.resolve(allowed);
      this.next();
    };
    const abort = () => finish(false);
    this.current = {
      window: child,
      token: randomUUID(),
      readyAt: Infinity,
      view: pending.view,
      choose: pending.choose,
      finish,
    };
    pending.signal.addEventListener("abort", abort, { once: true });
    nativeTheme.on("updated", updateBackground);
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-navigate", (event) => event.preventDefault());
    child.webContents.on("will-redirect", (event) => event.preventDefault());
    child.webContents.on("render-process-gone", () => finish(false));
    child.webContents.on("unresponsive", () => finish(false));
    child.on("close", () => finish(false));
    child.on("closed", () => finish(false));
    child.on("focus", () => {
      focused = true;
    });
    child.on("blur", () => {
      if (focused) finish(false);
    });
    // Task Enter is handled by the trusted renderer so native selects remain usable.
    child.webContents.on("before-input-event", (event, input) => {
      if (
        input.type === "keyDown" &&
        (input.key === "Escape" ||
          (input.key === "Enter" &&
            pending.view.kind !== "task" &&
            pending.view.kind !== "grant"))
      ) {
        event.preventDefault();
        finish(false);
      }
    });
    void child
      .loadFile(path.join(this.base, "renderer/confirm.html"))
      .then(() => {
        if (finished) return;
        this.current!.readyAt = Date.now() + 600;
        child.show();
      })
      .catch(() => finish(false));
  }
}
