import type { Runtime } from "./runtime";
import { errorMessage } from "./messages";
import { useAsyncAction } from "./useAsyncAction";

/** Combine boot-time failure classes so one does not hide the others. */
export function initialErrorFor(initial: {
  compositionErrors: string[];
  platformErrors: string[];
  failedImports: Record<string, string>;
}) {
  const parts: string[] = [];
  if (initial.compositionErrors.length)
    parts.push(
      `组合未完整恢复：${initial.compositionErrors.join("；")}。原配置已保留。`,
    );
  if (initial.platformErrors.length)
    parts.push(`${initial.platformErrors.join("；")}。请重新加载应用后重试。`);
  if (Object.keys(initial.failedImports).length)
    parts.push("有扩展加载失败，请在扩展管理重试或移除失效路径。");
  return parts.join(" ");
}

export function useOperations(runtime: Runtime) {
  const { run: operate, ...feedback } = useAsyncAction({
    initialError: initialErrorFor(runtime.initial),
    describeError: errorMessage,
  });
  return { ...feedback, operate };
}

export type ShellOperations = ReturnType<typeof useOperations>;
