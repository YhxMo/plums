import { useEffect, useRef, useState } from "react";
import {
  installExtension,
  retryImport,
  removeFailedImport,
  uninstallExtension,
  persistComposition,
  configureExtension,
  importExtensionPackage,
} from "@modules/shell/extension-actions";
import {
  loadPackage,
  readPackage,
  type PackageFile,
} from "@modules/shell/extension-package";
import { previewOf, usePackageOffers } from "./usePackageOffers";
import type { ImportPreview } from "./InstallDialog";
import { waitingNotice } from "./enable-feedback";
import type { ConfigurationValue } from "@modules/sdk/configuration";
import type { Runtime } from "@/shell/runtime";
import { errorMessage, stateMessage } from "@/shell/messages";
import { useExtensionState } from "@/shell/useExtensionState";
import type { ManagementInputs, ExtensionCardModel } from "./controllers";

/** Names the step that failed, so the message reads on its own. */
const failed =
  (step: string, after = "") =>
  (reason: unknown): never => {
    const message = errorMessage(reason).replace(/。$/, "");
    throw new Error(`${step}：${message}。${after}`);
  };

type ManagementDialog =
  | { kind: "install"; source: HTMLElement }
  | {
      kind: "configure" | "uninstall" | "stop";
      id: string;
      source: HTMLElement;
    }
  | null;

export function useExtensionManager(
  runtime: Runtime,
  { operations, workspace, navigation, authorization }: ManagementInputs,
) {
  const { host, catalog } = runtime;
  const { value, run } = useExtensionState(runtime);
  const { manager, closeManager } = navigation;
  const { busy, operate, setError, setNotice } = operations;
  // The extension whose details are open, and the card that opened them.
  const [selectedId, setSelectedId] = useState("");
  const detailTrigger = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [failedImports, setFailedImports] = useState(
    runtime.initial.failedImports,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const removed = useRef(false);
  useEffect(() => {
    // Asked for one extension: its details open over the page.
    const target = manager.open ? (manager.targetId ?? "") : "";
    detailTrigger.current = null;
    setSelectedId(target);
    if (manager.open) heading.current?.focus();
  }, [manager.open, manager.targetId]);
  // Enabling, stopping and granting are kept for the next start as they happen.
  useEffect(() => {
    let queued = false;
    return host.subscribe(() => {
      if (queued) return;
      queued = true;
      run((draft) => {
        queued = false;
        return persistComposition(host, draft);
      }).catch((reason) =>
        // A failed operation already names this; keep its own wording.
        setError(
          (shown) => shown || `扩展启用状态未保存：${errorMessage(reason)}`,
        ),
      );
    });
  }, [host, run, setError]);
  useEffect(() => {
    if (!dialog && removed.current) {
      removed.current = false;
      heading.current?.focus();
    }
  }, [dialog]);
  const installed = catalog.filter((entry) => host.ids().includes(entry.id));
  const selected = installed.find((entry) => entry.id === selectedId);
  const reportNotRunning = (id: string) => {
    const info = host.inspect(id);
    const notice = waitingNotice(info.status, stateMessage(info));
    if (notice) setNotice(notice);
  };
  const clearFailure = (id: string) =>
    setFailedImports((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  const close = () => setDialog(null);
  const cardTitle = (id: string) =>
    document.querySelector<HTMLElement>(
      `[data-extension-id="${CSS.escape(id)}"] [data-slot=extension-title]`,
    );
  /** Moves focus to a newly installed extension, whose switch is next to it. */
  const focusCard = (id: string) =>
    requestAnimationFrame(() => cardTitle(id)?.focus());
  const offer = usePackageOffers(runtime, {
    imports: value.imports,
    busy,
    operate,
    install: importConfirmed,
  });
  /** Runs main.js now that the user has confirmed, then saves it, off. */
  async function importConfirmed(pkg: ImportPreview["pkg"]) {
    const definition = await loadPackage(pkg);
    const result = await run((draft) =>
      importExtensionPackage(
        host,
        draft,
        pkg,
        definition,
        runtime.packages,
        prepareUninstall,
      ),
    );
    clearFailure(result.entry.id);
    focusCard(result.entry.id);
    return result;
  }
  const prepareUninstall = (owner: string, declared: boolean) =>
    runtime.adapter.credentials.prepareUninstall(owner, declared);
  function open(
    kind: "configure" | "uninstall" | "stop",
    id: string,
    source: HTMLElement,
  ) {
    setError("");
    setDialog({ kind, id, source });
  }
  const views = host.views();
  const rows: ExtensionCardModel[] = installed.map((entry) => {
    const own = views.filter((view) => view.owner === entry.id);
    return {
      entry,
      manifest: host.manifest(entry.id),
      state: host.inspect(entry.id),
      users: host.users(entry.id),
      imported: value.imports.some((item) => item.id === entry.id),
      dialogs: own.filter((view) => view.presentation === "dialog"),
    };
  });
  return {
    failedImports,
    visible: manager.open,
    header: {
      heading,
      count: catalog.length,
      close: closeManager,
      backLabel: manager.backLabel,
      install: (source: HTMLElement) => setDialog({ kind: "install", source }),
    },
    list: {
      rows,
      failures: failedImports,
      installed: host.ids(),
      busy,
      adapter: runtime.adapter,
      actions: {
        /** Opens an extension's details from its card. */
        select: (id: string, source: HTMLElement) => {
          detailTrigger.current = source;
          setSelectedId(id);
        },
        /**
         * Opens a dialog view over management, like model connections,
         * in place of the details; closing it returns to the card.
         */
        openView: (
          view: { id: string; label: string },
          source: HTMLElement,
        ) => {
          const card = cardTitle(selectedId) ?? source;
          setSelectedId("");
          navigation.setDialog(view, card);
        },
        configure: (id: string, source: HTMLElement) =>
          open("configure", id, source),
        uninstall: (id: string, source: HTMLElement) =>
          open("uninstall", id, source),
        toggle: (
          row: Pick<
            ExtensionCardModel,
            "entry" | "manifest" | "state" | "users"
          >,
          source: HTMLElement,
        ) => {
          const id = row.entry.id;
          const capabilities = row.manifest.capabilities ?? [];
          const granted = host.granted(id);
          if (row.state.status === "active") {
            if (row.users.some((group) => group.users.length))
              open("stop", id, source);
            else void operate(() => host.stop(id));
          } else if (capabilities.some((cap) => !granted.includes(cap)))
            authorization.requestAuthorization(
              [id],
              async () => {
                await host.grant(id, capabilities);
                await workspace.enableExtension(id);
                reportNotRunning(id);
              },
              source,
            );
          else
            void operate(async () => {
              await workspace.enableExtension(id);
              reportNotRunning(id);
            });
        },
        retry: (id: string) =>
          operate(async () => {
            await run((draft) =>
              retryImport(host, draft, id, location.href, Date.now(), {
                packages: runtime.packages,
              }),
            );
            clearFailure(id);
          }),
        removeFailure: (id: string) =>
          operate(async () => {
            await run((draft) =>
              removeFailedImport(
                host,
                draft,
                id,
                prepareUninstall,
                runtime.packages,
              ),
            );
            clearFailure(id);
          }),
      },
    },
    detail: {
      host,
      access: runtime.adapter.credentials,
      operations,
      entry: selected,
      trigger: detailTrigger.current,
      close: () => setSelectedId(""),
    },
    dialogs: {
      dialog,
      close,
      offer,
      label: (id: string) =>
        catalog.find((entry) => entry.id === id)?.label ?? id,
      install: (url: string) =>
        operate(async () => {
          const entry = await run((draft) =>
            installExtension(host, draft, { url, baseUrl: location.href }),
          );
          clearFailure(entry.id);
          close();
          focusCard(entry.id);
          setNotice(
            "扩展路径已保存。请检查来源与能力，再启用扩展；下次启动会重新加载。",
          );
        }),
      /** Reads the package's manifest; no code runs and nothing is saved yet. */
      preview: async (files: () => PackageFile[] | Promise<PackageFile[]>) => {
        let preview: ImportPreview | undefined;
        await operate(async () => {
          preview = previewOf(
            await readPackage(await files()),
            value.imports,
            host,
          );
          if (!preview)
            throw Error("此 ID 属于内置扩展，不能用导入的扩展包替换。");
        });
        return preview;
      },
      /** Runs main.js now that the user has confirmed, then saves. */
      importPackage: ({ pkg }: ImportPreview) =>
        operate(async () => {
          const { replaced } = await importConfirmed(pkg);
          close();
          setNotice(
            replaced
              ? "已替换为新版本。请重新启用并确认权限；如有连接，需重新录入 API Key。扩展数据已保留。"
              : "扩展已导入。请检查来源与能力，再启用扩展。",
          );
        }),
      stop: (id: string) =>
        operate(async () => {
          await host.stop(id).catch(failed("停用未完成"));
          close();
        }),
      uninstall: (id: string) =>
        operate(async () => {
          await run((draft) =>
            uninstallExtension(
              host,
              draft,
              id,
              prepareUninstall,
              runtime.packages,
            ),
          ).catch(
            failed(
              "卸载未完成",
              "扩展可能已停用；可重试，保存回执不明时请重新加载确认。",
            ),
          );
          removed.current = true;
          close();
          setNotice("扩展已卸载，已保存的数据和模块文件已保留。");
        }),
      configure: (id: string, values: Record<string, ConfigurationValue>) =>
        operate(async () => {
          await run((draft) =>
            configureExtension(host, draft, id, values),
          ).catch(
            failed(
              "配置操作未完成",
              "扩展可能已停用，配置可能已保存；重载确认或修复后重新启用。",
            ),
          );
          close();
          setNotice("配置已保存并应用；未启用的扩展保持停用。");
        }),
    },
  };
}
