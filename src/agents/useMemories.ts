import { useEffect, useEffectEvent, useState } from "react";
import type { Provider } from "@modules/sdk";
import type {
  MemoryReport,
  MemoryService,
} from "@modules/agents/memory/contract";

/** The active `memory@1` providers, as the interface extension sees them. */
export type Memories = {
  list(): readonly Provider<MemoryService>[];
  subscribe(listener: () => void): () => void;
};

/**
 * The memory providers, re-rendering when they or what they remember
 * change; `onReport` hears each consolidation made after mounting, once.
 */
export function useMemories(
  memories: Memories | undefined,
  onReport: (memory: Provider<MemoryService>, report: MemoryReport) => void,
) {
  const [, setVersion] = useState(0);
  const report = useEffectEvent(onReport);
  useEffect(() => {
    if (!memories) return;
    const seen = new Set<string>();
    let unwatch: Array<() => void> = [];
    const watch = () => {
      unwatch.forEach((stop) => stop());
      unwatch = memories.list().map((memory) => {
        memory.value.reports().forEach((r) => seen.add(r.id));
        return memory.value.subscribe(() => {
          for (const r of memory.value.reports())
            if (!seen.has(r.id)) {
              seen.add(r.id);
              report(memory, r);
            }
          setVersion((v) => v + 1);
        });
      });
      setVersion((v) => v + 1);
    };
    watch();
    const stop = memories.subscribe(watch);
    return () => {
      stop();
      unwatch.forEach((s) => s());
    };
  }, [memories]);
  return memories?.list() ?? [];
}

/** A consolidation in a sentence, such as 「甲」记下了“对花生过敏”，更新 1 条. */
export function reportText(name: string, r: MemoryReport) {
  const parts = [
    r.added.length &&
      `记下了“${r.added[0]}”${r.added.length > 1 ? `等 ${r.added.length} 件事` : ""}`,
    r.changed.length && `更新 ${r.changed.length} 条`,
    r.removed.length && `删除 ${r.removed.length} 条`,
  ].filter(Boolean);
  return `「${name}」${parts.join("，")}`;
}
