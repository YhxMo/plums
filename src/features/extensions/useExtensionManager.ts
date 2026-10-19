import { useEffect, useRef, useState } from "react";
import {
  installExtension,
  retryImport,
  removeFailedImport,
  uninstallExtension,
  persistComposition,
  configureExtension,
  importExtensionFile,
} from "../../../modules/shell/extension-actions";
import {
  loadExtensionSource,
  readExtensionFile,
} from "../../../modules/shell/file-import";
import type { ImportPreview } from "./InstallDialog";
import { waitingNotice } from "./enable-feedback";
import type { ConfigurationValue } from "../../../modules/sdk/configuration";
import type { Runtime } from "../../shell/runtime";
import { errorMessage, stateMessage } from "../../shell/messages";
import { useExtensionState } from "../../shell/useExtensionState";
import type { ManagementInputs, ExtensionCardModel } from "./controllers";

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
  const [selectedId, setSelectedId] = useState(
    () => catalog.find((entry) => host.ids().includes(entry.id))?.id ?? "",
  );
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [failedImports, setFailedImports] = useState(
    runtime.initial.failedImports,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const removed = useRef(false);
  useEffect(() => {
    if (!manager.open) return;
    const target = manager.targetId;
    if (target) setSelectedId(target);
    heading.current?.focus();
    if (target)
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-extension-id="${CSS.escape(target)}"]`)
          ?.scrollIntoView({ block: "nearest" }),
      );
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
        setError(`扩展启用状态未保存：${errorMessage(reason)}`),
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
  const selected =
    installed.find((entry) => entry.id === selectedId) ?? installed[0];
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
  const rows: ExtensionCardModel[] = installed.map((entry) => ({
    entry,
    manifest: host.manifest(entry.id),
    state: host.inspect(entry.id),
    users: host.users(entry.id),
    selected: selected?.id === entry.id,
    imported: value.imports.some((item) => item.id === entry.id),
  }));
  return {
    failedImports,
    visible: manager.open,
    header: {
      heading,
      count: catalog.length,
      close: closeManager,
      install: (source: HTMLElement) => setDialog({ kind: "install", source }),
    },
    list: {
      rows,
      failures: failedImports,
      installed: host.ids(),
      busy,
      adapter: runtime.adapter,
      actions: {
        select: setSelectedId,
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
                sources: runtime.sources,
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
                runtime.sources,
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
    },
    dialogs: {
      dialog,
      close,
      label: (id: string) =>
        catalog.find((entry) => entry.id === id)?.label ?? id,
      install: (id: string, url: string) =>
        operate(async () => {
          await run((draft) =>
            installExtension(host, draft, {
              id,
              url,
              baseUrl: location.href,
            }),
          );
          clearFailure(id);
          close();
          setNotice(
            "模块路径已保存。请检查来源与能力，再启用扩展；下次启动会重新加载模块。",
          );
        }),
      /** Runs the file's code to read its manifest; nothing is saved yet. */
      preview: async (file: Blob) => {
        let preview: ImportPreview | undefined;
        await operate(async () => {
          const read = await readExtensionFile(file);
          const definition = await loadExtensionSource(read.source);
          const id = definition.manifest.id;
          const replacing = value.imports.some((entry) => entry.id === id);
          if (!replacing && host.ids().includes(id))
            throw Error("此 ID 属于内置扩展，不能用导入的文件替换。");
          preview = { file: read, definition, replacing };
        });
        return preview;
      },
      importFile: ({ file, definition }: ImportPreview) =>
        operate(async () => {
          const { entry, replaced } = await run((draft) =>
            importExtensionFile(
              host,
              draft,
              file,
              definition,
              runtime.sources,
              prepareUninstall,
            ),
          );
          clearFailure(entry.id);
          setSelectedId(entry.id);
          close();
          setNotice(
            replaced
              ? "已替换为新版本。请重新启用并确认权限；如有连接，需重新录入 API Key。扩展数据已保留。"
              : "扩展已导入。请检查来源与能力，再启用扩展。",
          );
        }),
      stop: (id: string) =>
        operate(async () => {
          await host.stop(id);
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
              runtime.sources,
            ),
          );
          removed.current = true;
          close();
          setNotice("扩展已卸载，已保存的数据和模块文件已保留。");
        }),
      configure: (id: string, values: Record<string, ConfigurationValue>) =>
        operate(async () => {
          await run((draft) => configureExtension(host, draft, id, values));
          close();
          setNotice("配置已保存并应用；未启用的扩展保持停用。");
        }),
    },
  };
}
