import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  lstat,
  symlink,
  link,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LocalSecretStore } from "../src/secrets.js";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-local-staging-"));
  directories.push(root);
  const directory = path.join(root, "secrets");
  await mkdir(directory, { mode: 0o700 });
  return { root, directory, store: new LocalSecretStore(directory) };
}
const hash = (ref: string) => createHash("sha256").update(ref).digest("hex");
const staging = (directory: string, ref: string) =>
  path.join(directory, hash(ref) + "." + randomUUID() + ".pending");
async function safeRefusal(
  operation: () => Promise<unknown>,
  value: string,
  root: string,
) {
  let failure: Error | undefined;
  try {
    await operation();
  } catch (error) {
    failure = error as Error;
  }
  expect(failure?.message).toBe("Secret storage unavailable");
  expect(failure?.cause).toBeUndefined();
  expect(failure?.stack).not.toContain(value);
  expect(failure?.stack).not.toContain(root);
}
it("cleans full and partial staging for one reference while preserving other references and unmatched names", async () => {
  const f = await fixture(),
    first = "first-reference",
    second = "second-reference";
  await f.store.set(first, "SELF_CURRENT_VALUE");
  await f.store.set(second, "SELF_OTHER_VALUE");
  const own = [staging(f.directory, first), staging(f.directory, first)],
    other = staging(f.directory, second),
    unmatched = path.join(f.directory, hash(first) + ".not-a-uuid.pending");
  await writeFile(own[0]!, "SELF_FULL_VALUE", { mode: 0o600 });
  await writeFile(own[1]!, "SELF_PARTIAL", { mode: 0o600 });
  await writeFile(other, "SELF_OTHER_PENDING", { mode: 0o600 });
  await writeFile(unmatched, "SELF_UNMATCHED", { mode: 0o600 });
  await f.store.delete(first);
  expect(await f.store.get(first)).toBeUndefined();
  expect(await f.store.get(second)).toBe("SELF_OTHER_VALUE");
  for (const file of own)
    await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(other, "utf8")).toBe("SELF_OTHER_PENDING");
  expect(await readFile(unmatched, "utf8")).toBe("SELF_UNMATCHED");
  expect(await readdir(f.directory)).toHaveLength(3);
});
it("refuses a staging directory without recursive deletion", async () => {
  const f = await fixture(),
    pending = staging(f.directory, "first");
  await mkdir(pending);
  await writeFile(path.join(pending, "marker"), "SELF_DIRECTORY_VALUE");
  await safeRefusal(
    () => f.store.delete("first"),
    "SELF_DIRECTORY_VALUE",
    f.root,
  );
  expect(await readFile(path.join(pending, "marker"), "utf8")).toBe(
    "SELF_DIRECTORY_VALUE",
  );
});
it.skipIf(process.platform === "win32")(
  "refuses staging symlinks without reading or deleting their target",
  async () => {
    const f = await fixture(),
      pending = staging(f.directory, "first"),
      external = path.join(f.root, "external");
    await writeFile(external, "SELF_EXTERNAL_VALUE");
    await symlink(external, pending);
    await safeRefusal(
      () => f.store.delete("first"),
      "SELF_EXTERNAL_VALUE",
      f.root,
    );
    expect(await readFile(external, "utf8")).toBe("SELF_EXTERNAL_VALUE");
    expect((await lstat(pending)).isSymbolicLink()).toBe(true);
  },
);
it.skipIf(process.platform === "win32")(
  "refuses multiply linked staging files and leaves both aliases intact",
  async () => {
    const f = await fixture(),
      pending = staging(f.directory, "first"),
      external = path.join(f.root, "external");
    await writeFile(external, "SELF_LINKED_VALUE");
    await link(external, pending);
    await safeRefusal(
      () => f.store.delete("first"),
      "SELF_LINKED_VALUE",
      f.root,
    );
    expect(await readFile(external, "utf8")).toBe("SELF_LINKED_VALUE");
    expect((await lstat(pending)).nlink).toBe(2);
  },
);
it("waits for an in-flight same-reference set before deleting canonical and temporary files", async () => {
  const f = await fixture(),
    setting = f.store.set("first", "SELF_ORDERED_VALUE"),
    deleting = new LocalSecretStore(f.directory).delete("first");
  await Promise.all([setting, deleting]);
  expect(await f.store.get("first")).toBeUndefined();
  expect(await readdir(f.directory)).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "cleans the unpublished plaintext left by SIGKILL between a production write and rename",
  async () => {
    const f = await fixture(),
      marker = path.join(f.root, "ready");
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./local-staging-child.mjs", import.meta.url)),
        f.directory,
        marker,
      ],
      { stdio: "ignore" },
    );
    const closed = once(child, "close");
    try {
      await expect.poll(() => existsSync(marker), { timeout: 5000 }).toBe(true);
      expect(await f.store.get("synthetic-crash-reference")).toBeUndefined();
      const [pending] = await readdir(f.directory);
      expect(pending).toMatch(/\.pending$/);
      expect(await readFile(path.join(f.directory, pending!), "utf8")).toBe(
        "SYNTHETIC_CRASH_VALUE",
      );
      child.kill("SIGKILL");
      expect(await closed).toEqual([null, "SIGKILL"]);
      const reopened = new LocalSecretStore(f.directory);
      await reopened.delete("synthetic-crash-reference");
      expect(await reopened.get("synthetic-crash-reference")).toBeUndefined();
      expect(await readdir(f.directory)).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    }
  },
);
