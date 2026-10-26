import { MAX_SAVE_BYTES } from "@modules/sdk/files";
import { identifier } from "@modules/sdk/validation";
import { readRoleCardFile, type RoleCardSource } from "./role-card";

/**
 * A whole Agent in one `.plums` file (a zip): its picture role card, which
 * extensions make it up and which of them it has switched off, and the
 * packages of the third-party ones. Built-in extensions are named by ID and
 * version only; the importing app uses its own. Memory, conversations, the
 * model and keys never go in.
 *
 *   card.png                      the role card (card-export.ts)
 *   agent.json                    { version: 1, extensions, off }
 *   extensions/<id>/manifest.json a third-party extension's package
 *   extensions/<id>/main.js
 */
export const BUNDLE_VERSION = 1;
/** Largest bundle read: what file.save can write. */
export const MAX_BUNDLE_BYTES = MAX_SAVE_BYTES;

/** An extension of the Agent, as the bundle lists it. */
export type BundleEntry = { id: string; version: string; packaged: boolean };
/** A third-party extension's package: manifest.json and main.js as written. */
export type BundlePackage = { manifest: string; main: string };
export type ReadBundle = {
  card: RoleCardSource;
  extensions: BundleEntry[];
  off: string[];
  packages: (BundlePackage & { id: string })[];
};

const NOT_A_BUNDLE = "这个文件不是 Plums 的 Agent 文件。";

/**
 * Packs an Agent: its card, its parts (with packages for third-party ones)
 * and what it has off. fflate loads only when a bundle is written or read.
 */
export async function writeBundle({
  card,
  extensions,
  off,
}: {
  card: Uint8Array;
  extensions: readonly {
    id: string;
    version: string;
    package?: BundlePackage;
  }[];
  off: readonly string[];
}): Promise<Uint8Array<ArrayBuffer>> {
  const { strToU8, zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {
    "card.png": card,
    "agent.json": strToU8(
      JSON.stringify({
        version: BUNDLE_VERSION,
        extensions: extensions.map(({ id, version, package: pkg }) => ({
          id,
          version,
          packaged: !!pkg,
        })),
        off,
      }),
    ),
  };
  for (const { id, package: pkg } of extensions)
    if (pkg) {
      files[`extensions/${id}/manifest.json`] = strToU8(pkg.manifest);
      files[`extensions/${id}/main.js`] = strToU8(pkg.main);
    }
  return zipSync(files) as Uint8Array<ArrayBuffer>;
}

/** An extension ID, by the SDK's one rule. */
const validId = (id: unknown): id is string => {
  try {
    identifier(id, "extension.invalid");
    return true;
  } catch {
    return false;
  }
};
const isEntry = (value: unknown): value is BundleEntry => {
  const entry = value as Partial<BundleEntry> | null;
  return (
    validId(entry?.id) &&
    typeof entry!.version === "string" &&
    entry.version.length <= 64 &&
    typeof entry.packaged === "boolean"
  );
};

/** Reads a bundle; no extension code runs, packages are only text. */
export async function readBundle(file: Blob): Promise<ReadBundle> {
  if (file.size > MAX_BUNDLE_BYTES)
    throw new Error(
      `Agent 文件不能超过 ${MAX_BUNDLE_BYTES / 1024 / 1024} MB。`,
    );
  const { unzipSync } = await import("fflate");
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: ({ name }) =>
        name === "card.png" ||
        name === "agent.json" ||
        /^extensions\/[^/]+\/(?:manifest\.json|main\.js)$/.test(name),
    });
  } catch (error) {
    throw new Error(NOT_A_BUNDLE, { cause: error });
  }
  const text = (path: string) =>
    files[path] &&
    new TextDecoder("utf-8", { fatal: true }).decode(files[path]);
  let meta: { version?: unknown; extensions?: unknown; off?: unknown };
  try {
    meta = JSON.parse(text("agent.json") ?? "null") ?? {};
  } catch (error) {
    throw new Error(NOT_A_BUNDLE, { cause: error });
  }
  if (
    !files["card.png"] ||
    meta.version !== BUNDLE_VERSION ||
    !Array.isArray(meta.extensions) ||
    !meta.extensions.every(isEntry) ||
    !Array.isArray(meta.off) ||
    !meta.off.every((id) => typeof id === "string")
  )
    throw new Error(NOT_A_BUNDLE);
  const extensions = meta.extensions as BundleEntry[];
  const packages = extensions
    .filter((entry) => entry.packaged)
    .map(({ id }) => {
      const manifest = text(`extensions/${id}/manifest.json`);
      const main = text(`extensions/${id}/main.js`);
      let named: unknown;
      try {
        named = manifest && (JSON.parse(manifest) as { id?: unknown }).id;
      } catch {
        named = undefined;
      }
      if (!manifest || main === undefined || named !== id)
        throw new Error(`Agent 文件里的扩展 ${id} 不完整或名不符。`);
      return { id, manifest, main };
    });
  const card = await readRoleCardFile(
    new Blob([files["card.png"] as Uint8Array<ArrayBuffer>], {
      type: "image/png",
    }),
  );
  return { card, extensions, off: meta.off as string[], packages };
}

/** Same major version: the bundle's part works with the app's. */
const compatible = (wanted: string, have: string) =>
  wanted.split(".")[0] === have.split(".")[0];

/**
 * Why parts of a bundle stay off here: missing, in an incompatible version,
 * or not installed when offered.
 */
export function bundleNotes(
  extensions: readonly BundleEntry[],
  installed: readonly { id: string; version: string; label: string }[],
  outcomes: readonly { id: string; outcome: string; reason?: string }[],
): { id: string; text: string }[] {
  return extensions.flatMap(({ id, version, packaged }) => {
    if (packaged) {
      const result = outcomes.find((o) => o.id === id);
      if (!result || ["installed", "replaced", "kept"].includes(result.outcome))
        return [];
      return [
        {
          id,
          text: result.reason
            ? `没有安装 ${id}：${result.reason}，这一项保持关闭。`
            : `没有安装 ${id}，这一项保持关闭。`,
        },
      ];
    }
    const have = installed.find((entry) => entry.id === id);
    if (!have) return [{ id, text: `${id} 没有安装，这一项保持关闭。` }];
    if (!compatible(version, have.version))
      return [
        {
          id,
          text: `包里的「${have.label}」是 ${version}，这里是 ${have.version}，版本不兼容，这一项保持关闭。`,
        },
      ];
    return [];
  });
}
