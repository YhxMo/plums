import { useEffect, useRef, useState } from "react";
import type {
  ComponentSource,
  ComponentInspection,
  ComponentDraft,
} from "@plumsjs/host";
import { ManagedDialog } from "../managed-dialog.js";

type JsonTab = "manifest" | "payload";
type Tab = JsonTab | "files";
function pretty(value: unknown) {
  return JSON.stringify(value, null, 2) ?? "null";
}
function object(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error("JSON 格式无效，请修正后再继续。");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Manifest 必须是 JSON 对象。");
  return value as Record<string, unknown>;
}
function message(error: unknown) {
  const e = error as { message?: string; path?: string };
  return `${e?.message ?? "操作未完成，请重试。"}${e?.path ? `（${e.path}）` : ""}`;
}
export function ComponentContentDialog({
  source,
  onClose,
  onSaved,
}: {
  source: ComponentSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [inspection, setInspection] = useState<ComponentInspection>();
  const [draft, setDraft] = useState<ComponentDraft>();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("manifest");
  const [jsonTab, setJsonTab] = useState<JsonTab>("manifest");
  const [manifestText, setManifestText] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retentionError, setRetentionError] = useState("");
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<ComponentDraft>();
  const [closing, setClosing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const jsonEditor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (jsonEditor.current) {
      jsonEditor.current.scrollTop = 0;
      jsonEditor.current.scrollLeft = 0;
    }
  }, [tab, viewRevision]);
  useEffect(() => {
    let current = true;
    setBusy(true);
    void window.manager
      .call("inspectComponent", { source })
      .then((value) => {
        if (!current) return;
        const view = value as ComponentInspection;
        setInspection(view);
        setManifestText(view.manifestText);
        setPayloadText(pretty(object(view.manifestText).payload));
        setError("");
      })
      .catch((e) => {
        if (current) setError(message(e));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [source, reload]);
  useEffect(() => {
    if (!draft || !editing || saved || busy) return;
    let current = true;
    const timer = setTimeout(() => {
      void window.manager
        .call("retainComponentDraft", {
          token: draft.token,
          editor: {
            manifestText,
            payloadText,
            tab: jsonTab,
            revision: draft.revision,
          },
        })
        .then(() => {
          if (current) setRetentionError("");
        })
        .catch((e) => {
          if (current) setRetentionError(`本地草稿未能保存：${message(e)}`);
        });
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [draft, editing, saved, busy, manifestText, payloadText, jsonTab]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function manifest() {
    const value = object(manifestText);
    if (jsonTab === "payload") {
      try {
        value.payload = JSON.parse(payloadText);
      } catch {
        throw Error("Payload JSON 格式无效，请修正后再继续。");
      }
    }
    return value;
  }
  function useView(view: ComponentDraft, restore = false) {
    const text =
      restore && view.editor ? view.editor.manifestText : view.manifestText;
    setDraft(
      restore && view.editor
        ? { ...view, revision: view.editor.revision }
        : view,
    );
    setManifestText(text);
    setViewRevision((v) => v + 1);
    try {
      setPayloadText(
        restore && view.editor
          ? view.editor.payloadText
          : pretty(object(text).payload),
      );
    } catch {
      setPayloadText(restore && view.editor ? view.editor.payloadText : "null");
    }
    const next =
      restore && view.editor?.tab === "payload" ? "payload" : "manifest";
    if (restore) {
      setJsonTab(next);
      setTab(next);
    }
  }
  async function start() {
    const view = (await window.manager.call("openComponentDraft", {
      source,
    })) as ComponentDraft;
    useView(view, true);
    setEditing(true);
    if (!view.editor) {
      try {
        const value = object(view.manifestText);
        if (value.version === object(inspection!.manifestText).version) {
          value.version = view.suggestedVersion;
          setManifestText(pretty(value));
        }
      } catch {
        /* Keep an externally edited, invalid manifest available for repair. */
      }
    } else {
      setStatus("已恢复本地草稿。");
      if (view.editor.revision !== view.revision) setConflict(view);
    }
    if (view.baseDigest !== inspection!.baseDigest)
      setStatus("此草稿基于旧制品。内容已保留，保存前需要重新打开当前版本。");
    return view;
  }
  function changeTab(next: Tab) {
    setError("");
    if (next !== "files") {
      try {
        const value = manifest();
        setManifestText(pretty(value));
        setPayloadText(pretty(value.payload));
        setJsonTab(next);
      } catch (e) {
        setError(message(e));
        return;
      }
    }
    setTab(next);
  }
  async function retain() {
    if (draft)
      await window.manager.call("retainComponentDraft", {
        token: draft.token,
        editor: {
          manifestText,
          payloadText,
          tab: jsonTab,
          revision: draft.revision,
        },
      });
  }
  async function sync() {
    if (!draft) throw Error("请先创建编辑草稿。");
    const text = pretty(manifest());
    await retain();
    try {
      const view = (await window.manager.call("writeComponentDraft", {
        token: draft.token,
        text,
        revision: draft.revision,
      })) as ComponentDraft;
      useView(view);
      return view;
    } catch (e) {
      if (
        (e as { details?: { reason?: string } }).details?.reason ===
        "DRAFT_CONFLICT"
      ) {
        setConflict(
          (await window.manager.call("readComponentDraft", {
            token: draft.token,
          })) as ComponentDraft,
        );
      }
      throw e;
    }
  }
  async function reread() {
    if (!draft) return;
    const external = (await window.manager.call("readComponentDraft", {
      token: draft.token,
    })) as ComponentDraft;
    // Compare semantic JSON where possible; formatting alone does not discard edits.
    let local = manifestText;
    try {
      local = pretty(manifest());
    } catch {
      /* Preserve invalid local input as a conflict. */
    }
    let previous = draft.manifestText;
    try {
      previous = pretty(object(previous));
    } catch {}
    if (local !== previous && external.revision !== draft.revision) {
      await retain();
      setConflict(external);
      setStatus("JSON 编辑与外部文件修改同时存在，请选择采用哪份内容。");
    } else if (local !== previous) {
      setDraft(external);
      setStatus("已重新读取文件目录，JSON 编辑已保留。");
    } else {
      useView(external);
      setStatus("已重新读取工作副本。");
    }
  }
  async function reveal(relative?: string) {
    const view = draft ?? (await start());
    if (draft && !saved) await sync();
    await window.manager.call("revealComponentDraft", {
      token: view.token,
      relative,
    });
    setStatus("已定位工作副本。外部修改后点击“重新读取”。");
  }
  async function validate(save: boolean) {
    const view = await sync();
    const result = (await window.manager.call("validateComponentDraft", {
      token: view.token,
    })) as { validationToken: string };
    if (!save) {
      setStatus("包格式、声明、入口和组合校验通过。保存时会重新校验。");
      return;
    }
    const outcome = (await window.manager.call("saveComponentDraft", {
      token: view.token,
      validationToken: result.validationToken,
    })) as {
      cancelled?: boolean;
      librarySaved: boolean;
      applied: boolean;
      error?: unknown;
    };
    if (outcome.cancelled) {
      setStatus("已取消更新，草稿已保留。");
      return;
    }
    if (outcome.librarySaved) onSaved();
    if (outcome.error) {
      setStatus(
        outcome.applied
          ? "新版本已入公共库并应用到当前 Agent。"
          : "新版本已入公共库，当前 Agent 更新未完成，可重试更新。",
      );
      if (outcome.applied) setSaved(true);
      setError(message(outcome.error));
      return;
    }
    setSaved(true);
    setStatus(
      outcome.applied
        ? "新版本已入公共库并应用到当前 Agent。"
        : "新版本已保存到公共库。",
    );
  }
  function close() {
    if (draft && !saved) setClosing(true);
    else onClose();
  }
  const files = draft?.files ?? inspection?.files ?? [];
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++)
      directories.add(parts.slice(0, i).join("/"));
  }
  const entries = [
    ...files,
    ...[...directories].map((path) => ({ path, size: -1 })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  let name = "组件";
  try {
    name = String(object(inspection?.manifestText ?? "{}").name ?? "组件");
  } catch {}
  return (
    <ManagedDialog
      label={`${name} · 内容`}
      title={`${name} · 查看 / 编辑内容`}
      className="component-content-dialog"
      size="lg"
      testId="component-content-dialog"
      busy={busy}
      error={error || retentionError}
      onClose={close}
      footer={
        <div className="modal-actions">
          {closing ? (
            <>
              <span>关闭前如何处理工作副本？</span>
              <button disabled={busy} onClick={() => setClosing(false)}>
                继续编辑
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await retain();
                    onClose();
                  })
                }
              >
                保留草稿并关闭
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await window.manager.call("discardComponentDraft", {
                      token: draft!.token,
                    });
                    onClose();
                  })
                }
              >
                丢弃草稿
              </button>
            </>
          ) : (
            <>
              <button disabled={busy} onClick={close}>
                关闭
              </button>
              {!inspection && (
                <button disabled={busy} onClick={() => setReload((v) => v + 1)}>
                  重试读取
                </button>
              )}
              {inspection && !editing && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await start();
                    })
                  }
                >
                  编辑
                </button>
              )}
              {editing && !saved && (
                <>
                  <button
                    disabled={busy || !!conflict}
                    onClick={() => void run(() => validate(false))}
                  >
                    校验
                  </button>
                  <button
                    className="primary"
                    disabled={busy || !!conflict}
                    onClick={() => void run(() => validate(true))}
                  >
                    {source.kind === "agent"
                      ? "保存并更新当前 Agent"
                      : "保存为新版本"}
                  </button>
                </>
              )}
              {saved && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await window.manager.call("discardComponentDraft", {
                        token: draft!.token,
                      });
                      onClose();
                    })
                  }
                >
                  删除工作副本并关闭
                </button>
              )}
            </>
          )}
        </div>
      }
    >
      {busy && !inspection && <p role="status">正在读取完整内容…</p>}
      {inspection && (
        <>
          <p className="content-origin">
            {source.kind === "agent"
              ? "当前 Agent 固定的组件制品"
              : "公共库组件制品"}{" "}
            · 修改保存为新版本
          </p>
          <details className="content-identity">
            <summary>组件标识与摘要</summary>
            <dl>
              <dt>标识</dt>
              <dd>{object(inspection.manifestText).id as string}</dd>
              <dt>SHA-256</dt>
              <dd>{inspection.baseDigest}</dd>
            </dl>
          </details>
          <div className="content-tabs" role="tablist" aria-label="组件内容">
            {(
              [
                ["manifest", "Manifest"],
                ["payload", "Payload"],
                ["files", "文件目录"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                id={`content-tab-${value}`}
                role="tab"
                aria-selected={tab === value}
                aria-controls={`content-panel-${value}`}
                disabled={busy}
                onClick={() => changeTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="content-tools">
            {tab !== "files" && (
              <>
                <button
                  className="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(
                        tab === "payload" ? payloadText : manifestText,
                      );
                      setStatus("已复制完整 JSON。");
                    })
                  }
                >
                  复制 JSON
                </button>
                {editing && !saved && (
                  <button
                    className="sm"
                    disabled={busy || !!conflict}
                    onClick={() => {
                      try {
                        const value = manifest();
                        setManifestText(pretty(value));
                        setPayloadText(pretty(value.payload));
                        setError("");
                      } catch (e) {
                        setError(message(e));
                      }
                    }}
                  >
                    格式化
                  </button>
                )}
              </>
            )}
            {draft && (
              <button
                className="sm"
                disabled={busy || saved || !!conflict}
                onClick={() => void run(reread)}
              >
                重新读取
              </button>
            )}
          </div>
          {status && (
            <p role="status" className="notice">
              {status}
            </p>
          )}
          {conflict && (
            <section className="content-conflict" aria-label="内容冲突">
              <p>
                本地 JSON 与外部 manifest.json 均已保留。选择一份后再校验保存。
              </p>
              <div className="conflict-versions">
                <label>
                  本地 JSON
                  <textarea
                    readOnly
                    value={jsonTab === "payload" ? payloadText : manifestText}
                  />
                </label>
                <label>
                  外部 Manifest
                  <textarea readOnly value={conflict.manifestText} />
                </label>
              </div>
              <div className="inline-actions">
                <button
                  onClick={() => {
                    setDraft(conflict);
                    setConflict(undefined);
                    setError("");
                    setStatus("已选择本地 JSON，校验时将写入工作副本。");
                  }}
                >
                  采用本地 JSON
                </button>
                <button
                  onClick={() => {
                    useView(conflict);
                    setConflict(undefined);
                    setError("");
                    setStatus("已采用外部 Manifest。");
                  }}
                >
                  采用外部文件
                </button>
              </div>
            </section>
          )}
          <section
            id={`content-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`content-tab-${tab}`}
          >
            {tab === "files" ? (
              <>
                <p>
                  文件在私有工作副本中编辑。运行内容来自
                  manifest.payload；source/card.json 和 source/card.png
                  是导入原件，不会自动同步。
                </p>
                <button
                  disabled={busy || !!conflict}
                  onClick={() => void run(() => reveal())}
                >
                  打开工作副本目录
                </button>
                <ul className="content-file-list">
                  {entries.map((file) => (
                    <li
                      key={file.path}
                      style={{
                        paddingInlineStart: `${Math.min(file.path.split("/").length - 1, 8) * 12 + 8}px`,
                      }}
                    >
                      <code>
                        {file.path}
                        {file.size < 0 ? "/" : ""}
                      </code>
                      {file.size >= 0 && (
                        <small>{file.size.toLocaleString()} 字节</small>
                      )}
                      <button
                        className="sm"
                        disabled={busy || !!conflict}
                        aria-label={`在 Finder 中显示 ${file.path}`}
                        onClick={() => void run(() => reveal(file.path))}
                      >
                        在 Finder 中显示
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <label className="content-json-label">
                {tab === "payload" ? "完整 Payload JSON" : "完整 Manifest JSON"}
                <textarea
                  spellCheck={false}
                  wrap="soft"
                  ref={jsonEditor}
                  className="content-json"
                  readOnly={!editing || saved || !!conflict}
                  disabled={busy}
                  value={tab === "payload" ? payloadText : manifestText}
                  onChange={(e) => {
                    if (tab === "payload") setPayloadText(e.target.value);
                    else setManifestText(e.target.value);
                    setStatus("");
                    setError("");
                  }}
                />
              </label>
            )}
          </section>
        </>
      )}
    </ManagedDialog>
  );
}
