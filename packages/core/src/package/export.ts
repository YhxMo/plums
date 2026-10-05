import { writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { encodeArchive } from "./archive.js";
import {
  assertNoPathConflict,
  assertSafeEntryPath,
  importInvalid,
} from "./entry-path.js";
import { checkManifest } from "./manifest.js";
import { MANIFEST_FILE, type Manifest, type PackageLimits } from "./types.js";

export interface ExportInput {
  manifest: Manifest;
  /** Extra files by relative path. Strings are written as UTF-8. Must not include `manifest.json`. */
  files?: Record<string, Uint8Array | string>;
}

export interface ExportOptions {
  /** When set, the zip is also written to this file. */
  outPath?: string;
}

const FIXED_MTIME = new Date(1980, 0, 1);

/**
 * Builds the zip bytes. Same input always gives the same bytes. Throws IMPORT_INVALID when
 * paths collide (same check as import) or a file name, file or the manifest contains one of
 * `secrets` (known secret values).
 */
export async function exportPackage(
  input: ExportInput,
  limits: PackageLimits,
  options: ExportOptions = {},
  secrets: readonly string[] = [],
): Promise<Uint8Array> {
  const { manifestBytes, files } = preparePackage(input, limits, secrets);
  const bytes = await encodeArchive(
    [[MANIFEST_FILE, manifestBytes], ...files],
    FIXED_MTIME,
  );
  if (options.outPath !== undefined) {
    await writeFile(options.outPath, bytes);
  }
  return bytes;
}

/** Normalize and check package contents without encoding an archive. */
export function preparePackage(
  input: ExportInput,
  limits: PackageLimits,
  secrets: readonly string[] = [],
) {
  const manifestText = serializeManifest(input.manifest);
  const manifest = checkManifest(JSON.parse(manifestText));
  const manifestBytes = Buffer.from(manifestText, "utf8");

  const files = Object.entries(input.files ?? {}).map(
    ([path, data]) =>
      [
        path,
        typeof data === "string"
          ? Buffer.from(data, "utf8")
          : Buffer.from(data),
      ] as const,
  );
  if (files.length + 1 > limits.maxFiles) {
    throw importInvalid(`要导出的文件太多了（超过 ${limits.maxFiles} 个）。`);
  }
  let total = Buffer.byteLength(manifestText);
  for (const [filePath, data] of files) {
    assertSafeEntryPath(filePath, limits);
    if (filePath === MANIFEST_FILE) {
      // Why a path: a case-different alias is already IMPORT_INVALID at that entry
      // (for example `/MANIFEST.JSON`). The exact name is the same kind of pointer.
      throw importInvalid(
        "files 里不能放 manifest.json，它由 manifest 生成。",
        filePath,
      );
    }
    if (filePath.endsWith("/")) {
      throw importInvalid(
        `files 里的路径必须是文件，不能以 / 结尾：${filePath}`,
      );
    }
    total += data.length;
  }
  assertNoPathConflict([MANIFEST_FILE, ...files.map(([filePath]) => filePath)]);
  // The JSON-escaped form is what a value with quotes or non-ASCII characters looks like in manifest.json.
  const needles = secrets
    .filter((s) => s !== "")
    .flatMap((s) => [s, JSON.stringify(s).slice(1, -1)]);
  for (const [path, data] of [
    [MANIFEST_FILE, manifestBytes] as const,
    ...files,
  ]) {
    if (
      needles.some((needle) => path.includes(needle) || data.includes(needle))
    ) {
      throw importInvalid(
        `没有导出：${path} 里含有已保存的密钥。密钥不能放进包里，请先把它去掉。`,
      );
    }
  }
  if (total > limits.maxTotalBytes) {
    throw importInvalid("要导出的内容超过了大小上限，导入时会被拒绝。");
  }

  return { manifest, manifestBytes, files };
}

function serializeManifest(manifest: Manifest): string {
  let text: string | undefined;
  try {
    text = JSON.stringify(manifest, null, 2);
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    throw importInvalid("manifest 无法转成 JSON。");
  }
  return `${text}\n`;
}
