import { IMPORT_INVALID, PlumsError } from "../errors.js";
import type { PackageLimits } from "./types.js";

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
    throw importInvalid(`压缩包里的文件路径不能含有反斜杠 \\，请改用 /：${shown}`);
  }
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw importInvalid(`压缩包里的文件路径不能是绝对路径：${shown}`);
  }
  const segments = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (segments.includes("..")) {
    throw importInvalid(`压缩包里的文件路径不能含有 ../，会跑到包目录之外：${shown}`);
  }
  if (segments.some((segment) => segment === "." || segment === "")) {
    throw importInvalid(`压缩包里的文件路径写法不规范（含有 ./ 或连续的 /）：${shown}`);
  }
}

export function importInvalid(message: string): PlumsError {
  return new PlumsError({ code: IMPORT_INVALID, message });
}

function shorten(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
