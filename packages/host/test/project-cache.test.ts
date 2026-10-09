import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  rm,
  stat,
  symlink,
  writeFile,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  cachePaths,
  prepareCache,
  cacheUsage,
  clearCache,
} from "../src/project-cache.js";

const dirs: string[] = [];
const agent = "00000000-0000-4000-8000-000000000001";
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "plums-cache-")),
  );
  dirs.push(dir);
  return cachePaths(dir, agent, "fixture.package");
}
it("separates agent/component caches and maps every variable into the cache", async () => {
  const p = await fixture();
  expect(Object.keys(p.env)).toHaveLength(10);
  for (const file of Object.values(p.env))
    expect(file.startsWith(p.root + path.sep)).toBe(true);
  expect(cachePaths(dirs[0]!, agent, "other").root).not.toBe(p.root);
  expect(
    cachePaths(dirs[0]!, agent.replace(/1$/, "2"), "fixture.package").root,
  ).not.toBe(p.root);
  expect(() => cachePaths(dirs[0]!, "../escape", "x")).toThrow();
});
it("creates private caches, measures bytes and clears them", async () => {
  const p = await fixture();
  await prepareCache(p);
  await writeFile(path.join(p.env.npm_config_cache!, "first"), "hello");
  await writeFile(path.join(p.env.CARGO_HOME!, "second"), "abc");
  expect(await cacheUsage(p.root)).toEqual({ bytes: 8, files: 2 });
  if (process.platform !== "win32")
    expect((await stat(p.root)).mode & 0o777).toBe(0o700);
  await clearCache(p.root);
  expect(await cacheUsage(p.root)).toEqual({ bytes: 0, files: 0 });
});
it("refuses a symlink root without touching its target", async () => {
  const p = await fixture(),
    outside = path.join(dirs[0]!, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "sentinel"), "safe");
  await mkdir(path.dirname(p.root), { recursive: true });
  await symlink(outside, p.root, "dir");
  await expect(clearCache(p.root)).rejects.toMatchObject({
    details: { reason: "CACHE_PATH_UNSAFE" },
  });
  expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("safe");
});
it("refuses symlink ancestors and nested symlinks", async () => {
  const p = await fixture();
  await prepareCache(p);
  const outside = path.join(dirs[0]!, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(p.root, "nested"), "dir");
  await expect(cacheUsage(p.root)).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await expect(
    clearCache(path.join(p.root, "nested", "sub")),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
