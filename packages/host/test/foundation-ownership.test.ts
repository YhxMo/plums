import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { FoundationOwnership } from "../src/foundation-state.js";
const behavior = vi.hoisted(() => ({ fail: false }));
vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>();
  return {
    ...real,
    execFileSync: (...args: any[]) => {
      if (behavior.fail && args[0] === "/bin/ps")
        throw Error("private diagnostic");
      return (real.execFileSync as any)(...args);
    },
  };
});
const dirs: string[] = [];
afterEach(async () => {
  behavior.fail = false;
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it("refuses to track a live child when its start identity cannot be read", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-owner-"));
  dirs.push(dir);
  const owner = new FoundationOwnership(dir);
  owner.enter("a");
  const child = fork(
    path.resolve("packages/host/test/foundation-switch-child.mjs"),
    [],
    {
      execPath: process.execPath,
      execArgv: ["-e", "setInterval(()=>{},1000)"],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  try {
    behavior.fail = true;
    expect(() => owner.track("a", child)).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({
          reason: "FOUNDATION_CLEANUP_PENDING",
        }),
      }),
    );
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
  } finally {
    const closed = once(child, "close");
    child.kill();
    await closed;
    owner.leave("a");
    owner.close();
  }
});
it("cannot take over a stale participant while a recorded child is alive and identity is unknown", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-owner-"));
  dirs.push(dir);
  const owner = new FoundationOwnership(dir);
  owner.enter("a");
  const db = new DatabaseSync(path.join(dir, "foundation-state.db"));
  db.prepare("INSERT INTO participants VALUES(?,?,?)").run(
    "a",
    "stale",
    2147483647,
  );
  db.prepare("INSERT INTO processes VALUES(?,?,?,?)").run(
    "stale",
    "a",
    process.pid,
    "unavailable identity",
  );
  db.close();
  behavior.fail = true;
  const now = Date.now.bind(Date);
  let calls = 0;
  const clock = vi
    .spyOn(Date, "now")
    .mockImplementation(() => now() + (calls++ ? 16000 : 0));
  try {
    await expect(owner.exclusive("a")).rejects.toMatchObject({
      details: { reason: "FOUNDATION_CLEANUP_PENDING" },
    });
    const stored = new DatabaseSync(path.join(dir, "foundation-state.db"));
    expect(
      stored
        .prepare("SELECT owner FROM participants WHERE owner='stale'")
        .get(),
    ).toBeDefined();
    stored.close();
  } finally {
    clock.mockRestore();
    owner.leave("a");
    owner.close();
  }
});

it("cleans only stale-owner snapshots and preserves the current host's active snapshot", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-owner-"));
  dirs.push(dir);
  const owner = new FoundationOwnership(dir);
  owner.enter("a");
  const own = owner.allocateSnapshot("a");
  await mkdir(own.root, { recursive: true });
  await writeFile(path.join(own.root, "entry"), "current engine");
  const id = "00000000-0000-4000-8000-000000000001",
    stale = path.join(dir, "foundation-snapshots", id);
  await mkdir(stale);
  await writeFile(path.join(stale, "entry"), "dead engine");
  const db = new DatabaseSync(path.join(dir, "foundation-state.db"));
  db.prepare("INSERT INTO participants VALUES(?,?,?)").run(
    "a",
    "dead",
    2147483647,
  );
  db.prepare("INSERT INTO snapshots VALUES(?,?,?)").run("dead", "a", id);
  db.close();
  try {
    await owner.exclusive("a");
    expect(await readFile(path.join(own.root, "entry"), "utf8")).toBe(
      "current engine",
    );
    await expect(readFile(path.join(stale, "entry"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const check = new DatabaseSync(path.join(dir, "foundation-state.db"));
    expect(check.prepare("SELECT id FROM snapshots").all()).toHaveLength(1);
    check.close();
  } finally {
    owner.releaseExclusive("a");
    await rm(own.root, { recursive: true, force: true });
    own.release();
    owner.leave("a");
    owner.close();
  }
});
