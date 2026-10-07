import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PERMISSION_DENIED, PlumsError } from "../errors.js";
import type { FsLocation } from "./types.js";

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}
function denied(at: string): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "路径不存在、类型不符或超出绑定目录，这次调用没有执行。",
    path: at,
    details: { reason: "PATH_NOT_ALLOWED" },
  });
}

/** Metadata only. The sink remains responsible for enforcing this boundary during I/O. */
export async function resolveLocation(
  root: string,
  relative: string,
  operation: "read" | "write" | "list" | "cwd",
): Promise<FsLocation> {
  const at = operation === "cwd" ? "/request/cwd/path" : "/request/path";
  try {
    const rootPath = await realpath(root);
    if (!(await stat(rootPath)).isDirectory()) denied(at);
    const candidate = path.resolve(rootPath, relative);
    if (!within(rootPath, candidate)) denied(at);
    let resolved: string;
    let exists = true;
    try {
      await lstat(candidate);
    } catch (err) {
      if (
        (err as NodeJS.ErrnoException).code !== "ENOENT" ||
        operation !== "write"
      )
        throw err;
      exists = false;
    }
    if (exists) {
      resolved = await realpath(candidate);
      if (!within(rootPath, resolved)) denied(at);
      const info = await stat(resolved);
      if (
        operation === "list" || operation === "cwd"
          ? !info.isDirectory()
          : !info.isFile()
      )
        denied(at);
    } else {
      const parent = await realpath(path.dirname(candidate));
      if (!within(rootPath, parent) || !(await stat(parent)).isDirectory())
        denied(at);
      resolved = path.join(parent, path.basename(candidate));
      if (!within(rootPath, resolved)) denied(at);
    }
    return { rootPath, path: resolved };
  } catch {
    denied(at);
  }
}
