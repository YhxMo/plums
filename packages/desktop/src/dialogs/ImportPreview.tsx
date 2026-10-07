import { Icon } from "../components/Icon.js";
import { PermissionList } from "../components/PermissionList.js";
import { useState } from "react";
import type { Permission } from "@plums/core";
import type { AgentBundleManifest } from "@plums/sdk";
import { ManagedDialog } from "../managed-dialog.js";
export type ImportPreviewData = {
  token: string;
  type: "agent" | "component" | "foundation";
  incomplete?: boolean;
  agent?: AgentBundleManifest;
  components: {
    id: string;
    name: string;
    kind: string;
    version: string;
    permissions: Permission[];
    code: boolean;
  }[];
};
export function ImportPreview({
  preview,
  busy,
  error,
  onClose,
  onImport,
}: {
  preview: ImportPreviewData;
  busy: boolean;
  error: string;
  onClose: () => void;
  onImport: (mode: "ready" | "assemble" | "library") => void;
}) {
  const [mode, setMode] = useState<"ready" | "assemble" | "library">(
    preview.type === "agent"
      ? preview.incomplete
        ? "assemble"
        : "ready"
      : "library",
  );
  return (
    <ManagedDialog
      testId="import-dialog"
      className="import-modal"
      label="导入文件"
      title={preview.agent?.name ?? preview.components[0]?.name ?? "导入文件"}
      footer={
        <div className="modal-actions">
          <button disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onImport(mode)}
          >
            {busy
              ? "正在导入…"
              : mode === "ready"
                ? "导入并配置"
                : mode === "assemble"
                  ? "导入并继续组装"
                  : preview.type === "foundation"
                    ? "导入底座"
                    : "导入公共库"}
          </button>
        </div>
      }
      busy={busy}
      onClose={onClose}
    >
      {preview.type === "agent" ? (
        <>
          <p>你准备怎样使用这份 ZIP？</p>
          <div
            className="import-choices"
            role="radiogroup"
            aria-label="ZIP 使用方式"
          >
            <label
              className={`import-choice ${mode === "ready" ? "chosen" : ""}`}
            >
              <input
                type="radio"
                name="import-mode"
                value="ready"
                checked={mode === "ready"}
                disabled={!!preview.incomplete || busy}
                onChange={() => setMode("ready")}
              />
              <div>
                <Icon name="agent" size={40} />
                <strong>这是完整的 Agent，直接使用</strong>
                <p>导入后填写必要配置，确认权限即可开始。</p>
                {preview.incomplete && (
                  <small>请继续组装，补齐组件或明确选择满足需求的底座。</small>
                )}
              </div>
            </label>
            <label
              className={`import-choice ${mode === "assemble" ? "chosen" : ""}`}
            >
              <input
                type="radio"
                name="import-mode"
                value="assemble"
                checked={mode === "assemble"}
                disabled={busy}
                onChange={() => setMode("assemble")}
              />
              <div>
                <Icon name="extension" size={40} />
                <strong>我还要补充功能，继续组装</strong>
                <p>收藏包内组件，再添加或更换角色卡和扩展（含服务接入）。</p>
              </div>
            </label>
          </div>
        </>
      ) : preview.type === "foundation" ? (
        <p>
          这是一份已验证的官方底座制品。导入会保留代码，不会授予组件权限或改变现有
          Agent 的选择。
        </p>
      ) : (
        <p>
          这是一份
          {preview.components[0]?.kind === "character"
            ? "角色卡"
            : preview.components[0]?.kind === "extension"
              ? "功能扩展"
              : "扩展 · 服务接入"}
          。导入公共库后，可以用于你自己的 Agent。
        </p>
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <details className="import-contents">
        <summary>
          查看包含的 {preview.components.length} 个组件与访问范围
        </summary>
        {preview.components.map((p) => (
          <div className="preview-component" key={p.id}>
            <strong>{p.name}</strong>
            <span>
              {p.kind === "character"
                ? "角色卡"
                : p.kind === "extension"
                  ? "功能扩展"
                  : "扩展 · 服务接入"}{" "}
              · v{p.version}
            </span>
            <PermissionList permissions={p.permissions} />
          </div>
        ))}
      </details>
    </ManagedDialog>
  );
}
