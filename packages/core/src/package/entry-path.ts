import { IMPORT_INVALID, PlumsError } from "../errors.js";
import { MANIFEST_FILE, type PackageLimits } from "./types.js";

/** Throws IMPORT_INVALID when an entry name could escape the package directory. */
export function assertSafeEntryPath(name: string, limits: PackageLimits): void {
  const shown = shorten(name);
  if (name.length === 0) {
    throw importInvalid("压缩包里有一个文件没有名字。");
  }
  if (name.length > limits.maxPathLength) {
    throw importInvalid(
      `压缩包里有文件路径超过 ${limits.maxPathLength} 个字符：${shown}`,
    );
  }
  if (name.includes("\0")) {
    throw importInvalid(`压缩包里的文件名含有非法字符：${shown}`);
  }
  if (name.includes("\\")) {
    throw importInvalid(
      `压缩包里的文件路径不能含有反斜杠 \\，请改用 /：${shown}`,
    );
  }
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw importInvalid(`压缩包里的文件路径不能是绝对路径：${shown}`);
  }
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (segments.includes("..")) {
    throw importInvalid(
      `压缩包里的文件路径不能含有 ../，会跑到包目录之外：${shown}`,
    );
  }
  if (segments.some((segment) => segment === "." || segment === "")) {
    throw importInvalid(
      `压缩包里的文件路径写法不规范（含有 ./ 或连续的 /）：${shown}`,
    );
  }
}

export function importInvalid(message: string, entry?: string): PlumsError {
  return new PlumsError({
    code: IMPORT_INVALID,
    message,
    ...(entry === undefined
      ? {}
      : { path: `/${entry.replaceAll("~", "~0").replaceAll("/", "~1")}` }),
  });
}

interface SeenPath {
  name: string;
  directory: boolean;
}

/**
 * One check for import and export. Rejects a repeated path, two paths that differ
 * only by case, a name that would overwrite `manifest.json` on a case-insensitive
 * disk, and a path that is both a file and a directory.
 */
export function assertNoPathConflict(paths: readonly string[]): void {
  const seen = new Map<string, SeenPath>();
  const files = new Map<string, string>();
  for (const raw of paths) {
    const directory = raw.endsWith("/");
    const name = directory ? raw.slice(0, -1) : raw;
    const key = name.toLowerCase();
    if (key === MANIFEST_FILE && name !== MANIFEST_FILE) {
      throw importInvalid(`压缩包里的「${name}」会盖住 manifest.json。`, name);
    }
    const previous = seen.get(key);
    if (previous !== undefined) {
      if (previous.directory !== directory) {
        const fileName = previous.directory ? name : previous.name;
        throw importInvalid(`压缩包里「${fileName}」既是文件又是文件夹。`);
      }
      if (previous.name === name) {
        throw importInvalid(`压缩包里有重复的文件路径：${name}`);
      }
      throw importInvalid(
        `压缩包里「${previous.name}」和「${name}」只是大小写不同，在不区分大小写的磁盘上会互相覆盖。`,
        name,
      );
    }
    seen.set(key, { name, directory });
    if (!directory) files.set(key, name);
  }
  for (const raw of paths) {
    const name = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = files.get(parts.slice(0, index).join("/").toLowerCase());
      if (parent !== undefined) {
        throw importInvalid(`压缩包里「${parent}」既是文件又是文件夹。`);
      }
    }
  }
}

function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
