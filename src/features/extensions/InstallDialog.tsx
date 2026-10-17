import { useState } from "react";
import { Dialog } from "../../components/Dialog";
import type { DialogFeedback } from "../../shell/controllers";
export function InstallDialog({
  feedback,
  open,
  source,
  onClose,
  onInstall,
}: {
  feedback: DialogFeedback;
  open: boolean;
  source: HTMLElement | null;
  onClose(): void;
  onInstall(id: string, url: string): Promise<void>;
}) {
  const { busy, error } = feedback;
  const [moduleUrl, setModuleUrl] = useState("");
  const [moduleId, setModuleId] = useState("");
  if (!open) return null;
  return (
    <Dialog
      title="安装扩展"
      returnFocusTo={source}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onInstall(moduleId, moduleUrl);
        }}
      >
        <div className="dialog-content">
          <p>加载本地可信 ESM 扩展，再查看能力并确认启用。</p>
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
          <p className="muted">
            模型连接器和 MCP
            服务也通过扩展接入。模块路径保存在本地；扩展与宿主共享环境，加载的代码会执行。
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onClose()}
          >
            取消
          </button>
          <button disabled={busy}>加载模块</button>
        </footer>
      </form>
    </Dialog>
  );
}
