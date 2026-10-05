import { useState } from "react";
import { ManagedDialog } from "../managed-dialog.js";
export function InvocationDialog({
  title,
  busy,
  operationError,
  onClose,
  onRun,
}: {
  title: string;
  busy: boolean;
  operationError: string;
  onClose: () => void;
  onRun: (input: unknown) => void;
}) {
  const [parameters, setParameters] = useState("{}");
  const [error, setError] = useState("");
  function run() {
    let input: unknown;
    try {
      input = JSON.parse(parameters);
    } catch {
      setError("参数不是有效的 JSON，请检查括号和引号。");
      return;
    }
    setError("");
    onRun(input);
  }
  return (
    <ManagedDialog
      title={title}
      label={title}
      busy={busy}
      error={operationError}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy} onClick={run}>
            运行
          </button>
        </div>
      }
    >
      <p>输入此接口的参数（JSON）。</p>
      <textarea
        aria-label="调用参数"
        className="parameter-input"
        value={parameters}
        onChange={(event) => setParameters(event.target.value)}
        aria-invalid={!!error}
      />
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </ManagedDialog>
  );
}
