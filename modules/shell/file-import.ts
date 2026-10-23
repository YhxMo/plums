import type { ExtensionDefinition, StoredState } from "@modules/sdk";
import { ContractError } from "@modules/sdk/errors";
import { validateDefinition } from "@modules/extension-host/definition";

/**
 * Single-file extensions imported from the user's device. The source lives in
 * the shell's own keyed state, addressed by its SHA-256, and loads from a Blob
 * URL; the import record keeps `imported:sha256:<hex>` in place of a path.
 */
const prefix = "imported:sha256:";
/** Stored JSON must fit one 64 KiB state document with its envelope. */
const maxStored = 60 * 1024;
const tooLarge = "扩展文件超过 60 KiB，当前只支持单个 .js 文件。";

export type ExtensionFile = { source: string; hash: string; url: string };
export type SourceStore = ReturnType<typeof sourceStore>;
export type LoadSource = (
  source: string,
  expectedId?: string,
) => Promise<ExtensionDefinition>;
type Call = (capability: string, payload?: unknown) => Promise<unknown>;

export const isFileImport = (url: string) =>
  /^imported:sha256:[0-9a-f]{64}$/.test(url);
const hashOf = (url: string) => url.slice(prefix.length);
const sourceKey = (hash: string) => `x-${hash.slice(0, 48)}`;
const bytes = (text: string) => new TextEncoder().encode(text);

/** What the user sees as the module's location. */
export const sourceLabel = (url: string) =>
  isFileImport(url) ? `本地导入的文件 · ${hashOf(url).slice(0, 12)}` : url;

async function sha256(source: string) {
  const digest = await crypto.subtle.digest("SHA-256", bytes(source));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function readExtensionFile(file: Blob): Promise<ExtensionFile> {
  if (file.size > maxStored) throw Error(tooLarge);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw Error("扩展文件不是 UTF-8 文本。");
  }
  if (bytes(JSON.stringify(source)).length > maxStored) throw Error(tooLarge);
  const hash = await sha256(source);
  return { source, hash, url: prefix + hash };
}

/**
 * Evaluates the file as a module. Its top-level code runs now, with the app's
 * full privileges: imports are trusted, not sandboxed. Relative imports inside
 * the file cannot resolve from a Blob URL.
 */
export const loadExtensionSource: LoadSource = async (source, expectedId) => {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    const module = await import(/* @vite-ignore */ url);
    validateDefinition(module.default);
    if (expectedId !== undefined && module.default.manifest.id !== expectedId)
      throw new ContractError(
        "extension.invalid",
        "manifest.id",
        "Module identity does not match catalog",
      );
    return module.default;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export function sourceStore(call: Call) {
  const read = async (hash: string) =>
    (await call("state.read", { key: sourceKey(hash) })) as StoredState | null;
  return {
    async read(url: string) {
      const hash = isFileImport(url) ? hashOf(url) : url;
      const stored = await read(hash);
      if (!stored) throw Error("导入的扩展文件已丢失，请重新导入。");
      const value = stored.value as { version?: unknown; source?: unknown };
      if (
        value?.version !== 1 ||
        typeof value.source !== "string" ||
        (await sha256(value.source)) !== hash
      )
        throw Error("导入的扩展文件已损坏，请重新导入。");
      return value.source;
    },
    async write({ hash, source }: ExtensionFile) {
      const stored = await read(hash);
      if ((stored?.value as { source?: unknown })?.source === source) return;
      await call("state.write", {
        key: sourceKey(hash),
        revision: stored?.revision ?? 0,
        value: { version: 1, source },
      });
    },
    /** Best effort: an unreferenced source is inert. */
    async remove(url: string) {
      const hash = isFileImport(url) ? hashOf(url) : url;
      try {
        const stored = await read(hash);
        if (stored)
          await call("state.write", {
            key: sourceKey(hash),
            revision: stored.revision,
            remove: true,
          });
      } catch {
        // Kept for a later cleanup; never fail a committed change for it.
      }
    },
  };
}
