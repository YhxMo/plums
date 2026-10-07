import { expect, it } from "vitest";
import {
  mkdtemp,
  realpath,
  readFile,
  readdir,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
const helper = path.resolve("packages/host/dist/secure-fs");
function write(root: string, data: Buffer) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(helper, ["write", root, "memory.json"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("close", resolve);
    child.stdin.on("error", () => {});
    child.stdin.end(data);
  });
}
it.skipIf(process.platform !== "darwin")(
  "publishes a whole file and retains the prior bytes when a bounded write fails",
  async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "plums-atomic-fs-")),
    );
    try {
      const file = path.join(root, "memory.json"),
        original = Buffer.from('{"kept":true}');
      await writeFile(file, original);
      expect(await write(root, Buffer.alloc(21 * 1024 * 1024, 65))).not.toBe(0);
      expect(await readFile(file)).toEqual(original);
      expect(await readdir(root)).toEqual(["memory.json"]);
      const next = Buffer.alloc(2 * 1024 * 1024, 66);
      let done = false;
      const work = write(root, next).then((code) => {
        done = true;
        return code;
      });
      while (!done) {
        const bytes = await readFile(file);
        expect(bytes.equals(original) || bytes.equals(next)).toBe(true);
      }
      expect(await work).toBe(0);
      expect(await readFile(file)).toEqual(next);
      await rm(file);
      await symlink("target.json", file);
      await writeFile(path.join(root, "target.json"), original);
      expect(await write(root, next)).not.toBe(0);
      expect(await readFile(path.join(root, "target.json"))).toEqual(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
