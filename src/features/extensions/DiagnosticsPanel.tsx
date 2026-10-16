import { useState } from "react";
import type { Runtime } from "../../shell/runtime";
import type { ShellOperations } from "../../shell/useOperations";
import type { Workspace } from "../../shell/useWorkspace";
import type { Authorization } from "../../shell/AuthorizationDialog";
import type { Experiments } from "../../shell/useExperiments";
import styles from "../../App.module.css";
export function DiagnosticsPanel({
  runtime,
  operations,
  workspace,
  authorization,
  experiments,
  open: diagnostics,
  onToggle: setDiagnostics,
}: {
  runtime: Runtime;
  operations: ShellOperations;
  workspace: Workspace;
  authorization: Authorization;
  experiments: Experiments;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const { host, adapter } = runtime;
  const { busy, operate, setNotice } = operations;
  const { activeView, setSelected } = workspace;
  const { requestAuthorization } = authorization;
  const { started, start, writeDenied } = experiments;
  const [fault, setFault] = useState(false);
  return (
    <details
      className={styles.diagnostics}
      open={diagnostics}
      onToggle={(e) => setDiagnostics(e.currentTarget.open)}
    >
      <summary>诊断与实验</summary>
      <button
        className="secondary"
        disabled={busy}
        onClick={(event) =>
          requestAuthorization(["workbench"], start, event.currentTarget)
        }
      >
        授予实验能力并启动
      </button>
      <div className={styles.diagnosticActions}>
        <button
          className="secondary"
          disabled={!started || busy}
          onClick={() =>
            void operate(async () => {
              const upper = host.inspect("transform.upper").status === "active";
              await host.stop(upper ? "transform.upper" : "transform.reverse");
              await host.start(upper ? "transform.reverse" : "transform.upper");
              setNotice("服务已替换，工作台已重新连接。");
            })
          }
        >
          替换服务
        </button>
        <button
          className="secondary"
          disabled={!activeView || busy}
          onClick={() =>
            void operate(async () => {
              const owner = host
                .views()
                .find((view) => view.id === activeView)!.owner;
              await host.stop(owner);
              setSelected("default");
              setNotice("布局已停用，已选择可用界面。");
            })
          }
        >
          停用当前布局
        </button>
        <button
          className="secondary"
          disabled={!started || busy}
          onClick={() =>
            void operate(async () => {
              await host.start("ui.broken");
              setSelected("broken");
            })
          }
        >
          测试故障布局
        </button>
        <button
          className="secondary"
          disabled={!started || busy}
          onClick={(event) => {
            if (writeDenied)
              requestAuthorization(
                ["workbench"],
                async () => {
                  await host.grant("workbench", ["state.read", "state.write"]);
                },
                event.currentTarget,
              );
            else
              void operate(async () => {
                await host.grant("workbench", ["state.read"]);
                setNotice("写入能力已撤销，工作台等待重新授权。");
              });
          }}
        >
          {writeDenied ? "恢复状态写入" : "撤销状态写入"}
        </button>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={fault}
            onChange={(event) => {
              adapter.failWrites = event.target.checked;
              setFault(event.target.checked);
            }}
          />
          注入存储写入失败
        </label>
        <p>故障注入只用于本应用实验，不代表操作系统授权。</p>
      </div>
    </details>
  );
}
