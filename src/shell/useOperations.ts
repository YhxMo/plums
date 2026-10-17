import type { Runtime } from "./runtime";
import { errorMessage } from "./messages";
import { useAsyncAction } from "./useAsyncAction";

export function useOperations(runtime: Runtime) {
  const { run: operate, ...feedback } = useAsyncAction({
    initialError: runtime.initial.compositionErrors.length
      ? `组合未完整恢复：${runtime.initial.compositionErrors.join("；")}。原配置已保留。`
      : Object.keys(runtime.initial.failedImports).length
        ? "有扩展加载失败，请在扩展管理重试或移除失效路径。"
        : "",
    describeError: errorMessage,
  });
  return { ...feedback, operate };
}

export type ShellOperations = ReturnType<typeof useOperations>;
