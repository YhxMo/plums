import { afterEach, expect, it, vi } from "vitest";
import {
  EpochMemo,
  installationToken,
  INSTALLATION_METADATA_LIMIT,
  RequestRechecks,
  withRecheck,
} from "../src/recheck-cache.js";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Session } from "../src/host.js";
import { callbackFixture } from "./local-callback-fixture.js";
const roots: string[] = [];
const fixtures: Awaited<ReturnType<typeof callbackFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function metadataFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-metadata-"));
  roots.push(root);
  const install = path.join(root, "packages", "fixture");
  await mkdir(install, { recursive: true });
  const session = {
    core: {
      dataDir: root,
      listInstalled: async () => [],
      localAuthorizationState: async () => ({ revision: 0 }),
    },
    record: { components: [{ packageId: "fixture", digest: "synthetic" }] },
  } as unknown as Session;
  return { root, install, session };
}
async function files(root: string, count: number) {
  // Bound setup I/O too, so this fixture does not manufacture resource exhaustion.
  for (let start = 0; start < count; start += 128)
    await Promise.all(
      Array.from({ length: Math.min(128, count - start) }, (_, i) =>
        writeFile(path.join(root, `entry-${start + i}`), "synthetic"),
      ),
    );
}
it("concurrent inflight reads share one Promise", async () => {
  const memo = new EpochMemo<number>(),
    run = vi.fn(async () => 1);
  const a = memo.inflight("a", "key", run),
    b = memo.inflight("a", "key", run);
  expect(a).toBe(b);
  expect(await a).toBe(1);
  expect(run).toHaveBeenCalledOnce();
});
it("a changed token clears the cached values", () => {
  const memo = new EpochMemo<number>();
  memo.set("a", "key", 1);
  expect(memo.get("b", "key")).toBeUndefined();
  expect(memo.get("a", "key")).toBeUndefined();
});
it("failed reads are not cached", async () => {
  const memo = new EpochMemo<number>(),
    run = vi
      .fn()
      .mockRejectedValueOnce(Error("synthetic"))
      .mockResolvedValueOnce(2);
  await expect(memo.inflight("a", "key", run)).rejects.toThrow("synthetic");
  expect(await memo.inflight("a", "key", run)).toBe(2);
  expect(run).toHaveBeenCalledTimes(2);
});
it("an old generation cannot overwrite a newer epoch", async () => {
  const memo = new EpochMemo<number>();
  let finish!: (v: number) => void;
  const old = memo.inflight(
    "a",
    "key",
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await Promise.resolve();
  memo.set("b", "key", 2);
  finish(1);
  await old;
  expect(memo.get("b", "key")).toBe(2);
});
it("caller mutations cannot change later cache hits", async () => {
  const memo = new EpochMemo<{
    detail: { value: number };
    state: { revision: number };
  }>();
  const first = await memo.inflight("a", "key", async () => ({
    detail: { value: 1 },
    state: { revision: 2 },
  }));
  first.detail.value = 99;
  first.state.revision = 99;
  const next = await memo.inflight("a", "key", async () => {
    throw Error("must use cache");
  });
  expect(next).toEqual({ detail: { value: 1 }, state: { revision: 2 } });
  next.detail.value = 88;
  expect(memo.get("a", "key")!.detail.value).toBe(1);
});

it("installation metadata walk does not block the event loop", async () => {
  const f = await metadataFixture();
  await files(f.install, 1200);
  let ticks = 0,
    walking = true;
  const advance = () => {
    if (walking) {
      ticks++;
      setImmediate(advance);
    }
  };
  setImmediate(advance);
  try {
    await installationToken(f.session);
  } finally {
    walking = false;
  }
  expect(ticks).toBeGreaterThan(0);
});
it("overflowing the entry bound disables memo reuse and still denies a tampered install", async () => {
  const f = await metadataFixture();
  await files(f.install, INSTALLATION_METADATA_LIMIT + 32);
  const first = await installationToken(f.session),
    second = await installationToken(f.session);
  const entries = JSON.parse(first)[2][0][2];
  expect(entries).toContainEqual([
    "overflow",
    INSTALLATION_METADATA_LIMIT + 33,
  ]);
  expect(entries.filter((e: unknown[]) => e.length === 4)).toHaveLength(
    INSTALLATION_METADATA_LIMIT,
    RequestRechecks,
    withRecheck,
  );
  const memo = new EpochMemo<boolean>(),
    read = vi.fn(async () => true);
  await memo.inflight(first, "fixture", read);
  await memo.inflight(second, "fixture", read);
  expect(read).toHaveBeenCalledTimes(2);
  const host = await callbackFixture();
  fixtures.push(host);
  await host.run({ op: "read" });
  const s = (
    host.host as unknown as { sessions: Map<string, Session> }
  ).sessions.get(host.id)!;
  const install = path.join(s.core.dataDir, "packages", "store");
  for (let start = 0; start < INSTALLATION_METADATA_LIMIT + 32; start += 128)
    await Promise.all(
      Array.from(
        { length: Math.min(128, INSTALLATION_METADATA_LIMIT + 32 - start) },
        (_, i) => mkdir(path.join(install, `empty-${start + i}`)),
      ),
    );
  await writeFile(path.join(install, "main.js"), "synthetic tampering");
  await expect(
    host.run({ op: "write", value: "forbidden" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(
    host.audit.filter(
      (e) =>
        e.kind === "resource" && e.phase === "allow" && e.operation === "write",
    ),
  ).toHaveLength(0);
});
it("symlinks in the install tree are not followed", async () => {
  const f = await metadataFixture(),
    outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "private.txt"), "synthetic");
  await symlink(outside, path.join(f.install, "alias"), "dir");
  const entries = JSON.parse(await installationToken(f.session))[2][0][2];
  expect(entries.map((entry: unknown[]) => entry[0])).toEqual(["", "alias"]);
});

it("merges install token reads only within one non-full checkpoint", async () => {
  const f = await metadataFixture(),
    epoch = new RequestRechecks();
  const installed = vi.spyOn(f.session.core, "listInstalled");
  await withRecheck(epoch, false, async () => {
    const first = await installationToken(f.session);
    expect(await installationToken(f.session)).toBe(first);
    expect(installed).toHaveBeenCalledTimes(1);
  });
  await withRecheck(epoch, false, async () => {
    await installationToken(f.session);
  });
  expect(installed).toHaveBeenCalledTimes(2);
  await withRecheck(epoch, true, async () => {
    await installationToken(f.session);
    await installationToken(f.session);
  });
  expect(installed).toHaveBeenCalledTimes(4);
  await files(f.install, INSTALLATION_METADATA_LIMIT + 1);
  await withRecheck(epoch, false, async () => {
    const [first, second] = await Promise.all([
      installationToken(f.session),
      installationToken(f.session),
    ]);
    expect(first).not.toBe(second);
    const memo = new EpochMemo<boolean>(),
      read = vi.fn(async () => true);
    await memo.inflight(first, "fixture", read);
    await memo.inflight(second, "fixture", read);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
