import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DesktopHost } from "../src/host.js";
import { MemorySecretStore } from "@plumsjs/core";
const failure = vi.hoisted(() => ({ mode: "" }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (...args: any[]) => {
      if (
        failure.mode === "rollback" &&
        String(args[1]).endsWith("/record.json")
      )
        throw Error("private path /synthetic-secret");
      return (real.rename as any)(...args);
    },
    rm: async (...args: any[]) => {
      if (
        failure.mode === "journal-delete" &&
        String(args[0]).endsWith("/foundation-transaction.json")
      )
        throw Error("private path /synthetic-secret");
      return (real.rm as any)(...args);
    },
  };
});
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  failure.mode = "";
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it.each(["rollback", "journal-delete"])(
  "keeps recovery evidence and fixed diagnostics when %s fails",
  async (mode) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "plums-persist-"));
    dirs.push(dir);
    const options = {
      dataDir: dir,
      nodePath: path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node"),
      confirm: { ask: async () => true },
      secretStore: () => new MemorySecretStore(),
    };
    const host = new DesktopHost({
      ...options,
      foundationSwitchFault: (phase) => {
        if (mode === "rollback" && phase === "after-commit") {
          failure.mode = mode;
          throw Error("private fault");
        }
        if (mode === "journal-delete" && phase === "after-activate")
          failure.mode = mode;
      },
    });
    hosts.push(host);
    await host.initialize();
    const a = await host.createAgent("A"),
      plan = await host.foundationPlan(a.instanceId, a.foundation!.selection);
    const error = await host
      .switchFoundation(a.instanceId, plan.fingerprint, a.foundation!.selection)
      .catch((e) => e);
    expect(error).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        reason: "FOUNDATION_CLEANUP_FAILED",
        selectionCommitted: mode === "journal-delete",
        executionState: "not_started",
      },
    });
    expect(JSON.stringify(error)).not.toMatch(/private|synthetic-secret/);
    const agentDir = path.join(dir, "instances", a.instanceId),
      transaction = JSON.parse(
        await readFile(
          path.join(agentDir, "foundation-transaction.json"),
          "utf8",
        ),
      );
    expect(transaction.phase).toBe(
      mode === "rollback" ? "committed" : "activated",
    );
    expect(
      (await readdir(agentDir)).filter((n) => n.endsWith(".pending")),
    ).toEqual([]);
    await expect(
      host.switchFoundation(
        a.instanceId,
        plan.fingerprint,
        a.foundation!.selection,
      ),
    ).rejects.toBeDefined();
    failure.mode = "";
    await host.close();
    const next = new DesktopHost(options);
    hosts.push(next);
    await next.initialize();
    expect(await next.foundationStatus(a.instanceId)).toEqual(
      mode === "rollback"
        ? transaction.before.foundation
        : transaction.next.foundation,
    );
  },
);
