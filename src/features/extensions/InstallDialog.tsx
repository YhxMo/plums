import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import type { DialogFeedback } from "../../shell/controllers";
import { capabilityLabel } from "../../shell/messages";
import type { ExtensionDefinition } from "../../../modules/sdk";
import {
  sourceLabel,
  type ExtensionFile,
} from "../../../modules/shell/file-import";
import { Icon } from "../../components/Icon";
import { serviceList } from "./services";
import styles from "./InstallDialog.module.css";

export type ImportPreview = {
  file: ExtensionFile;
  definition: ExtensionDefinition;
  replacing: boolean;
};

function PreviewDetails({ file, definition, replacing }: ImportPreview) {
  const { manifest } = definition;
  const bindings = Object.values(manifest.credentialBindings ?? {});
  return (
    <>
      <dl className={styles.summary} aria-label="导入内容">
        {manifest.name && (
          <>
            <dt>名称</dt>
            <dd>{manifest.name}</dd>
          </>
        )}
        <dt>扩展 ID</dt>
        <dd>{manifest.id}</dd>
        {manifest.description && (
          <>
            <dt>说明</dt>
            <dd className={styles.description}>{manifest.description}</dd>
          </>
        )}
        <dt>版本</dt>
        <dd>{manifest.version}</dd>
        <dt>提供服务</dt>
        <dd>{serviceList(manifest.provides)}</dd>
        <dt>所需服务</dt>
        <dd>{serviceList(manifest.requires, manifest.optional)}</dd>
        <dt>系统权限</dt>
        <dd>
          {manifest.capabilities?.length
            ? manifest.capabilities.map(capabilityLabel).join("、")
            : "无需原生能力"}
        </dd>
        {bindings.length > 0 && (
          <>
            <dt>联网目标</dt>
            <dd>
              {bindings
                .map((binding) => `${binding.label}（${binding.target}）`)
                .join("、")}
            </dd>
          </>
        )}
        <dt>来源</dt>
        <dd>{sourceLabel(file.url)}</dd>
      </dl>
      <p className="muted">
        {replacing
          ? "将替换已导入的同 ID 扩展：旧版本先停用并撤销权限，扩展数据保留；替换后需重新启用并确认权限。"
          : "导入后扩展保持停用；启用时再确认它需要的权限。"}
      </p>
    </>
  );
}

export function InstallDialog({
  feedback,
  open,
  source,
  onClose,
  onInstall,
  onPreview,
  onImport,
}: {
  feedback: DialogFeedback;
  open: boolean;
  source: HTMLElement | null;
  onClose(): void;
  onInstall(id: string, url: string): Promise<void>;
  onPreview(file: Blob): Promise<ImportPreview | undefined>;
  onImport(preview: ImportPreview): Promise<void>;
}) {
  const { busy, error } = feedback;
  const [moduleUrl, setModuleUrl] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [preview, setPreview] = useState<ImportPreview>();
  const [dragging, setDragging] = useState(false);
  if (!open) return null;
  const close = () => {
    if (busy) return;
    setPreview(undefined);
    onClose();
  };
  const choose = async (file: File | undefined) => {
    if (file) setPreview(await onPreview(file));
  };
  return (
    <Dialog title="安装扩展" returnFocusTo={source} onClose={close}>
      <div className="dialog-content">
        {preview ? (
          <PreviewDetails {...preview} />
        ) : (
          <>
            <p>导入下载或自己编写的扩展文件（单个 .js 文件）。</p>
            <p className={styles.warning} role="note">
              <strong>只导入你信任来源的文件。</strong>
              扩展与应用在同一环境中运行：选择文件后其代码就会执行，并可使用你之后授予的权限。
            </p>
            <div
              className={`${styles.drop} ${dragging ? styles.dragging : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) void choose(event.dataTransfer.files[0]);
              }}
            >
              <Icon name="puzzle" size={26} />
              <label className={styles.pick} data-disabled={busy}>
                选择扩展文件
                <input
                  type="file"
                  className="sr-only"
                  accept=".js,.mjs,text/javascript"
                  disabled={busy}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void choose(input.files?.[0]).finally(() => {
                      input.value = "";
                    });
                  }}
                />
              </label>
              <span className={styles.dropHint}>也可以把文件拖到这里</span>
            </div>
            {/* Open by default only in development builds. */}
            <details className={styles.path} open={import.meta.env.DEV}>
              <summary>开发者：按模块路径安装</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onInstall(moduleId, moduleUrl);
                }}
              >
                <p className="muted">
                  加载随应用提供或开发服务器上的同源 ESM 模块；路径保存在本地。
                </p>
                <label className="field">
                  扩展 ID
                  <input
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    required
                    placeholder="example.extension"
                  />
                </label>
                <label className="field">
                  模块路径
                  <input
                    value={moduleUrl}
                    onChange={(e) => setModuleUrl(e.target.value)}
                    required
                    placeholder="/extensions/example.js"
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  加载模块
                </button>
              </form>
            </details>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-actions">
        {preview ? (
          <>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              返回
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void onImport(preview).then(() => setPreview(undefined))
              }
            >
              {preview.replacing ? "替换" : "导入"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
        )}
      </footer>
    </Dialog>
  );
}
