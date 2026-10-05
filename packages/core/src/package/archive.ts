import { ZipFile } from "yazl";
import { readZipEntries } from "./read-zip.js";
import {
  assertNoPathConflict,
  assertSafeEntryPath,
  importInvalid,
} from "./entry-path.js";
import {
  DEFAULT_PACKAGE_LIMITS,
  type PackageFiles,
  type PackageLimits,
} from "./types.js";

/** Bounded archive I/O shared by desktop bundles and ordinary packages. No extraction. */
export async function readArchive(
  input: Uint8Array | string,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<PackageFiles> {
  return (await readArchiveDetails(input, limits)).files;
}
export async function readArchiveDetails(
  input: Uint8Array | string,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<{ files: PackageFiles; totalFiles: number; totalBytes: number }> {
  const entries = await readZipEntries(input, limits);
  return {
    files: Object.fromEntries(entries.map((e) => [e.path, e.data])),
    ...entries.statistics,
  };
}
export async function createArchive(
  files: PackageFiles,
  limits: PackageLimits = DEFAULT_PACKAGE_LIMITS,
  secrets: readonly string[] = [],
): Promise<Uint8Array> {
  const entries = Object.entries(files);
  if (entries.length > limits.maxFiles)
    throw importInvalid("文件数量超过上限。");
  let total = 0;
  for (const [p, b] of entries) {
    assertSafeEntryPath(p, limits);
    if (p.endsWith("/")) throw importInvalid("文件路径不能表示目录。");
    total += b.length;
    if (total > limits.maxTotalBytes) throw importInvalid("内容超过大小上限。");
    if (
      secrets
        .filter(Boolean)
        .some(
          (s) =>
            p.includes(s) ||
            Buffer.from(b).includes(s) ||
            Buffer.from(b).includes(JSON.stringify(s).slice(1, -1)),
        )
    )
      throw importInvalid("内容包含密钥，无法导出。");
  }
  assertNoPathConflict(entries.map(([p]) => p));
  return encodeArchive(entries, new Date("1980-01-01T00:00:00Z"));
}

/** Internal encoder; callers check contents and choose their existing timestamp. */
export function encodeArchive(
  entries: readonly (readonly [string, Uint8Array])[],
  mtime: Date,
): Promise<Uint8Array> {
  const zip = new ZipFile();
  const result = new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (b: Buffer) => chunks.push(b));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () =>
      resolve(new Uint8Array(Buffer.concat(chunks))),
    );
  });
  for (const [p, b] of entries)
    zip.addBuffer(Buffer.from(b), p, {
      mtime,
    });
  zip.end();
  return result;
}
