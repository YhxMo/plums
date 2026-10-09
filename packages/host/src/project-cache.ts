import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, rm, chmod } from "node:fs/promises";
import path from "node:path";
import { PlumsError } from "@plums/core";

function unsafe(): never {
  throw new PlumsError({
    code: "PERMISSION_DENIED",
    message: "缓存目录不可用。",
    details: { reason: "CACHE_PATH_UNSAFE" },
  });
}
export function cachePaths(
  dataRoot: string,
  agentId: string,
  packageId: string,
): { root: string; env: Record<string, string> } {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      agentId,
    ) ||
    !packageId
  )
    unsafe();
  const root = path.join(
    path.resolve(dataRoot),
    "instances",
    agentId,
    "cache",
    createHash("sha256").update(packageId).digest("hex"),
  );
  const names = {
    npm_config_cache: "npm",
    npm_config_store_dir: "pnpm",
    YARN_CACHE_FOLDER: "yarn",
    CARGO_HOME: "cargo",
    PIP_CACHE_DIR: "pip",
    GOCACHE: "go-build",
    GOMODCACHE: "go-mod",
    GOPATH: "go",
    XDG_CACHE_HOME: "xdg",
    TMPDIR: "tmp",
  };
  return {
    root,
    env: Object.fromEntries(
      Object.entries(names).map(([name, subdir]) => [
        name,
        path.join(root, subdir),
      ]),
    ),
  };
}
async function checkParents(root: string): Promise<void> {
  let current = path.resolve(root);
  while (true) {
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) unsafe();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
export async function prepareCache(
  paths: ReturnType<typeof cachePaths>,
): Promise<void> {
  await checkParents(paths.root);
  for (const directory of [paths.root, ...Object.values(paths.env)]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await checkParents(directory);
    if (process.platform !== "win32") await chmod(directory, 0o700);
  }
}
export async function cacheUsage(
  root: string,
): Promise<{ bytes: number; files: number }> {
  await checkParents(root);
  let bytes = 0,
    files = 0;
  async function visit(file: string): Promise<void> {
    let stat;
    try {
      stat = await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) unsafe();
    if (stat.isDirectory()) {
      for (const child of await readdir(file))
        await visit(path.join(file, child));
    } else if (stat.isFile()) {
      bytes += stat.size;
      files++;
    } else unsafe();
  }
  await visit(root);
  return { bytes, files };
}
export async function clearCache(root: string): Promise<void> {
  await cacheUsage(root);
  await checkParents(root);
  await rm(root, { recursive: true, force: true });
}
