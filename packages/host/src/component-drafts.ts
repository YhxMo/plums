import { existsSync } from "node:fs";
import { constants } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  lstat,
  realpath,
  rm,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  createArchive,
  validatePackage,
  DEFAULT_PACKAGE_LIMITS,
  PlumsError,
  IMPORT_INVALID,
  type PackageFiles,
} from "@plums/core";
import { safePath } from "@plums/sdk";
import { SecureFsSink } from "./io.js";
import { digest, type ComponentArtifact } from "./library.js";

export type ComponentSource =
  | { kind: "library"; digest: string }
  | { kind: "agent"; instanceId: string; packageId: string };
export interface ComponentInspection {
  source: ComponentSource;
  baseDigest: string;
  manifestText: string;
  files: { path: string; size: number }[];
  suggestedVersion: string;
}
export interface ComponentDraft extends ComponentInspection {
  token: string;
  revision: string;
  editor?: ComponentEditorState;
}
export interface ComponentEditorState {
  manifestText: string;
  payloadText: string;
  tab: "manifest" | "payload" | "files";
  revision: string;
}
export interface DraftMetadata {
  source: ComponentSource;
  baseDigest: string;
  suggestedVersion: string;
  editor?: ComponentEditorState;
}
export function draftError(
  message: string,
  reason: string,
  at?: string,
): never {
  throw new PlumsError({
    code: IMPORT_INVALID,
    message,
    ...(at ? { path: at } : {}),
    details: { reason },
  });
}
export function checkDraftText(text: string, secrets: readonly string[]): void {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text) > DEFAULT_PACKAGE_LIMITS.maxTotalBytes
  )
    draftError("内容超过大小上限。", "DRAFT_LIMIT");
  if (
    secrets
      .filter(Boolean)
      .some(
        (s) =>
          text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1)),
      )
  )
    draftError("内容包含已保存的密钥，请移除后再继续。", "SECRET_IN_CONTENT");
}

/** Only private working copies are writable. On macOS use the same directory-handle
 * adapter as desktop I/O, including its no-symlink and bounded-read checks. */
export class ComponentDrafts {
  private native = new SecureFsSink(
    existsSync(fileURLToPath(new URL("./secure-fs", import.meta.url)))
      ? fileURLToPath(new URL("./secure-fs", import.meta.url))
      : fileURLToPath(new URL("../dist/secure-fs", import.meta.url)),
  );
  private canonicalRoot?: string;
  private queues = new Map<string, Promise<unknown>>();
  constructor(private root: string) {}
  serial<T>(token: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(token) ?? Promise.resolve()).then(fn, fn);
    this.queues.set(token, run);
    void run
      .finally(() => {
        if (this.queues.get(token) === run) this.queues.delete(token);
      })
      .catch(() => {});
    return run;
  }
  private async directory(token?: string) {
    if (token !== undefined && !/^[a-f0-9-]{36}$/.test(token))
      draftError("草稿不存在。", "DRAFT_MISSING");
    if (!this.canonicalRoot) {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      if ((await lstat(this.root)).isSymbolicLink())
        draftError("草稿目录无效。", "DRAFT_PATH");
      this.canonicalRoot = await realpath(this.root);
    }
    const dir = token
      ? path.join(this.canonicalRoot, token)
      : this.canonicalRoot;
    if ((await lstat(dir)).isSymbolicLink() || (await realpath(dir)) !== dir)
      draftError("草稿目录无效。", "DRAFT_PATH");
    return dir;
  }
  private async portablePath(root: string, relative: string) {
    let current = root;
    if (
      (await lstat(current)).isSymbolicLink() ||
      (await realpath(current)) !== root
    )
      draftError("工作副本路径无效。", "DRAFT_PATH");
    for (const part of relative === "." ? [] : safePath(relative).split("/")) {
      current = path.join(current, part);
      const st = await lstat(current);
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory()))
        draftError("工作副本只能包含普通文件和目录。", "DRAFT_PATH");
    }
    return current;
  }
  private async read(root: string, relative: string): Promise<Uint8Array> {
    try {
      if (process.platform === "darwin")
        return await this.native.read({
          rootPath: root,
          path: path.join(root, safePath(relative)),
        });
      const file = await open(
        await this.portablePath(root, relative),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const st = await file.stat();
        if (!st.isFile() || st.size > DEFAULT_PACKAGE_LIMITS.maxTotalBytes)
          throw Error();
        const bytes = await file.readFile();
        if (bytes.length > DEFAULT_PACKAGE_LIMITS.maxTotalBytes) throw Error();
        return bytes;
      } finally {
        await file.close();
      }
    } catch {
      return draftError(
        "工作副本无法读取，请检查路径、文件类型和大小。",
        "DRAFT_READ",
      );
    }
  }
  private async write(
    root: string,
    relative: string,
    text: string,
    create = false,
  ) {
    try {
      if (process.platform === "darwin") {
        await this.native.write({
          rootPath: root,
          path: path.join(root, safePath(relative)),
          data: Buffer.from(text),
        });
        return;
      }
      const target = create
        ? path.join(await this.portablePath(root, "."), safePath(relative))
        : await this.portablePath(root, relative);
      const file = await open(
        target,
        constants.O_WRONLY |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK |
          (create ? constants.O_CREAT | constants.O_EXCL : 0),
        0o600,
      );
      try {
        if (!(await file.stat()).isFile()) throw Error();
        await file.truncate(0);
        await file.writeFile(text);
        await file.sync();
      } finally {
        await file.close();
      }
    } catch {
      draftError("工作副本无法写入，请检查路径和文件类型。", "DRAFT_WRITE");
    }
  }
  private async stored(token: string): Promise<
    Omit<DraftMetadata, "editor"> & {
      editor?: {
        manifestFile: string;
        payloadFile: string;
        tab: ComponentEditorState["tab"];
        revision: string;
      };
    }
  > {
    const root = await this.directory(token);
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await this.read(root, "draft.json"),
        ),
      );
    } catch {
      return draftError("草稿记录无法读取。", "DRAFT_MISSING");
    }
  }
  async metadata(token: string): Promise<DraftMetadata> {
    const stored = await this.stored(token),
      { editor: refs, ...meta } = stored;
    if (!refs) return meta;
    if (
      ![refs.manifestFile, refs.payloadFile].every((p) =>
        /^editor-[a-f0-9-]{36}-(manifest|payload)\.json$/.test(p),
      )
    )
      draftError("草稿编辑记录无效。", "DRAFT_MISSING");
    const root = await this.directory(token),
      decoder = new TextDecoder("utf-8", { fatal: true });
    return {
      ...meta,
      editor: {
        tab: refs.tab,
        revision: refs.revision,
        manifestText: decoder.decode(await this.read(root, refs.manifestFile)),
        payloadText: decoder.decode(await this.read(root, refs.payloadFile)),
      },
    };
  }
  private async writeMetadata(
    token: string,
    meta: Awaited<ReturnType<ComponentDrafts["stored"]>>,
  ) {
    const root = await this.directory(token),
      pending = `metadata-${randomUUID()}.json`;
    await this.write(root, pending, JSON.stringify(meta), true);
    await this.directory(token);
    await rename(path.join(root, pending), path.join(root, "draft.json"));
  }
  async setEditor(token: string, editor: ComponentEditorState) {
    const meta = await this.stored(token),
      root = await this.directory(token),
      id = randomUUID();
    const manifestFile = `editor-${id}-manifest.json`,
      payloadFile = `editor-${id}-payload.json`;
    await this.write(root, manifestFile, editor.manifestText, true);
    await this.write(root, payloadFile, editor.payloadText, true);
    const previous = meta.editor;
    meta.editor = {
      manifestFile,
      payloadFile,
      tab: editor.tab,
      revision: editor.revision,
    };
    await this.writeMetadata(token, meta);
    if (previous)
      for (const name of [previous.manifestFile, previous.payloadFile])
        if (/^editor-[a-f0-9-]{36}-(manifest|payload)\.json$/.test(name))
          await rm(path.join(root, name), { force: true });
  }
  async rebase(
    token: string,
    artifact: ComponentArtifact,
    suggestedVersion: string,
  ) {
    const meta = await this.stored(token);
    meta.baseDigest = digest(artifact.bytes);
    meta.suggestedVersion = suggestedVersion;
    if (meta.source.kind === "library") meta.source.digest = meta.baseDigest;
    delete meta.editor;
    await this.writeMetadata(token, meta);
  }
  async create(
    meta: DraftMetadata,
    artifact: ComponentArtifact,
  ): Promise<string> {
    const root = await this.directory(),
      token = randomUUID(),
      dir = path.join(root, token);
    await mkdir(path.join(dir, "package"), { recursive: true, mode: 0o700 });
    try {
      const files = {
        "manifest.json": (await validatePackage(artifact.bytes)).manifestBytes,
        ...artifact.contents.files,
      };
      for (const [name, bytes] of Object.entries(files)) {
        const filename = path.join(dir, "package", safePath(name));
        await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
        const file = await open(filename, "wx", 0o600);
        try {
          await file.writeFile(bytes);
        } finally {
          await file.close();
        }
      }
      const file = await open(path.join(dir, "draft.json"), "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(meta));
      } finally {
        await file.close();
      }
      return token;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
  async find(source: ComponentSource): Promise<string | undefined> {
    const root = await this.directory();
    for (const token of await readdir(root)) {
      if (!/^[a-f0-9-]{36}$/.test(token)) continue;
      let meta: DraftMetadata;
      try {
        meta = await this.metadata(token);
      } catch {
        continue;
      }
      if (JSON.stringify(meta.source) === JSON.stringify(source)) return token;
    }
    return undefined;
  }
  async files(token: string): Promise<PackageFiles> {
    const root = path.join(await this.directory(token), "package");
    const files: PackageFiles = Object.create(null),
      limits = DEFAULT_PACKAGE_LIMITS;
    let total = 0,
      entries = 0,
      fileCount = 0;
    const walk = async (relative: string): Promise<void> => {
      const location = {
        rootPath: root,
        path: relative ? path.join(root, relative) : root,
      };
      const items =
        process.platform === "darwin"
          ? await this.native.list(location)
          : await Promise.all(
              (
                await readdir(await this.portablePath(root, relative || "."))
              ).map(async (name) => {
                const st = await lstat(path.join(location.path, name));
                return {
                  name,
                  type: st.isFile()
                    ? "file"
                    : st.isDirectory()
                      ? "directory"
                      : "other",
                };
              }),
            );
      if (
        fileCount + items.filter((item) => item.type === "file").length >
        limits.maxFiles
      )
        draftError("工作副本文件数量超过上限。", "DRAFT_LIMIT");
      for (const item of items) {
        const name = relative ? `${relative}/${item.name}` : item.name;
        safePath(name);
        if (
          ++entries > limits.maxFiles * limits.maxPathLength ||
          name.length > limits.maxPathLength
        )
          draftError("工作副本文件数量或路径超过上限。", "DRAFT_LIMIT");
        if (item.type === "directory") await walk(name);
        else if (item.type === "file") {
          const bytes = await this.read(root, name);
          total += bytes.length;
          if (++fileCount > limits.maxFiles || total > limits.maxTotalBytes)
            draftError("工作副本内容超过大小或数量上限。", "DRAFT_LIMIT");
          files[name] = bytes;
        } else draftError("工作副本只能包含普通文件和目录。", "DRAFT_PATH");
      }
    };
    try {
      await walk("");
    } catch (e) {
      if (e instanceof PlumsError) throw e;
      draftError("工作副本无法读取，请检查路径和文件类型。", "DRAFT_READ");
    }
    return files;
  }
  async view(
    token: string,
    secrets: readonly string[],
  ): Promise<ComponentDraft> {
    const meta = await this.metadata(token),
      files = await this.files(token);
    await createArchive(files, DEFAULT_PACKAGE_LIMITS, secrets);
    if (!files["manifest.json"])
      draftError("工作副本缺少 manifest.json。", "DRAFT_MANIFEST");
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
      files["manifest.json"],
    );
    if (meta.editor) {
      checkDraftText(meta.editor.manifestText, secrets);
      checkDraftText(meta.editor.payloadText, secrets);
    }
    return {
      token,
      source: meta.source,
      baseDigest: meta.baseDigest,
      suggestedVersion: meta.suggestedVersion,
      manifestText,
      revision: digest(files["manifest.json"]),
      editor: meta.editor,
      files: Object.entries(files)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, bytes]) => ({ path, size: bytes.length })),
    };
  }
  async writeManifest(token: string, text: string, revision: string) {
    const root = path.join(await this.directory(token), "package");
    if (digest(await this.read(root, "manifest.json")) !== revision)
      draftError(
        "manifest.json 已被外部修改，请选择采用哪份内容。",
        "DRAFT_CONFLICT",
        "/manifest.json",
      );
    await this.write(root, "manifest.json", text);
  }
  async reveal(token: string, relative?: string): Promise<string> {
    const root = path.join(await this.directory(token), "package");
    if (relative === undefined) {
      await this.portablePath(root, ".");
      return root;
    }
    safePath(relative);
    await this.portablePath(root, relative);
    return path.join(root, relative);
  }
  async discard(token: string) {
    await rm(await this.directory(token), { recursive: true, force: true });
  }
}
