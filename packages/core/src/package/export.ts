import { writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { ZipFile } from "yazl";
import { assertSafeEntryPath, importInvalid } from "./entry-path.js";
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

/** Builds the zip bytes. Same input always gives the same bytes. */
export async function exportPackage(
  input: ExportInput,
  limits: PackageLimits,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const manifestText = serializeManifest(input.manifest);
  checkManifest(JSON.parse(manifestText));

  const files = Object.entries(input.files ?? {}).map(
    ([path, data]) => [path, typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data)] as const,
  );
  if (files.length + 1 > limits.maxFiles) {
    throw importInvalid(`要导出的文件太多了（超过 ${limits.maxFiles} 个）。`);
  }
  const seen = new Set<string>();
  let total = Buffer.byteLength(manifestText);
  for (const [path, data] of files) {
    assertSafeEntryPath(path, limits);
    if (path === MANIFEST_FILE) {
      throw importInvalid("files 里不能放 manifest.json，它由 manifest 生成。");
    }
    if (path.endsWith("/")) {
      throw importInvalid(`files 里的路径必须是文件，不能以 / 结尾：${path}`);
    }
    if (seen.has(path)) {
      throw importInvalid(`重复的文件路径：${path}`);
    }
    seen.add(path);
    total += data.length;
  }
  if (total > limits.maxTotalBytes) {
    throw importInvalid("要导出的内容超过了大小上限，导入时会被拒绝。");
  }

  const zip = new ZipFile();
  const done = collectOutput(zip);
  zip.addBuffer(Buffer.from(manifestText, "utf8"), MANIFEST_FILE, { mtime: FIXED_MTIME });
  for (const [path, data] of files) {
    zip.addBuffer(data, path, { mtime: FIXED_MTIME });
  }
  zip.end();
  const bytes = await done;

  if (options.outPath !== undefined) {
    await writeFile(options.outPath, bytes);
  }
  return bytes;
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

function collectOutput(zip: ZipFile): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });
}
