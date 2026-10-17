import { useEffect, useRef, useState } from "react";
import {
  installExtension,
  retryImport,
  removeFailedImport,
  uninstallExtension,
  saveComposition,
  configureExtension,
} from "../../../modules/shell/extension-actions";
import {
  mapExtensionAgents,
  readActiveAgents,
} from "../../../modules/shell/diagnostics";
import { waitingNotice } from "./enable-feedback";
import type { ConfigurationValue } from "../../../modules/sdk/configuration";
import type { Runtime } from "../../shell/runtime";
import { errorMessage } from "../../shell/messages";
import { useExtensionState } from "../../shell/useExtensionState";
import type {
  ManagementInputs,
  ExtensionCardModel,
} from "../../shell/controllers";

type ManagementDialog =
  | { kind: "install"; source: HTMLElement }
  | { kind: "configure" | "uninstall"; id: string; source: HTMLElement }
  | null;

export function useExtensionManager(
  runtime: Runtime,
  {
    operations,
    workspace,
    theme,
    navigation,
    authorization,
    onReveal,
  }: ManagementInputs,
) {
  const { host, catalog } = runtime;
  const { value, run } = useExtensionState(runtime);
  const { manager, closeManager } = navigation;
  const { busy, operate, setError, setNotice } = operations;
  const [selectedId, setSelectedId] = useState(
    () =>
      catalog.find((entry) => host.ids().includes(entry.id))?.id ??
      "agents.local",
  );
  const [dialog, setDialog] = useState<ManagementDialog>(null);
  const [failedImports, setFailedImports] = useState(
    runtime.initial.failedImports,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const removed = useRef(false);
  useEffect(() => {
    if (manager.open) {
      if (manager.targetId) setSelectedId(manager.targetId);
      heading.current?.focus();
    }
  }, [manager.open, manager.targetId]);
  useEffect(() => {
    if (!dialog && removed.current) {
      removed.current = false;
      heading.current?.focus();
    }
  }, [dialog]);
  const installed = catalog.filter((entry) => host.ids().includes(entry.id));
  const selected =
    installed.find((entry) => entry.id === selectedId) ?? installed[0];
  const { agents: providerAgents, error: agentsError } = readActiveAgents(host);
  const agents = mapExtensionAgents(host, providerAgents);
  const reportedAgentsError = useRef<string | null>(null);
  useEffect(() => {
    if (!agentsError) {
      reportedAgentsError.current = null;
      return;
    }
    if (reportedAgentsError.current) return;
    reportedAgentsError.current = agentsError;
    setNotice(`Agent 提供者读取失败：${agentsError}`);
  }, [agentsError, setNotice]);
  const reportNotRunning = (id: string) => {
    const info = host.inspect(id);
    const notice = waitingNotice(
      info.status,
      info.error ? errorMessage(info.error) : undefined,
    );
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
    kind: "configure" | "uninstall",
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
    agents: agents[entry.id] ?? [],
    selected: selected?.id === entry.id,
    imported: value.imports.some((item) => item.id === entry.id),
  }));
  return {
    failedImports,
    visible: manager.open,
    header: {
      heading,
      count: catalog.length,
      busy,
      close: closeManager,
      install: (source: HTMLElement) => setDialog({ kind: "install", source }),
      save: () =>
        operate(async () => {
          await run((draft) =>
            saveComposition(host, draft, {
              layout: workspace.selected,
              theme,
            }),
          );
          setNotice("当前组合已保存，下次启动自动恢复；所需权限须重新确认。");
        }),
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
          row: Pick<ExtensionCardModel, "entry" | "manifest" | "state">,
          source: HTMLElement,
        ) => {
          const id = row.entry.id;
          const capabilities = row.manifest.capabilities ?? [];
          if (row.state.status === "active") void operate(() => host.stop(id));
          else if (capabilities.length)
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
              retryImport(host, draft, id, location.href, Date.now()),
            );
            clearFailure(id);
          }),
        removeFailure: (id: string) =>
          operate(async () => {
            await run((draft) =>
              removeFailedImport(host, draft, id, prepareUninstall),
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
      agents: selected ? (agents[selected.id] ?? []) : [],
      onReveal: onReveal
        ? (id: string) => {
            onReveal(id);
            closeManager();
          }
        : undefined,
    },
    dialogs: {
      dialog,
      close,
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
      uninstall: (id: string) =>
        operate(async () => {
          await run((draft) =>
            uninstallExtension(host, draft, id, prepareUninstall),
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
