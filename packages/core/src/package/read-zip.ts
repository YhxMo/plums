import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { PlumsError } from "../errors.js";
import { assertSafeEntryPath, importInvalid } from "./entry-path.js";
import type { PackageLimits } from "./types.js";

export interface ZipEntryData {
  path: string;
  data: Uint8Array;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Reads every file entry of a zip into memory without writing anything.
 * Sizes are counted while inflating, and reading stops at the limit, so a zip bomb
 * is never fully decompressed. Anything wrong throws IMPORT_INVALID.
 */
export async function readZipEntries(
  input: Uint8Array | string,
  limits: PackageLimits,
): Promise<ZipEntryData[]> {
  const zip = await openZip(input);
  try {
    const entries = await listEntries(zip, limits);
    return await readEntries(zip, entries, limits);
  } finally {
    zip.close();
  }
}

function openZip(input: Uint8Array | string): Promise<yauzl.ZipFile> {
  const options = { lazyEntries: true, decodeStrings: false, autoClose: false } as const;
  return new Promise((resolve, reject) => {
    const done = (err: Error | null, zip?: yauzl.ZipFile): void => {
      if (err !== null || zip === undefined) {
        reject(
          typeof input === "string" && isFileSystemError(err)
            ? importInvalid(`读不到这个文件：${input}`)
            : importInvalid("这不是一个有效的 zip 压缩包，或者文件已损坏。"),
        );
        return;
      }
      resolve(zip);
    };
    if (typeof input === "string") {
      yauzl.open(input, options, done);
    } else {
      yauzl.fromBuffer(Buffer.from(input.buffer, input.byteOffset, input.byteLength), options, done);
    }
  });
}

function isFileSystemError(err: Error | null): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^E[A-Z]+$/.test(code);
}

interface PendingEntry {
  path: string;
  entry: yauzl.Entry;
}

async function listEntries(zip: yauzl.ZipFile, limits: PackageLimits): Promise<PendingEntry[]> {
  if (zip.entryCount > limits.maxFiles) {
    throw importInvalid(`压缩包里的文件太多了（超过 ${limits.maxFiles} 个）。`);
  }
  const seen = new Set<string>();
  const out: PendingEntry[] = [];
  let declaredTotal = 0;

  await new Promise<void>((resolve, reject) => {
    zip.on("error", () => reject(importInvalid("压缩包已损坏，无法读取文件列表。")));
    zip.on("end", () => resolve());
    zip.on("entry", (entry: yauzl.Entry) => {
      try {
        const path = decodeName(entry.fileName);
        assertSafeEntryPath(path, limits);
        if (isSymlink(entry)) {
          throw importInvalid(`压缩包里不允许符号链接：${path}`);
        }
        if (seen.has(path)) {
          throw importInvalid(`压缩包里有重复的文件路径：${path}`);
        }
        seen.add(path);
        declaredTotal += entry.uncompressedSize;
        if (declaredTotal > limits.maxTotalBytes) {
          throw tooLarge(limits);
        }
        if (!path.endsWith("/")) {
          out.push({ path, entry });
        }
        zip.readEntry();
      } catch (err) {
        reject(err);
      }
    });
    zip.readEntry();
  });
  return out;
}

async function readEntries(
  zip: yauzl.ZipFile,
  entries: PendingEntry[],
  limits: PackageLimits,
): Promise<ZipEntryData[]> {
  const out: ZipEntryData[] = [];
  let total = 0;
  for (const { path, entry } of entries) {
    const stream = await openEntry(zip, entry, path);
    const chunks: Buffer[] = [];
    await collect(stream, path, (chunk) => {
      total += chunk.length;
      if (total > limits.maxTotalBytes) {
        throw tooLarge(limits);
      }
      chunks.push(chunk);
    });
    out.push({ path, data: new Uint8Array(Buffer.concat(chunks)) });
  }
  return out;
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, path: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err !== null || stream === undefined) {
        reject(importInvalid(`压缩包里的文件无法解压（可能已加密或损坏）：${path}`));
        return;
      }
      resolve(stream);
    });
  });
}

function collect(stream: Readable, path: string, onChunk: (chunk: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      stream.destroy();
      reject(err instanceof PlumsError ? err : importInvalid(`压缩包里的文件已损坏，或解压出来的实际大小和声明的不一致：${path}`));
    };
    stream.on("data", (chunk: Buffer) => {
      try {
        onChunk(chunk);
      } catch (err) {
        fail(err);
      }
    });
    stream.on("error", fail);
    stream.on("end", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}

function decodeName(raw: string | Buffer): string {
  if (typeof raw === "string") {
    return raw;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    throw importInvalid("压缩包里有文件名不是 UTF-8 编码，无法读取。");
  }
}

function isSymlink(entry: yauzl.Entry): boolean {
  const madeByUnix = entry.versionMadeBy >> 8 === 3;
  return madeByUnix && ((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK;
}

function tooLarge(limits: PackageLimits): PlumsError {
  const mb = limits.maxTotalBytes / (1024 * 1024);
  const size = Number.isInteger(mb) ? `${mb} MB` : `${limits.maxTotalBytes} 字节`;
  return importInvalid(`压缩包解压后的总大小超过 ${size}，已停止导入。`);
}
