import { vi } from "vitest";
import type { Platform, StoredRecord, StoredState } from "../../modules/sdk";
import type { Agent } from "../../modules/agents/contract";
import { BrowserState } from "../../src/browser-state";

const prefix = "plums:";
/**
 * Owner storage in memory with the browser preview's rules and limits, which
 * are the native store's. `initial` holds documents by `owner` or
 * `owner+key`, as `documents()` returns them.
 */
export function memoryPlatform(initial: Record<string, StoredState> = {}) {
  const storage = new Map<string, string>();
  for (const [slot, state] of Object.entries(initial))
    storage.set(`${prefix}${slot}`, JSON.stringify({ schema: 1, ...state }));
  const store = new BrowserState(
    () =>
      ({
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      }) as Storage,
  );
  const grants = new Map<string, Set<string>>();
  /** Every write, so a test can fail one. */
  const write = vi.fn(
    async (
      owner: string,
      capability: string,
      payload: unknown,
      signal?: AbortSignal,
    ) =>
      capability === "state.batch"
        ? store.batch(owner, payload, signal)
        : store.write(owner, payload, signal),
  );
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async (owner, capabilities) => {
      grants.set(owner, new Set(capabilities));
    },
    call: async (owner, capability, payload, signal) => {
      if (!grants.get(owner)?.has(capability)) throw new Error("denied");
      if (capability === "state.read") return store.read(owner, payload);
      if (capability === "records.list") return store.list(owner, payload);
      if (capability === "records.search") return store.search(owner, payload);
      return write(owner, capability, payload, signal);
    },
  };
  /** Stored documents by `owner` or `owner+key`. */
  const documents = (): Record<string, StoredState> =>
    Object.fromEntries(
      [...storage]
        .filter(([key]) => !key.endsWith("#records"))
        .map(([key, raw]) => {
          const { revision, value } = JSON.parse(raw) as StoredState;
          return [key.slice(prefix.length), { revision, value }];
        }),
    );
  /** An owner's records in `collection`, in order. */
  const records = (owner: string, collection: string): StoredRecord[] => {
    const raw = storage.get(`${prefix}${owner}#records`);
    const all = raw ? (JSON.parse(raw) as { records: StoredRecord[] }) : null;
    return (all?.records ?? [])
      .filter((record) => record.collection === collection)
      .sort((a, b) => a.seq - b.seq);
  };
  return { platform, storage, write, documents, records };
}

/** A saved Agent with one session, as an older version wrote it. */
export function legacyAgent(): Agent & Record<string, unknown> {
  return {
    id: "a1",
    name: "旧角色",
    description: "旧说明",
    status: "busy",
    canCancel: true,
    pinned: true,
    extensionId: "agents.local",
    // Fields older versions saved and later dropped.
    capabilities: ["本地文本处理"],
    multiSession: false,
    extensions: [],
    currentSessionId: "s1",
    sessions: [
      {
        id: "s1",
        title: "旧会话",
        createdAt: 1,
        lastMessageAt: 2,
        messages: [
          { id: "m1", role: "user", text: "你好" },
          { id: "m2", role: "agent", text: "旧回复" },
        ],
      },
    ],
  };
}
