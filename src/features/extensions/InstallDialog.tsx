import { useState } from "react";
import type { Runtime } from "../../shell/runtime";
import type { ShellOperations } from "../../shell/useOperations";
import { Dialog } from "../../components/Dialog";
import { loadExtension } from "../../../modules/extension-host/host";
export function InstallDialog({
  runtime,
  operations,
  open,
  source,
  onClose,
  onInstalled,
}: {
  runtime: Runtime;
  operations: ShellOperations;
  open: boolean;
  source: HTMLElement | null;
  onClose: () => void;
  onInstalled: (id: string) => void;
}) {
  const { host, catalog } = runtime;
  const { busy, error, operate, setNotice } = operations;
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
          void operate(async () => {
            const target = new URL(moduleUrl, location.href);
            if (target.origin !== location.origin)
              throw Error(
                "当前 M1 仅加载本地可信 ESM 模块。请将扩展放入应用目录后填写模块路径。",
              );
            const definition = await loadExtension(target.href, moduleId);
            if (host.ids().includes(moduleId))
              throw Error("此扩展 ID 已存在。");
            const entry = {
              id: moduleId,
              url: target.pathname + target.search,
              label: moduleId,
            };
            const imports = [
              ...runtime.imports.filter((saved) => saved.id !== moduleId),
              entry,
            ];
            await runtime.save({ imports });
            runtime.imports = imports;
            host.install(definition, runtime.configurations[moduleId]);
            catalog.push(entry);
            onInstalled(moduleId);
            onClose();
            setNotice(
              "模块路径已保存。请检查来源与能力，再启用扩展；下次启动会重新加载模块。",
            );
          });
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
