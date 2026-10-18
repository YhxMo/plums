import { Host } from "../../modules/extension-host/host";
import { PlatformAdapter } from "../../src/platform";
import { extensionOwner, type ExtensionDefinition } from "../../modules/sdk";
import "./style.css";

type Descriptor = { handle: string; name: string };
type Selection =
  | { status: "selected"; documents: Descriptor[] }
  | { status: "cancelled" }
  | { status: "rejected"; reason: string }
  | { status: "unknown" };
const adapter = new PlatformAdapter();
const host = new Host(adapter);
const id = "sample.documents",
  other = "sample.documents.other",
  owner = extensionOwner(id);
const workspace = document.querySelector<HTMLElement>("#workspace")!;
const output = document.querySelector<HTMLElement>("#result")!;
const managementStatus =
  document.querySelector<HTMLElement>("#management-status")!;
const state: {
  ready: boolean;
  selection: Selection | null;
  documents: Descriptor[];
  read: unknown;
  crossOwner: unknown;
  error: string | null;
  events: string[];
} = {
  ready: false,
  selection: null,
  documents: [],
  read: null,
  crossOwner: null,
  error: null,
  events: [],
};
function publish(event: string) {
  state.events.push(event);
  output.textContent = JSON.stringify(state, null, 2);
}
function failure(error: unknown) {
  return error instanceof Error ? error.name : "Operation failed";
}
type RawDocumentAccess = {
  read(
    handle: string,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<unknown>;
  list(): Promise<unknown>;
};
let rawDocuments: RawDocumentAccess | undefined;
let scenarioBusy = false;
type ScenarioReport = {
  passed: boolean;
  checks: { name: string; passed: boolean; detail?: string }[];
  platform: string;
  limitations: string[];
};
let scenarioReport: ScenarioReport | null = null;
let selectController: AbortController | undefined;
let readController: AbortController | undefined;
let closeView: (() => void | Promise<void>) | undefined;
let controls:
  | {
      refresh(): Promise<Descriptor[]>;
      read(handle?: string, maxBytes?: number): Promise<unknown>;
    }
  | undefined;
let otherRead:
  ((handle: string, maxBytes: number) => Promise<unknown>) | undefined;
let lifecycle: Promise<void> = Promise.resolve();
let lifecycleBusy = false;
let cleanupFailed = false;
function serialize(operation: () => Promise<void>) {
  const work = lifecycle.then(async () => {
    lifecycleBusy = true;
    try {
      await operation();
    } finally {
      lifecycleBusy = false;
    }
  });
  lifecycle = work.catch(() => {});
  return work;
}
const definition: ExtensionDefinition = {
  manifest: {
    id,
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["document.read"],
  },
  activate(ctx) {
    const raw: RawDocumentAccess = {
      read: (handle, maxBytes, signal) =>
        ctx.task(() =>
          ctx.platform("document.read", { handle, maxBytes }, signal),
        ),
      list: () =>
        ctx.task(() => ctx.platform("document.read", { action: "list" })),
    };
    rawDocuments = raw;
    ctx.onDispose(() => {
      if (rawDocuments === raw) rawDocuments = undefined;
    });
    ctx.view({
      id: "sample.documents",
      label: "已选择文档",
      mount(root) {
        let disposed = false,
          busy = false;
        const section = document.createElement("section");
        section.className = "document-card";
        const title = document.createElement("h2");
        title.textContent = "已选择文档";
        const refresh = document.createElement("button");
        refresh.textContent = "刷新文档";
        refresh.dataset.testid = "document-refresh";
        const label = document.createElement("label");
        label.textContent = "当前文档";
        const list = document.createElement("select");
        list.dataset.testid = "document-list";
        label.append(list);
        const limitLabel = document.createElement("label");
        limitLabel.textContent = "最大读取字节数（1–65536）";
        const limit = document.createElement("input");
        limit.type = "number";
        limit.min = "1";
        limit.max = "65536";
        limit.value = "65536";
        limit.dataset.testid = "document-limit";
        limitLabel.append(limit);
        const read = document.createElement("button");
        read.textContent = "读取";
        read.dataset.testid = "document-read";
        const status = document.createElement("p");
        status.setAttribute("role", "status");
        status.dataset.testid = "document-status";
        status.textContent = "请通过宿主选择自己创建的测试文件，然后刷新列表。";
        const text = document.createElement("pre");
        text.dataset.testid = "document-text";
        section.append(title, refresh, label, limitLabel, read, status, text);
        root.append(section);
        const sync = () => {
          refresh.disabled = busy;
          read.disabled = busy || !list.value;
          list.disabled = busy;
          limit.disabled = busy;
        };
        const api = {
          async refresh() {
            if (disposed || busy) throw Error("View unavailable or busy");
            busy = true;
            sync();
            try {
              const value = await ctx.platform("document.read", {
                action: "list",
              });
              if (disposed) throw Error("View disposed");
              if (
                !Array.isArray(value) ||
                value.some(
                  (item) =>
                    !item ||
                    typeof item.handle !== "string" ||
                    typeof item.name !== "string",
                )
              )
                throw Error("Invalid document list");
              const descriptors = value as Descriptor[];
              const previous = list.value;
              list.replaceChildren();
              for (const entry of descriptors) {
                const option = document.createElement("option");
                option.value = entry.handle;
                option.textContent = entry.name;
                list.append(option);
              }
              if (descriptors.some((entry) => entry.handle === previous))
                list.value = previous;
              state.documents = descriptors;
              status.textContent = descriptors.length
                ? `可读文档 ${descriptors.length} 个`
                : "尚无授权文档。";
              publish("list");
              return descriptors;
            } finally {
              if (!disposed) {
                busy = false;
                sync();
              }
            }
          },
          async read(handle = list.value, maxBytes = Number(limit.value)) {
            if (disposed || busy) throw Error("View unavailable or busy");
            busy = true;
            const operation = new AbortController();
            readController = operation;
            sync();
            status.textContent = "正在读取…";
            try {
              const value = await ctx.task(() =>
                ctx.platform(
                  "document.read",
                  { handle, maxBytes },
                  operation.signal,
                ),
              );
              if (disposed) return value;
              state.read = value;
              text.textContent = JSON.stringify(value, null, 2);
              status.textContent = "读取请求已返回，请以结果状态为准。";
              publish("read");
              return value;
            } catch (error) {
              if (!disposed) {
                state.read = { error: failure(error) };
                text.textContent = JSON.stringify(state.read);
                status.textContent = "读取未交付。请核对权限或取消状态。";
                publish("read-error");
              }
              throw error;
            } finally {
              if (readController === operation) readController = undefined;
              if (!disposed) {
                busy = false;
                sync();
              }
            }
          },
        };
        const onRefresh = () => {
          void api.refresh().catch(report);
        };
        const onRead = () => {
          void api.read().catch(report);
        };
        const onChange = () => sync();
        refresh.addEventListener("click", onRefresh);
        read.addEventListener("click", onRead);
        list.addEventListener("change", onChange);
        controls = api;
        sync();
        return () => {
          disposed = true;
          readController?.abort();
          if (controls === api) controls = undefined;
          refresh.removeEventListener("click", onRefresh);
          read.removeEventListener("click", onRead);
          list.removeEventListener("change", onChange);
          section.remove();
        };
      },
    });
  },
};
const second: ExtensionDefinition = {
  manifest: {
    id: other,
    version: "1.0.0",
    apiVersion: 1,
    capabilities: ["document.read"],
  },
  activate(ctx) {
    const call = (handle: string, maxBytes: number) =>
      ctx.task(() => ctx.platform("document.read", { handle, maxBytes }));
    otherRead = call;
    ctx.onDispose(() => {
      if (otherRead === call) otherRead = undefined;
    });
  },
};
function report(error: unknown) {
  state.error = failure(error);
  managementStatus.textContent = cleanupFailed
    ? "清理失败，需要重启。管理诊断仍可查看。"
    : "操作未完成，请查看结果并核对当前状态。";
  publish("error");
}
async function close() {
  readController?.abort();
  if (closeView) {
    try {
      await closeView();
      closeView = undefined;
    } catch (error) {
      cleanupFailed = true;
      workspace.inert = true;
      throw error;
    }
  }
}
async function start() {
  if (cleanupFailed) throw Error("Restart required");
  if (!host.ids().includes(id)) host.install(definition);
  await host.grant(id, ["document.read"]);
  await host.start(id);
  if (!closeView) closeView = host.mountView(id, workspace);
  await controls?.refresh();
  managementStatus.textContent = "扩展已授权并启动。";
  publish("start");
}
async function select(multiple = false) {
  if (selectController || lifecycleBusy || cleanupFailed || !controls)
    throw Error("Selection unavailable");
  const operation = new AbortController();
  selectController = operation;
  managementStatus.textContent =
    "请选择自建测试文件；取消后系统选择器可能仍需手动关闭。";
  try {
    const result = await adapter.selectDocuments(
      owner,
      multiple,
      operation.signal,
    );
    state.selection = result;
    publish("selection");
    if (controls && !lifecycleBusy) await controls.refresh();
    return result;
  } finally {
    if (selectController === operation) selectController = undefined;
  }
}
async function revoke(handle?: string) {
  await adapter.revokeDocument(owner, handle);
  publish(handle ? "revoke-one" : "revoke-all");
  // Do not discard already delivered text: revocation cannot retrieve copies.
  if (controls && !readController) await controls.refresh();
}
const probe = {
  state,
  get report() {
    return scenarioReport;
  },
  runSelected: runSelectedScenario,
  host,
  owner,
  otherOwner: extensionOwner(other),
  select,
  list: () => adapter.documents(owner),
  refresh: () => {
    if (!controls) throw Error("View inactive");
    return controls.refresh();
  },
  read: (handle?: string, maxBytes?: number) => {
    if (!controls) throw Error("View inactive");
    return controls.read(handle, maxBytes);
  },
  cancelSelection: () => {
    selectController?.abort();
    publish("cancel-selection");
  },
  cancelRead: () => {
    readController?.abort();
    publish("cancel-read");
  },
  revoke,
  crossOwner: async (handle: string, maxBytes = 65536) => {
    if (!otherRead) throw Error("Second owner inactive");
    const value = await otherRead(handle, maxBytes);
    state.crossOwner = value;
    publish("cross-owner");
    return value;
  },
  stop: () =>
    serialize(async () => {
      selectController?.abort();
      await close();
      await host.stop(id);
      state.documents = [];
      managementStatus.textContent = "扩展已停用；通过列表核查句柄撤销。";
      publish("stop");
    }),
  restart: () =>
    serialize(async () => {
      selectController?.abort();
      await close();
      if (host.ids().includes(id)) await host.stop(id);
      await start();
    }),
  uninstall: () =>
    serialize(async () => {
      selectController?.abort();
      await close();
      if (host.ids().includes(id)) {
        await host.stop(id);
        await host.uninstall(id);
      }
      state.documents = [];
      managementStatus.textContent = "扩展已卸载。";
      publish("uninstall");
    }),
};
Object.assign(window, { __documentProbe: probe });
const handlers: Record<string, () => unknown> = {
  "select-one": () => select(false),
  "select-many": () => select(true),
  "cancel-selection": probe.cancelSelection,
  "cancel-read": probe.cancelRead,
  "revoke-one": () => {
    const selected = workspace.querySelector<HTMLSelectElement>(
      "[data-testid=document-list]",
    )?.value;
    if (!selected) throw Error("No selected handle");
    return revoke(selected);
  },
  "revoke-all": () => revoke(),
  stop: probe.stop,
  restart: probe.restart,
  uninstall: probe.uninstall,
  "cross-owner": () => {
    const selected = workspace.querySelector<HTMLSelectElement>(
      "[data-testid=document-list]",
    )?.value;
    if (!selected) throw Error("No selected handle");
    return probe.crossOwner(selected);
  },
};
for (const [hook, action] of Object.entries(handlers))
  document
    .querySelector(`[data-testid=${hook}]`)!
    .addEventListener("click", () => {
      if (!scenarioBusy) void Promise.resolve().then(action).catch(report);
    });

async function runSelectedScenario() {
  if (scenarioBusy) throw Error("Scenario already running");
  scenarioBusy = true;
  const wasInert = workspace.inert;
  workspace.inert = true;
  const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].map((button) => ({ button, disabled: button.disabled }));
  for (const { button } of buttons) button.disabled = true;
  const checks: ScenarioReport["checks"] = [];
  const assert: (condition: unknown, message: string) => asserts condition = (
    condition,
    message,
  ) => {
    if (!condition) throw Error(message);
  };
  const object = (value: unknown): Record<string, unknown> => {
    assert(
      typeof value === "object" && value !== null,
      "Missing structured response",
    );
    return value as Record<string, unknown>;
  };
  const expectRead = (value: unknown, text: string, bytes: number) => {
    const result = object(value);
    assert(
      result.status === "read" &&
        result.text === text &&
        result.bytes === bytes,
      `Expected confirmed read of ${bytes} bytes`,
    );
  };
  const expectRejected = (value: unknown, reason: string) => {
    const result = object(value);
    assert(
      result.status === "rejected" && result.reason === reason,
      `Expected rejection: ${reason}`,
    );
    assert(
      !("text" in result) && !("bytes" in result),
      "Rejection contains document data",
    );
  };
  const check = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({
        name,
        passed: false,
        detail: error instanceof Error ? error.message : "Unstructured failure",
      });
      throw error;
    }
  };
  try {
    await lifecycle;
    const files = new Map<string, Descriptor>();
    let access: RawDocumentAccess | undefined;
    await check("five-selected-fixtures-ready", async () => {
      assert(
        state.ready && adapter.kind === "native",
        "Native ready state required",
      );
      assert(
        !selectController && !readController && !cleanupFailed,
        "Another operation is in progress",
      );
      access = rawDocuments;
      assert(access, "Document extension must be active");
      const entries = await access.list();
      assert(Array.isArray(entries), "Selected document list unavailable");
      const required = [
        "plums-alpha.txt",
        "plums-beta.txt",
        "plums-invalid.txt",
        "plums-large.txt",
        "plums-limit.txt",
      ];
      for (const name of required) {
        const matches = entries.filter(
          (entry: Descriptor) => entry.name === name,
        );
        assert(
          matches.length === 1 && typeof matches[0].handle === "string",
          `Select exactly one ${name}`,
        );
        files.set(name, matches[0]);
      }
    });
    const active = access!;
    const handle = (name: string) => files.get(name)!.handle;
    const alpha = handle("plums-alpha.txt"),
      beta = handle("plums-beta.txt");
    await check("alpha-utf8-text-and-bytes", async () => {
      expectRead(await active.read(alpha, 65536), "Plums alpha 梅子\n", 19);
    });
    await check("beta-text-and-bytes", async () => {
      expectRead(await active.read(beta, 65536), "Plums beta\n", 11);
    });
    await check("caller-byte-limit", async () => {
      expectRejected(await active.read(alpha, 5), "too-large");
    });
    await check("invalid-utf8-rejected", async () => {
      expectRejected(
        await active.read(handle("plums-invalid.txt"), 65536),
        "encoding",
      );
    });
    await check("oversize-rejected", async () => {
      expectRejected(
        await active.read(handle("plums-large.txt"), 65536),
        "too-large",
      );
    });
    await check("exact-64k-boundary", async () => {
      // Compare locally; never print the 64 KiB payload into UI or the report.
      expectRead(
        await active.read(handle("plums-limit.txt"), 65536),
        "x".repeat(65536),
        65536,
      );
    });
    await check("cross-owner-denied", async () => {
      assert(otherRead, "Second owner inactive");
      expectRejected(await otherRead(alpha, 65536), "denied");
    });
    await check("revoke-one-preserves-other", async () => {
      await adapter.revokeDocument(owner, alpha);
      expectRejected(await active.read(alpha, 65536), "denied");
      expectRead(await active.read(beta, 65536), "Plums beta\n", 11);
    });
    await check("pre-aborted-read-no-data", async () => {
      const controller = new AbortController();
      controller.abort();
      let returned: unknown;
      try {
        returned = await active.read(beta, 65536, controller.signal);
      } catch (error) {
        assert(
          error instanceof Error && error.name === "AbortError",
          "Expected AbortError for pre-aborted read",
        );
        return;
      }
      const response = object(returned);
      assert(
        response.status === "cancelled" &&
          !("text" in response) &&
          !("bytes" in response),
        "Cancelled read delivered data or wrong outcome",
      );
    });
    await check("stopped-context-rejected", async () => {
      await probe.stop();
      let rejected = false;
      try {
        await active.read(beta, 65536);
      } catch {
        rejected = true;
      }
      assert(rejected, "Stopped context accepted a request");
    });
    await check("restart-clears-bindings-and-old-handle", async () => {
      await probe.restart();
      assert(rawDocuments && rawDocuments !== active, "New activation missing");
      const entries = await rawDocuments.list();
      assert(
        Array.isArray(entries) && entries.length === 0,
        "Restart retained bindings",
      );
      expectRejected(await rawDocuments.read(beta, 65536), "denied");
    });
    await check("uninstall-removes-record", async () => {
      await probe.uninstall();
      assert(
        !host.ids().includes(id),
        "Uninstalled extension remains registered",
      );
    });
  } catch {
    /* Failure already recorded; do not continue destructive steps. */
  } finally {
    scenarioReport = {
      passed: checks.length === 13 && checks.every((check) => check.passed),
      checks,
      platform: adapter.kind,
      limitations: [
        "Only files explicitly selected through the native system picker are used.",
        "The scenario revokes bindings, stops, restarts and uninstalls the synthetic extension.",
        "Pre-aborted cancellation does not prove cancellation during a native read.",
        "No persistent authorization, process restart, device loss or file mutation verification.",
      ],
    };
    output.textContent = JSON.stringify(scenarioReport, null, 2);
    managementStatus.textContent = scenarioReport.passed
      ? "已选测试文件验收通过；测试扩展已卸载。"
      : "验收未通过；请核对结果，重新授权并选择测试文件后再运行。";
    scenarioBusy = false;
    workspace.inert = cleanupFailed || wasInert;
    for (const { button, disabled } of buttons)
      if (button.isConnected) button.disabled = disabled;
  }
  return scenarioReport;
}
document
  .querySelector<HTMLButtonElement>("[data-testid=verify-selected]")!
  .addEventListener("click", () => {
    void runSelectedScenario().catch(report);
  });

void serialize(async () => {
  await adapter.initializeDocuments();
  host.install(second);
  await host.grant(other, ["document.read"]);
  await host.start(other);
  await start();
  state.ready = true;
  publish("ready");
}).catch(report);
