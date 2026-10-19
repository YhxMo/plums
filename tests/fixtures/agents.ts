import { vi } from "vitest";
import type { Platform, StoredState } from "../../modules/sdk";
import type { Agent } from "../../modules/agents/contract";

type Update = StoredState & { key?: string; remove?: boolean };
export const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
/** In-memory state with grants and revision checks, like the native broker. */
export function memoryPlatform(initial: Record<string, StoredState> = {}) {
  const states = new Map(Object.entries(structuredClone(initial)));
  const grants = new Map<string, Set<string>>();
  const slot = (owner: string, key?: string) =>
    key ? `${owner}+${key}` : owner;
  const write = vi.fn(async (owner: string, update: Update) => {
    const key = slot(owner, update.key);
    if (update.revision !== (states.get(key)?.revision ?? 0))
      throw Object.assign(new Error("revision conflict"), {
        outcome: "not-committed",
      });
    if (update.remove) {
      states.delete(key);
      return null;
    }
    const next = {
      revision: update.revision + 1,
      value: structuredClone(update.value),
    };
    if (bytes(next) > 65_536)
      throw Object.assign(new Error("状态超过 64 KiB 实验上限，未保存。"), {
        code: "state-too-large",
        outcome: "not-committed",
      });
    states.set(key, next);
    return next;
  });
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async (key, capabilities) => {
      grants.set(key, new Set(capabilities));
    },
    call: async (key, capability, payload) => {
      if (!grants.get(key)?.has(capability)) throw new Error("denied");
      if (capability === "state.read")
        return (
          states.get(slot(key, (payload as Update | undefined)?.key)) ?? null
        );
      return write(key, payload as Update);
    },
  };
  return { platform, states, write };
}

/** A saved Agent with one session, as an older version wrote it. */
export function legacyAgent(): Agent {
  return {
    id: "a1",
    name: "旧角色",
    description: "旧说明",
    status: "busy",
    canCancel: true,
    pinned: true,
    extensionId: "agents.local",
    capabilities: ["本地文本处理"],
    multiSession: false,
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
