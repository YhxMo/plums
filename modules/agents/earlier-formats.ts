import type { StoredState } from "@modules/sdk";
import { corrupt, object, validAvatar } from "./validation";

/**
 * Versions 2 and 3 of the Agent index, read and never written: version 2
 * names one shard per session (a missing one is an empty session), version 3
 * names each session's pages, whose text joined is its messages' JSON, and
 * one picture document per Agent. Returns the Agents with their messages and
 * every document read, by key and revision, so they can be removed once the
 * same content is saved as records.
 */
export async function readEarlier(
  call: (capability: string, payload?: unknown) => Promise<unknown>,
  version: 2 | 3,
  entries: Record<string, unknown>[],
) {
  const documents = new Map<string, number>();
  async function read(key: string) {
    const stored = (await call("state.read", { key })) as StoredState | null;
    if (stored) documents.set(key, stored.revision);
    return stored?.value;
  }
  /** The picture a key names; a missing or damaged one is just no picture. */
  async function readAvatar(key: unknown) {
    if (typeof key !== "string") return undefined;
    try {
      const value = await read(key);
      if (object(value) && value.version === 1 && validAvatar(value.image))
        return value.image;
    } catch {
      // The picture is optional: the Agent still starts.
    }
    return undefined;
  }
  async function readShard(key: unknown) {
    if (typeof key !== "string") throw corrupt();
    const value = await read(key);
    if (value === undefined) return [];
    if (!object(value) || value.version !== 1) throw corrupt();
    return value.messages;
  }
  async function readPages(keys: unknown) {
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string"))
      throw corrupt();
    const parts = await Promise.all(
      keys.map(async (key) => {
        const value = await read(key);
        if (
          !object(value) ||
          value.version !== 2 ||
          typeof value.part !== "string"
        )
          throw corrupt();
        return value.part;
      }),
    );
    const json = parts.join("");
    try {
      return json ? JSON.parse(json) : [];
    } catch {
      throw corrupt();
    }
  }
  const agents = await Promise.all(
    entries.map(async ({ avatar: key, ...entry }) => {
      if (!Array.isArray(entry.sessions)) throw corrupt();
      const avatar = await readAvatar(key);
      const sessions = await Promise.all(
        (entry.sessions as unknown[]).map(async (session) => {
          if (!object(session)) throw corrupt();
          const { shard, pages, ...meta } = session;
          const messages =
            version === 2 ? await readShard(shard) : await readPages(pages);
          return { ...meta, messages };
        }),
      );
      return { ...entry, ...(avatar && { avatar }), sessions };
    }),
  );
  return { agents, documents };
}
