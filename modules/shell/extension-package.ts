import type { ExtensionDefinition, Manifest, RecordPage } from "@modules/sdk";
import {
  definitionOf,
  validateManifest,
} from "@modules/extension-host/definition";

/**
 * Extensions imported as a package: `manifest.json` plus a single-file ESM
 * `main.js` whose default export holds `activate`. Reading a package checks
 * the manifest and runs no code; `main.js` loads from a Blob URL only after
 * the user confirms. The package lives in the shell's records, addressed by
 * its SHA-256, and the import record keeps `package:sha256:<hex>` in place of
 * a path.
 */
const prefix = "package:sha256:";
/** A manifest is a few KiB; 64 KiB leaves room for long descriptions. */
const MAX_MANIFEST = 64 * 1024;
/** main.js, so that even fully escaped it fits one 8 MiB record. */
const MAX_MAIN = 3 * 1024 * 1024;
const collection = (hash: string) => `extension-package:${hash}`;

/** A file in a package, by its path inside the folder or zip. */
export type PackageFile = { path: string; data: Blob };
export type ExtensionPackage = {
  manifest: Manifest;
  /** manifest.json as written, which the hash covers. */
  manifestText: string;
  main: string;
  hash: string;
  url: string;
};
export type PackageStore = ReturnType<typeof packageStore>;
/** Evaluates main.js as a module. */
export type Evaluate = (source: string) => Promise<{ default?: unknown }>;
export type LoadPackage = (
  pkg: Pick<ExtensionPackage, "manifest" | "main">,
  expectedId?: string,
) => Promise<ExtensionDefinition>;
type Call = (capability: string, payload?: unknown) => Promise<unknown>;

export const isPackageImport = (url: string) =>
  /^package:sha256:[0-9a-f]{64}$/.test(url);
/** A single `.js` file imported before packages; it is not loaded any more. */
export const isRetiredFileImport = (url: string) =>
  /^imported:sha256:[0-9a-f]{64}$/.test(url);
export const retiredFileImport =
  "这是旧格式的单文件扩展，需要按新格式（manifest.json 与 main.js）重新导入。";
const hashOf = (url: string) => url.slice(prefix.length);
const bytes = (text: string) => new TextEncoder().encode(text);

/** What the user sees as the module's location. */
export const sourceLabel = (url: string) =>
  isPackageImport(url)
    ? `导入的扩展包 · ${hashOf(url).slice(0, 12)}`
    : isRetiredFileImport(url)
      ? "旧格式的单文件扩展"
      : url;

async function sha256(manifestText: string, main: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes(JSON.stringify([manifestText, main])),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function text(file: PackageFile, max: number, limit: string) {
  if (file.data.size > max) throw Error(`${file.path} 超过 ${limit}。`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await file.data.arrayBuffer(),
    );
  } catch {
    throw Error(`${file.path} 不是 UTF-8 文本。`);
  }
}

/** The package's own files: system clutter dropped, one top folder removed. */
function packageFiles(files: PackageFile[]) {
  const named = files
    .map((file) => ({
      ...file,
      path: file.path.replace(/^(?:\.?\/)+/, ""),
    }))
    .filter(
      ({ path }) =>
        !path.startsWith("__MACOSX/") && !/(?:^|\/)\.DS_Store$/.test(path),
    );
  const tops = new Set(named.map(({ path }) => path.split("/")[0]));
  const [top] = tops;
  if (
    tops.size === 1 &&
    !named.some(({ path }) => path === "manifest.json") &&
    named.every(({ path }) => path.includes("/"))
  )
    return named.map((file) => ({
      ...file,
      path: file.path.slice(top.length + 1),
    }));
  return named;
}

/** Reads and checks a package's manifest and main.js; no code runs. */
export async function readPackage(
  files: PackageFile[],
): Promise<ExtensionPackage> {
  const own = packageFiles(files);
  const find = (name: string) => {
    const found = own.filter(({ path }) => path === name);
    if (found.length !== 1)
      throw Error(
        `扩展包须在同一层有一个 manifest.json 和一个 main.js（${found.length ? "多于一个" : "缺少"} ${name}）。`,
      );
    return found[0];
  };
  const manifestFile = find("manifest.json");
  const mainFile = find("main.js");
  const manifestText = await text(manifestFile, MAX_MANIFEST, "64 KiB");
  const main = await text(mainFile, MAX_MAIN, "3 MiB");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw Error("manifest.json 不是有效的 JSON。");
  }
  try {
    validateManifest(manifest);
  } catch (error) {
    // The field, not the contract's English label.
    const field = (error as { detail?: string }).detail;
    throw Error(
      `manifest.json 不是有效的扩展清单${field ? `（${field}）` : ""}。`,
      { cause: error },
    );
  }
  const hash = await sha256(manifestText, main);
  return { manifest, manifestText, main, hash, url: prefix + hash };
}

const PACKAGE_FILE = /(?:^|\/)(?:manifest\.json|main\.js)$/;
/**
 * A zip's `manifest.json` and `main.js` entries, wherever they sit; nothing
 * else is unpacked. fflate loads only when a zip is chosen.
 */
export async function readZip(zip: Blob): Promise<PackageFile[]> {
  const { unzipSync } = await import("fflate");
  let tooLarge: string | undefined;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await zip.arrayBuffer()), {
      filter: ({ name, originalSize }) => {
        if (name.startsWith("__MACOSX/") || !PACKAGE_FILE.test(name))
          return false;
        if (originalSize > MAX_MAIN) tooLarge = name;
        return !tooLarge;
      },
    });
  } catch {
    throw Error("无法读取这个 zip 文件。");
  }
  if (tooLarge) throw Error(`${tooLarge} 超过 3 MiB。`);
  return Object.entries(entries).map(([path, data]) => ({
    path,
    data: new Blob([data as Uint8Array<ArrayBuffer>]),
  }));
}

/**
 * Evaluates main.js. Its top-level code runs now, with the app's full
 * privileges: imports are trusted, not sandboxed. Relative imports inside it
 * cannot resolve from a Blob URL.
 */
const importBlob: Evaluate = async (source) => {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Runs main.js and pairs its `activate` with the manifest it came with. */
export async function loadPackage(
  { manifest, main }: Pick<ExtensionPackage, "manifest" | "main">,
  expectedId?: string,
  evaluate: Evaluate = importBlob,
): Promise<ExtensionDefinition> {
  return definitionOf(manifest, (await evaluate(main)).default, expectedId);
}

/** Packages in the shell's records, one collection each. */
export function packageStore(call: Call) {
  const find = async (hash: string) =>
    (
      (await call("records.list", {
        collection: collection(hash),
      })) as RecordPage
    ).records[0];
  return {
    async read(url: string): Promise<ExtensionPackage> {
      const hash = hashOf(url);
      const stored = await find(hash);
      if (!stored) throw Error("导入的扩展包已丢失，请重新导入。");
      const value = stored.value as {
        version?: unknown;
        manifest?: unknown;
        main?: unknown;
      };
      if (
        value?.version !== 1 ||
        typeof value.manifest !== "string" ||
        typeof value.main !== "string" ||
        (await sha256(value.manifest, value.main)) !== hash
      )
        throw Error("导入的扩展包已损坏，请重新导入。");
      const manifest: unknown = JSON.parse(value.manifest);
      validateManifest(manifest);
      return {
        manifest,
        manifestText: value.manifest,
        main: value.main,
        hash,
        url,
      };
    },
    async write({ hash, manifestText, main }: ExtensionPackage) {
      const stored = await find(hash);
      const value = stored?.value as
        | {
            version?: unknown;
            manifest?: unknown;
            main?: unknown;
          }
        | undefined;
      // The confirmed source repairs a damaged copy at the same address.
      if (
        value?.version === 1 &&
        value.manifest === manifestText &&
        value.main === main
      )
        return;
      await call("state.batch", {
        records: [
          {
            collection: collection(hash),
            id: "package",
            revision: stored?.revision ?? 0,
            value: { version: 1, manifest: manifestText, main },
          },
        ],
      });
    },
    /** Best effort: an unreferenced package is inert. */
    async remove(url: string) {
      try {
        await call("state.batch", { clear: [collection(hashOf(url))] });
      } catch {
        // Kept for a later cleanup; never fail a committed change for it.
      }
    },
  };
}
