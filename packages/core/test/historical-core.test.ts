import { afterEach, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  buildHistoricalCore,
  readHistoricalArchive,
  validateHistoricalArchive,
} from "./historical-core.js";
const directory = path.resolve("packages/core/test/fixtures/historical-core");
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it("both checked-in historical archives match their pinned archive hashes without Git history", async () => {
  for (const [version, hash] of [
    [6, "8c9db29cfba0ecae3a59fffdca8863d4c020048254b5474961c68a85c53582ed"],
    [7, "20914c1d3aeed3b8e95a65b2999bdbe46dc788ace3f07129ede7ef2c00d717b6"],
  ] as const)
    expect(
      createHash("sha256")
        .update(await readHistoricalArchive(version))
        .digest("hex"),
    ).toBe(hash);
});
it("requires a checked-in archive and refuses tampered bytes or provenance", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-history-test-"));
  temporary.push(dir);
  await copyFile(
    path.join(directory, "sha256.json"),
    path.join(dir, "sha256.json"),
  );
  await expect(readHistoricalArchive(6, dir)).rejects.toThrow(
    "Git history is not required",
  );
  await writeFile(
    path.join(dir, "core-schema-6.tar"),
    "synthetic corrupt archive",
  );
  await expect(readHistoricalArchive(6, dir)).rejects.toThrow(
    "hash mismatch: expected",
  );
  const manifest = JSON.parse(
    await readFile(path.join(dir, "sha256.json"), "utf8"),
  );
  manifest[0].sha256 = createHash("sha256")
    .update("synthetic corrupt archive")
    .digest("hex");
  await writeFile(path.join(dir, "sha256.json"), JSON.stringify(manifest));
  await expect(readHistoricalArchive(6, dir)).rejects.toThrow(
    "pinned fixture identity",
  );
});

function archiveEntry(name: string, type = "0") {
  const archive = Buffer.alloc(1536);
  archive.write(name, 0, 100);
  archive.write("00000000000\0", 124, 12);
  archive.fill(32, 148, 156);
  archive.write(type, 156, 1);
  const checksum = [...archive.subarray(0, 512)].reduce(
    (sum, byte) => sum + byte,
    0,
  );
  archive.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return archive;
}
it("rejects escaping paths and symbolic or hard links before extraction", () => {
  for (const name of [
    "../x",
    "/packages/core/src/x",
    "packages/core/src/../x",
    "packages/core/other/x",
  ])
    expect(() => validateHistoricalArchive(archiveEntry(name))).toThrow(
      "escapes",
    );
  for (const type of ["1", "2", "x"])
    expect(() =>
      validateHistoricalArchive(archiveEntry("packages/core/src/x", type)),
    ).toThrow("forbidden type");
});
it("constructs both historical implementations with GIT_DIR pointing to an empty directory", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "plums-no-history-"));
  temporary.push(empty);
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = empty;
  try {
    for (const version of [6, 7] as const) {
      const core = await buildHistoricalCore(version);
      temporary.push(core.dir);
      expect(core.store.SCHEMA_VERSION).toBe(version);
      expect(typeof core.old.createCore).toBe("function");
    }
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
  }
});
