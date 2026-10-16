import type { Runtime } from "../../shell/runtime";
import type { ShellOperations } from "../../shell/useOperations";
import { Dialog } from "../../components/Dialog";
import { uninstallImport } from "../../../modules/shell/uninstall";
import { saveRemovedImport } from "./operations";
export function UninstallDialog({
  runtime,
  operations,
  id: removal,
  source,
  onClose,
  onRemoved,
}: {
  runtime: Runtime;
  operations: ShellOperations;
  id: string;
  source: HTMLElement | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { host, catalog } = runtime;
  const { busy, error, operate, setNotice } = operations;
  return (
    <Dialog
      title="卸载扩展"
      returnFocusTo={source}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        <p>卸载 {removal}？扩展会先停用，依赖它的扩展将等待服务恢复。</p>
        <p>
          保留已保存的数据和模块文件，仅移除安装路径与授权；下次启动不会自动加载。同
          ID 重装后需重新授权。
        </p>
        {error && (
          <p className="error" role="alert">
            卸载未完成：{error}
            。扩展可能已停用；可重试，保存回执不明时请重新加载确认。
          </p>
        )}
      </div>
      <footer className="dialog-actions">
        <button className="secondary" disabled={busy} onClick={() => onClose()}>
          取消
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void operate(async () => {
              const id = removal;
              const imports = await uninstallImport(
                host,
                id,
                runtime.imports,
                (imports) => saveRemovedImport(runtime, id, imports),
              );
              runtime.imports = imports;
              const index = catalog.findIndex((entry) => entry.id === id);
              if (index !== -1) catalog.splice(index, 1);
              onRemoved();
              setNotice("扩展已卸载，已保存的数据和模块文件已保留。");
            })
          }
        >
          保留数据并卸载
        </button>
      </footer>
    </Dialog>
  );
}
