import { useState } from "react";
import type { Runtime } from "./runtime";
import { errorMessage } from "./messages";

export function useOperations(runtime: Runtime) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    runtime.compositionErrors.length
      ? `组合未完整恢复：${runtime.compositionErrors.join("；")}。原配置已保留。`
      : Object.keys(runtime.failedImports).length
        ? "有扩展加载失败，请在扩展管理重试或移除失效路径。"
        : "",
  );
  const [notice, setNotice] = useState("");
  async function operate(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, setError, setNotice, operate };
}

export type ShellOperations = ReturnType<typeof useOperations>;
