import { FoundationManager } from "../components/FoundationManager.js";
import { useEffect, useState, useRef } from "react";
import type { ComponentSource, AgentRecord } from "@plumsjs/host";
import type { Resource, CatalogItem, AssemblyDraft } from "../shared/types.js";
import {
  ImportPreview,
  type ImportPreviewData as Preview,
} from "../dialogs/ImportPreview.js";
import { AgentSetup } from "../dialogs/AgentSetup.js";
import { missingRequiredSettings } from "@plumsjs/sdk/settings";
import { AssemblyEditor } from "../dialogs/AssemblyEditor.js";
import { ComponentContentDialog } from "../dialogs/ComponentContentDialog.js";
import { ComponentConfigDialog } from "../dialogs/ComponentConfigDialog.js";
import { AgentsView } from "../views/AgentsView.js";
import { AgentDetailView } from "../views/AgentDetailView.js";
import { SettingsView } from "../views/SettingsView.js";
import { DropOverlay } from "../components/DropOverlay.js";
import { RunningBar } from "../components/RunningBar.js";
import { ConfirmDialog } from "../dialogs/ConfirmDialog.js";
import { InvocationDialog } from "../dialogs/InvocationDialog.js";
import { ManagedDialog } from "../managed-dialog.js";
import { useDeveloperMode } from "../hooks/useDeveloperMode.js";
import { TopNav } from "../components/TopNav.js";
import { ExecutionRecordList } from "../components/ExecutionRecordList.js";
import { Icon } from "../components/Icon.js";
import { Skeleton } from "../components/Skeleton.js";
import { useAction } from "../hooks/useAction.js";
import { useFileDrop } from "../hooks/useFileDrop.js";
import { EmptyState } from "../components/EmptyState.js";
import { useManagerStore } from "../state/ManagerStore.js";
import { ComponentsView } from "../views/ComponentsView.js";
import { componentTab } from "./route.js";
export function App() {
  const { state, load, setTab, setTheme } = useManagerStore();
  const {
    agents,
    library,
    resources,
    record,
    dnsMode,
    theme,
    route,
    loading,
    initialized,
    loadError,
    statuses,
    runtime,
  } = state;
  const tab = route.tab,
    selected = route.agentId ?? "";
  const [preview, setPreview] = useState<Preview>(),
    [editing, setEditing] = useState<Resource>(),
    [audit, setAudit] = useState<unknown[] | null>(null),
    [showAudit, setShowAudit] = useState(false),
    [auditError, setAuditError] = useState(""),
    [output, setOutput] = useState<unknown>(),
    [invocation, setInvocation] = useState<{
      packageId: string;
      kind: string;
      name: string;
      title: string;
    }>();
  const [assembling, setAssembling] = useState<"new" | string>(),
    [setup, setSetup] = useState<string>(),
    [assemblySeed, setAssemblySeed] = useState<AssemblyDraft>();
  const [contentSource, setContentSource] = useState<ComponentSource>();
  const [developer, setDeveloper] = useDeveloperMode();
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    actionLabel: string;
    run: () => Promise<unknown>;
    finish?: () => void;
  }>();
  const importAction = useAction();
  const configAction = useAction(editing?.id ?? "");
  const setupAction = useAction(setup ?? "");
  const assemblyAction = useAction(assembling ?? "");
  const confirmationAction = useAction();
  const invocationAction = useAction(
    `${selected}:${invocation?.packageId ?? ""}`,
  );
  const runtimeAction = useAction();
  const dnsAction = useAction();
  const themeAction = useAction();
  const auditAction = useAction(selected);
  const selectedRef = useRef({ id: selected });
  if (selectedRef.current.id !== selected)
    selectedRef.current = { id: selected };
  const routeRef = useRef({ key: `${tab}:${selected}` });
  if (routeRef.current.key !== `${tab}:${selected}`)
    routeRef.current = { key: `${tab}:${selected}` };
  const modalOpen =
    (!!setup && record?.instanceId === setup) ||
    !!assembling ||
    !!preview ||
    !!editing ||
    !!invocation ||
    !!confirmation ||
    !!showAudit ||
    !!contentSource;
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const { dragging, handlers: dropHandlers } = useFileDrop(
    (file) => void importFile(file),
    importAction.pending || modalOpen,
  );
  const pageError =
    runtimeAction.error ||
    dnsAction.error ||
    auditAction.error ||
    (!preview && !assembling ? importAction.error : "");
  useEffect(() => {
    let current = true;
    let received = false;
    const apply = ({ fullscreen }: { fullscreen: boolean }) => {
      document.documentElement.toggleAttribute("data-fullscreen", fullscreen);
    };
    const unsubscribe = window.manager.onWindowState((state) => {
      received = true;
      apply(state);
    });
    void window.manager
      .call("windowState")
      .then((state) => {
        if (current && !received) apply(state as { fullscreen: boolean });
      })
      .catch(() => {});
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2400);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setSearch("");
  }, [tab]);
  useEffect(() => {
    setAudit(null);
    setAuditError("");
    if (tab !== "status" || !selected) return;
    let current = true;
    void window.manager
      .call("audit", { instanceId: selected })
      .then((events) => {
        if (current) setAudit(events as unknown[]);
      })
      .catch(() => {
        if (current) setAuditError("执行记录未能读取，请重试。");
      });
    return () => {
      current = false;
    };
  }, [tab, selected, resources]);
  const resumeAssembly = useRef<string | undefined>(undefined);
  const importPreviewRef = useRef<Preview | undefined>(undefined);
  useEffect(() => {
    const selecting = window.manager.onSelect((id) => {
      if (!modalOpenRef.current) void openDetail(id);
    });
    const imported = window.manager.onImport((value) => {
      importPreviewRef.current = value as Preview;
      setPreview(value as Preview);
    });
    return () => {
      selecting();
      imported();
    };
  }, [load, setTab]);
  async function importFile(file?: File) {
    await importAction.run(async () => {
      const value = file
        ? await window.manager.call("preview", {
            path: window.manager.filePath(file),
          })
        : await window.manager.call("chooseImport");
      if (value) {
        importPreviewRef.current = value as Preview;
        setPreview(value as Preview);
      }
    });
  }
  async function addSelectedComponent(id: string, digest: string) {
    const current = (await window.manager.call("resources", {
      instanceId: id,
    })) as { record: AgentRecord };
    const existing = current.record.components?.map((p) => p.digest) ?? [];
    const plan = (await window.manager.call("planAssembly", {
      digests: [...existing, digest],
    })) as { digests: string[] };
    for (const next of plan.digests)
      if (!existing.includes(next))
        await window.manager.call("addLibraryComponent", {
          instanceId: id,
          digest: next,
        });
  }
  async function openDetail(id: string) {
    setAudit(null);
    setOutput(undefined);
    await load(id)
      .then((detail) => {
        if (detail) setTab("status");
      })
      .catch(() => {});
  }
  async function prepareAgent(id: string) {
    if (runtime?.instanceId === id) {
      await runtimeAction.run(() => window.manager.call("showAgent"), false);
      return;
    }
    await runtimeAction.run(async () => {
      const detail = await load(id);
      if (!detail) return;
      setTab("status");
      if (
        detail.packages.every(
          (p) =>
            p.enabled &&
            !p.needsApproval &&
            !missingRequiredSettings(p.settings).length,
        )
      )
        await window.manager.call("openAgent", { instanceId: id });
      else setSetup(id);
    });
  }
  async function startAgent(id: string) {
    await setupAction.run(async () => {
      const outcome = (await window.manager.call("startAgent", {
        instanceId: id,
      })) as { opened?: boolean; needsSetup?: boolean; cancelled?: boolean };
      if (outcome.opened || (!outcome.cancelled && !outcome.needsSetup))
        setSetup(undefined);
    });
  }
  async function chooseAgent(id: string) {
    setAudit(null);
    setOutput(undefined);
    await load(id).catch(() => {});
  }
  const args = (packageId?: string) => ({
    instanceId: selected,
    ...(packageId ? { packageId } : {}),
  });
  function openConfig(resource: Resource) {
    configAction.clear();
    setEditing(resource);
  }
  function requestRemoval(
    method: string,
    payload: Record<string, unknown>,
    name: string,
  ): Promise<void> {
    confirmationAction.clear();
    return new Promise((finish) =>
      setConfirmation({
        title:
          method === "disable"
            ? `停用「${name}」？`
            : method === "unbindRoot"
              ? `解除「${name}」的目录绑定？`
              : method === "remove"
                ? `删除「${name}」？`
                : method === "uninstall"
                  ? `从 Agent 移出「${name}」？`
                  : `删除公共库组件「${name}」？`,
        description:
          method === "disable"
            ? "相关运行会停止。配置与数据保留，可以再次启用。"
            : method === "unbindRoot"
              ? "相关运行会停止，组件将无法访问此目录。目录内的文件会保留。"
              : method === "remove"
                ? "此 Agent 的设置、密钥和运行数据将永久删除。公共库中的组件会保留。"
                : method === "uninstall"
                  ? "组件的设置与密钥将一并删除，相关运行会停止。公共库中的原件仍然保留。"
                  : "此组件将从公共库永久删除。被 Agent 引用的组件不能删除。",
        actionLabel:
          method === "disable"
            ? "停用"
            : method === "unbindRoot"
              ? "解除绑定"
              : method === "uninstall"
                ? "移出"
                : "删除",
        run: async () => {
          await window.manager.call(method, payload);
          if (method === "remove" && payload.instanceId === selected)
            setTab("home");
        },
        finish,
      }),
    );
  }
  function componentAction(
    method: string,
    p?: Resource,
    extra: Record<string, unknown> = {},
  ) {
    const payload = { ...args(p?.id), ...extra };
    if (["remove", "uninstall", "disable", "unbindRoot"].includes(method)) {
      return requestRemoval(
        method,
        payload,
        p?.name ?? record?.name ?? "Agent",
      );
    }
    return window.manager.call(method, payload);
  }
  function invoke(
    p: Resource,
    kind: string,
    item: { name: string; title: string; inputSchema?: unknown },
  ) {
    invocationAction.clear();
    const owner = selectedRef.current;
    if (item.inputSchema) {
      setInvocation({
        packageId: p.id,
        kind,
        name: item.name,
        title: item.title,
      });
    } else
      return window.manager
        .call("invoke", {
          ...args(p.id),
          kind,
          name: item.name,
          input: {},
        })
        .then((value) => {
          if (selectedRef.current === owner) setOutput(value);
        });
  }
  async function readAudit() {
    const owner = routeRef.current;
    await auditAction.run(async () => {
      const events = await window.manager.call("audit", args());
      if (routeRef.current !== owner) return;
      setAudit(events as unknown[]);
      setShowAudit(true);
    }, false);
  }
  return (
    <div className="app" {...dropHandlers}>
      {runtime?.visible && (
        <RunningBar
          runtime={runtime}
          busy={runtimeAction.pending}
          onReturn={() =>
            void runtimeAction.run(
              () => window.manager.call("hideAgent"),
              false,
            )
          }
          onStop={() =>
            void runtimeAction.run(() => window.manager.call("stopAgent"))
          }
        />
      )}
      <div
        className={runtime?.visible ? "manager-hidden" : "manager-content"}
        inert={runtime?.visible}
      >
        <TopNav
          tab={tab}
          agents={agents}
          selected={selected}
          busy={importAction.pending}
          primaryImport={!["home", "status"].includes(tab)}
          runtime={runtime}
          runtimeBusy={runtimeAction.pending}
          onResume={() =>
            void runtimeAction.run(
              () => window.manager.call("showAgent"),
              false,
            )
          }
          inert={modalOpen}
          onTab={(key) => {
            setTab(key);
            setAudit(null);
          }}
          onAgent={(id) => void chooseAgent(id)}
          onImport={() => void importFile()}
        />
        <main inert={modalOpen} aria-busy={loading}>
          <div
            id="manager-scroll-sentinel"
            className="scroll-sentinel"
            aria-hidden="true"
          />
          {pageError && (
            <div role="alert" className="notice error">
              {pageError}
            </div>
          )}
          {initialized && loadError && (
            <div role="alert" className="notice error">
              <span>{loadError}</span>
              <button onClick={() => void load().catch(() => {})}>
                重新加载
              </button>
            </div>
          )}
          {tab === "settings" && (
            <FoundationManager onImport={() => void importFile()} />
          )}
          {tab === "status" && selected && (
            <FoundationManager
              key={selected}
              instanceId={selected}
              onImport={() => void importFile()}
            />
          )}
          {!initialized ? (
            loading ? (
              <Skeleton />
            ) : (
              <EmptyState
                illustration="error"
                title="工作台未能加载"
                description={loadError}
                action={
                  <button onClick={() => void load().catch(() => {})}>
                    重新加载
                  </button>
                }
              />
            )
          ) : tab === "status" && loading && !record ? (
            <Skeleton />
          ) : tab === "status" ? (
            <AgentDetailView
              record={record}
              resources={resources}
              status={statuses[selected]}
              busy={runtimeAction.pending}
              library={library}
              developer={developer}
              audit={audit}
              auditError={auditError}
              output={output}
              onBack={() => setTab("home")}
              onStart={() => void prepareAgent(selected)}
              onEdit={() => setAssembling(selected)}
              onInspect={(p) =>
                setContentSource({
                  kind: "agent",
                  instanceId: selected,
                  packageId: p.id,
                })
              }
              onConfig={openConfig}
              onAction={componentAction}
              onInvoke={invoke}
              onAudit={() => void readAudit()}
              onBind={(name) =>
                window.manager.call("chooseRoot", {
                  instanceId: selected,
                  name,
                })
              }
              onUnbind={(name) =>
                requestRemoval(
                  "unbindRoot",
                  { instanceId: selected, name },
                  name,
                )
              }
            />
          ) : tab === "home" ? (
            <AgentsView
              agents={agents}
              statuses={statuses}
              selected={selected}
              busy={runtimeAction.pending}
              importing={importAction.pending}
              onImport={() => void importFile()}
              onCreate={() => {
                setAssemblySeed(undefined);
                setAssembling("new");
              }}
              onOpen={(id) => void openDetail(id)}
              onStart={(id) => void prepareAgent(id)}
            />
          ) : tab === "settings" ? (
            <SettingsView
              dnsMode={dnsMode}
              theme={theme}
              themeBusy={themeAction.pending}
              themeError={themeAction.error}
              onTheme={(theme) =>
                void themeAction.run(async () => {
                  await window.manager.call("setDesktopTheme", { theme });
                  setTheme(theme);
                }, false)
              }
              busy={dnsAction.pending}
              developer={developer}
              onDeveloper={setDeveloper}
              onDns={(dnsMode) =>
                void dnsAction.run(() =>
                  window.manager.call("setDesktopSettings", { dnsMode }),
                )
              }
            />
          ) : (
            <ComponentsView
              kind={tab}
              search={search}
              onSearch={setSearch}
              selected={selected}
              record={record}
              library={library}
              agents={agents}
              developer={developer}
              loading={loading}
              output={output}
              onInspect={(p) =>
                setContentSource({ kind: "library", digest: p.digest })
              }
              onOpen={(id) => void openDetail(id)}
              onUse={async (item) => {
                const owner = selectedRef.current;
                if (!record) {
                  setAssemblySeed({ name: "", digests: [item.digest] });
                  setAssembling("new");
                } else if (
                  record.components?.some(
                    (p) => p.packageId === item.manifest.id,
                  )
                )
                  await openDetail(selected);
                else {
                  await addSelectedComponent(selected, item.digest);
                  if (selectedRef.current === owner) {
                    await openDetail(selected);
                    setToast("组件已加入");
                  }
                }
              }}
              onRemove={(digest) =>
                requestRemoval(
                  "removeLibrary",
                  { digest },
                  library.find((p) => p.digest === digest)?.manifest.name ??
                    "组件",
                )
              }
              onExport={(digest) =>
                window.manager.call("exportLibrary", { digest })
              }
            />
          )}
          <p className="local-hint">
            组件在已批准的任务范围内运行，未覆盖的操作需再次确认。
          </p>
        </main>
      </div>
      <div inert={!!confirmation}>
        {setup && record?.instanceId === setup && (
          <AgentSetup
            key={setup}
            record={record}
            resources={resources}
            busy={setupAction.pending}
            error={setupAction.error}
            onClose={() => {
              setSetup(undefined);
              setupAction.clear();
            }}
            onEdit={() => {
              setSetup(undefined);
              setAssembling(selected);
            }}
            onStart={() => startAgent(setup)}
            onSave={async (packageId, values, secrets) => {
              const ok = await setupAction.run(() =>
                window.manager.call("settings", {
                  instanceId: setup,
                  packageId,
                  values,
                  secrets,
                }),
              );
              if (!ok) throw Error("保存未完成");
            }}
          />
        )}
        {assembling && (
          <AssemblyEditor
            record={assembling === "new" ? undefined : record}
            resources={resources}
            seed={assemblySeed}
            library={library}
            key={assembling}
            busy={assemblyAction.pending || importAction.pending}
            error={assemblyAction.error || importAction.error || loadError}
            onReload={loadError ? () => void load().catch(() => {}) : undefined}
            onImport={(draft) => {
              setAssemblySeed(draft);
              resumeAssembly.current = assembling;
              setAssembling(undefined);
              void importFile().then(() => {
                if (!importPreviewRef.current && resumeAssembly.current) {
                  setAssembling(resumeAssembly.current);
                  resumeAssembly.current = undefined;
                }
              });
            }}
            onClose={() => setAssembling(undefined)}
            onSave={async (
              name,
              digests,
              characterId,
              startup,
              protocolBindings,
              foundation,
            ) => {
              const ok = await assemblyAction.run(async () => {
                if (assembling === "new") {
                  const created = (await window.manager.call("createAgent", {
                    name,
                    digests,
                    characterId,
                    startup,
                    protocolBindings,
                    foundation,
                  })) as AgentRecord;
                  await load(created.instanceId).catch(() => {});
                  setTab("status");
                  setSetup(created.instanceId);
                } else
                  await window.manager.call("editAgent", {
                    instanceId: assembling,
                    name,
                    characterId,
                    startup,
                  });
                if (assembling === "new") setAssembling(undefined);
              });
              return ok;
            }}
            onAdd={async (digest) => {
              return assemblyAction.run(() =>
                addSelectedComponent(assembling, digest),
              );
            }}
            onRemove={(packageId) =>
              requestRemoval(
                "uninstall",
                { instanceId: assembling, packageId },
                resources.find((p) => p.id === packageId)?.name ?? "组件",
              )
            }
            onUpdate={async (packageId, digest) => {
              return assemblyAction.run(() =>
                window.manager.call("updateFromLibrary", {
                  instanceId: assembling,
                  packageId,
                  digest,
                }),
              );
            }}
          />
        )}
        {preview && (
          <ImportPreview
            key={preview.token}
            preview={preview}
            busy={importAction.pending}
            error={importAction.error}
            onClose={() => {
              importAction.clear();
              setPreview(undefined);
              importPreviewRef.current = undefined;
              if (resumeAssembly.current) {
                setAssembling(resumeAssembly.current);
                resumeAssembly.current = undefined;
              }
            }}
            onImport={(mode) => {
              void importAction.run(async () => {
                if (mode === "ready") {
                  const installed = (await window.manager.call("install", {
                    token: preview.token,
                  })) as AgentRecord;
                  await load(installed.instanceId).catch(() => {});
                  setTab("status");
                  setSetup(installed.instanceId);
                } else if (mode === "assemble") {
                  const items = (await window.manager.call(
                    "importBundleComponents",
                    { token: preview.token },
                  )) as CatalogItem[];
                  await load().catch(() => {});
                  setAssemblySeed({
                    name: preview.agent?.name ?? "",
                    foundation: preview.agent?.foundation,
                    digests: items.map((p) => p.digest),
                    characterId: items.find(
                      (p) =>
                        p.manifest.kind === "character" &&
                        preview.agent?.character,
                    )?.manifest.id,
                    startup: preview.agent?.startup,
                  });
                  setAssembling("new");
                } else {
                  await window.manager.call("importLibrary", {
                    token: preview.token,
                  });
                  setTab(
                    preview.type === "foundation"
                      ? "settings"
                      : componentTab(preview.components[0]!.kind),
                  );

                  if (resumeAssembly.current) {
                    setAssembling(resumeAssembly.current);
                    resumeAssembly.current = undefined;
                  }
                }
                setPreview(undefined);
                setToast("文件已导入");
                importPreviewRef.current = undefined;
              });
            }}
          />
        )}
        {invocation && (
          <InvocationDialog
            title={invocation.title}
            operationError={invocationAction.error}
            busy={invocationAction.pending}
            onClose={() => setInvocation(undefined)}
            onRun={(input) => {
              void invocationAction.run(async () => {
                setOutput(
                  await window.manager.call("invoke", {
                    ...args(invocation.packageId),
                    kind: invocation.kind,
                    name: invocation.name,
                    input,
                  }),
                );
                setInvocation(undefined);
              });
            }}
          />
        )}
        {contentSource && developer && (
          <ComponentContentDialog
            source={contentSource}
            onClose={() => setContentSource(undefined)}
            onSaved={() => {
              void load().catch(() => {});
            }}
          />
        )}
        {editing && (
          <ComponentConfigDialog
            resource={editing}
            error={configAction.error}
            busy={configAction.pending}
            onClose={() => setEditing(undefined)}
            onSave={(values, secrets) => {
              void configAction.run(async () => {
                await window.manager.call("settings", {
                  ...args(editing.id),
                  values,
                  secrets,
                });
                setEditing(undefined);
                setToast("配置已保存");
              });
            }}
          />
        )}
      </div>
      {showAudit && (
        <ManagedDialog
          title="执行记录"
          label="执行记录"
          busy={auditAction.pending}
          onClose={() => setShowAudit(false)}
        >
          <ExecutionRecordList
            events={audit}
            resources={resources}
            limit={Infinity}
          />
        </ManagedDialog>
      )}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          actionLabel={confirmation.actionLabel}
          error={confirmationAction.error}
          description={confirmation.description}
          busy={confirmationAction.pending}
          onCancel={() => {
            confirmation.finish?.();
            setConfirmation(undefined);
          }}
          onConfirm={() =>
            void confirmationAction.run(confirmation.run).then((ok) => {
              if (ok) {
                confirmation.finish?.();
                setConfirmation(undefined);
                setToast("操作已完成");
              }
            })
          }
        />
      )}
      {dragging && <DropOverlay />}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
