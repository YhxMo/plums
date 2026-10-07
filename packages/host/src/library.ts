import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import {
  validatePackage,
  createArchive,
  DEFAULT_PACKAGE_LIMITS,
  PlumsError,
  IMPORT_INVALID,
  type PackageContents,
  type Manifest,
} from "@plums/core";
import { desktopContribution } from "@plums/sdk";
export interface LibraryItem {
  digest: string;
  manifest: Manifest;
  createdAt: string;
}
export interface ComponentArtifact {
  bytes: Uint8Array;
  contents: PackageContents;
}
export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function importInvalid(message: string): never {
  throw new PlumsError({ code: IMPORT_INVALID, message });
}
export async function inputBytes(
  input: string | Uint8Array,
): Promise<Uint8Array> {
  if (typeof input !== "string") {
    if (!(input instanceof Uint8Array)) importInvalid("导入文件无效。");
    if (input.length > DEFAULT_PACKAGE_LIMITS.maxTotalBytes * 2)
      importInvalid("导入文件过大。");
    return new Uint8Array(input);
  }
  const { open } = await import("node:fs/promises");
  const file = await open(input, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > DEFAULT_PACKAGE_LIMITS.maxTotalBytes * 2)
      importInvalid("导入文件过大或不是普通文件。");
    const bytes = await file.readFile();
    if (bytes.length > DEFAULT_PACKAGE_LIMITS.maxTotalBytes * 2)
      importInvalid("导入文件过大。");
    return bytes;
  } finally {
    await file.close();
  }
}
function objectJson(bytes: Uint8Array): Record<string, unknown> {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (value && typeof value === "object" && !Array.isArray(value))
      return value;
  } catch {
    /* report a fixed error */
  }
  return importInvalid("角色卡需要有效的 JSON 对象。");
}
export function pngRole(bytes: Uint8Array): Record<string, unknown> {
  const b = Buffer.from(bytes),
    signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!b.subarray(0, 8).equals(signature)) importInvalid("PNG 文件头无效。");
  const cards = new Map<string, Buffer>();
  let at = 8,
    ended = false,
    first = true,
    imageData = false;
  while (at < b.length) {
    if (at + 12 > b.length) importInvalid("PNG 数据被截断。");
    const size = b.readUInt32BE(at),
      end = at + size + 12;
    if (end > b.length) importInvalid("PNG 数据被截断。");
    const type = b.toString("ascii", at + 4, at + 8),
      data = b.subarray(at + 8, end - 4);
    let crc = 0xffffffff;
    for (const octet of b.subarray(at + 4, end - 4)) {
      crc ^= octet;
      for (let j = 0; j < 8; j++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if (~crc >>> 0 !== b.readUInt32BE(end - 4)) importInvalid("PNG 校验失败。");
    if (
      first &&
      (type !== "IHDR" ||
        size !== 13 ||
        !data.readUInt32BE(0) ||
        !data.readUInt32BE(4))
    )
      importInvalid("PNG 缺少有效图像头。");
    first = false;
    if (type === "IDAT") imageData = true;
    if (type === "tEXt") {
      const zero = data.indexOf(0),
        key = data.subarray(0, zero).toString("ascii");
      if (zero > 0 && ["chara", "ccv3"].includes(key)) {
        if (cards.has(key)) importInvalid("PNG 角色数据重复。");
        cards.set(key, data.subarray(zero + 1));
      }
    }
    at = end;
    if (type === "IEND") {
      if (size || at !== b.length) importInvalid("PNG 结束标记无效。");
      ended = true;
      break;
    }
  }
  if (!ended || !imageData) importInvalid("PNG 数据被截断。");
  const card = cards.get("ccv3") ?? cards.get("chara");
  if (!card) importInvalid("PNG 中没有角色数据。");
  const encoded = card.toString("ascii");
  if (
    card.some((v) => v > 127) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    ) ||
    Buffer.byteLength(encoded, "ascii") !== card.length ||
    !encoded
  )
    importInvalid("PNG 角色数据编码无效。");
  return objectJson(Buffer.from(encoded, "base64"));
}
export async function rawCharacter(
  bytes: Uint8Array,
  filename = "角色卡",
): Promise<ComponentArtifact> {
  if (bytes.length > DEFAULT_PACKAGE_LIMITS.maxTotalBytes)
    importInvalid("角色卡超过大小限制。");
  const png = bytes[0] === 137;
  const payload = png ? pngRole(bytes) : objectJson(bytes);
  const manifest: Manifest = {
    formatVersion: "2.0",
    kind: "character",
    id: "card-" + digest(bytes).slice(0, 59),
    name:
      path
        .basename(filename)
        .replace(/\.(json|png)$/i, "")
        .slice(0, 256) || "角色卡",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [],
    payload,
  };
  const packaged = await createArchive(
    {
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
      [png ? "source/card.png" : "source/card.json"]: bytes,
    },
    DEFAULT_PACKAGE_LIMITS,
  );
  return { bytes: packaged, contents: await validatePackage(packaged) };
}
export async function componentArtifact(
  bytes: Uint8Array,
): Promise<ComponentArtifact> {
  const fixed = new Uint8Array(bytes);
  const contents = await validatePackage(fixed);
  desktopContribution(contents.manifest, contents.files);
  return { bytes: fixed, contents };
}
export class ComponentLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private file() {
    return path.join(this.root, "index.json");
  }
  async initialize() {
    await mkdir(path.join(this.root, "objects"), { recursive: true });
    for (const name of await readdir(this.root))
      if (name.startsWith(".staging-"))
        await rm(path.join(this.root, name), { recursive: true, force: true });
    const index = await this.list();
    for (const file of await readdir(path.join(this.root, "objects")))
      if (
        /^[a-f0-9]{64}\.zip$/.test(file) &&
        !index.some((i) => i.digest + ".zip" === file)
      )
        await rm(path.join(this.root, "objects", file), { force: true });
  }
  async list(): Promise<LibraryItem[]> {
    try {
      return JSON.parse(await readFile(this.file(), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw Error("组件库无法读取。");
    }
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
  async put(artifacts: ComponentArtifact[]): Promise<LibraryItem[]> {
    return this.serial(async () => {
      const index = await this.list(),
        result: LibraryItem[] = [],
        staging = path.join(this.root, ".staging-" + randomUUID());
      await mkdir(staging);
      try {
        for (const artifact of artifacts) {
          const hash = digest(artifact.bytes);
          let item = index.find((i) => i.digest === hash);
          if (!item) {
            item = {
              digest: hash,
              manifest: artifact.contents.manifest,
              createdAt: new Date().toISOString(),
            };
            await writeFile(path.join(staging, hash), artifact.bytes);
            await rename(
              path.join(staging, hash),
              path.join(this.root, "objects", hash + ".zip"),
            );
            index.push(item);
          }
          result.push(item);
        }
        await writeFile(
          path.join(staging, "index.json"),
          JSON.stringify(index),
        );
        await rename(path.join(staging, "index.json"), this.file());
        return result;
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }
  async get(hash: string): Promise<ComponentArtifact> {
    if (
      typeof hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(hash) ||
      !(await this.list()).some((i) => i.digest === hash)
    )
      importInvalid("组件不存在。");
    const bytes = await inputBytes(
      path.join(this.root, "objects", hash + ".zip"),
    );
    if (digest(bytes) !== hash) importInvalid("组件内容校验失败。");
    return componentArtifact(bytes);
  }
  async remove(
    hash: string,
    referenced: () => Promise<boolean>,
  ): Promise<void> {
    return this.serial(async () => {
      if (await referenced())
        importInvalid("此组件仍被 Agent 使用，请先从 Agent 移除。");
      const index = await this.list();
      if (!index.some((i) => i.digest === hash)) importInvalid("组件不存在。");
      const pending = path.join(this.root, ".staging-" + randomUUID());
      await mkdir(pending);
      try {
        await writeFile(
          path.join(pending, "index.json"),
          JSON.stringify(index.filter((i) => i.digest !== hash)),
        );
        await rename(path.join(pending, "index.json"), this.file());
      } finally {
        await rm(pending, { recursive: true, force: true });
      }
      await rm(path.join(this.root, "objects", hash + ".zip"), { force: true });
    });
  }
}
