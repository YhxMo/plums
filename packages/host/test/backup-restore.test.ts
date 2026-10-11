import { expect, it, vi } from "vitest";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DesktopHost } from "../src/host.js";
import { LocalSecretStore } from "../src/secrets.js";
import { resourceFixture } from "./resource-fixture.js";
import { createArchive } from "@plumsjs/core";
import { connectorManifest, connectorRuntime } from "./platform-fixtures.js";

it("restores a stopped complete synthetic data directory with private secrets, pinned components and resources but no live scopes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-backup-restore-"));
  const stores = (dir: string) => (id: string) =>
    new LocalSecretStore(path.join(dir, "instances", id, "secrets"));
  let original: DesktopHost | undefined, restored: DesktopHost | undefined;
  let source: string | undefined;
  try {
    const f = await resourceFixture();
    source = f.dir;
    original = f.host;
    await f.grant(f.a);
    await f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "restore-record",
      expectedRevision: "0",
      value: { synthetic: "backup-body" },
    });
    const preview = (await original.preview(
      await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(connectorManifest())),
        "runtime/main.js": Buffer.from(connectorRuntime),
      }),
    )) as { token: string };
    const connector = await original.importLibrary(preview.token);
    const agent = await original.createAgent("Restore credential fixture", [
      connector.digest,
    ]);
    await original.setSettings(
      agent.instanceId,
      "model",
      { model: "synthetic-model", endpoint: "https://example.com/v1" },
      { apiKey: "fake-memory-key" },
    );
    await original.enable(agent.instanceId, "model");
    // Match desktop local storage; keep the core's declared secret reference.
    await stores(source)(agent.instanceId).set(
      "secret:model/apiKey",
      "fake-backup-key",
    );
    const before = (await original.resources(agent.instanceId)) as any;
    expect(before.packages[0].needsApproval).toBe(false);
    const pins = (await original.listAgents()).map((r) => r.components);
    await original.close();
    original = undefined;
    const backup = path.join(root, "backup"),
      recovery = path.join(root, "restored");
    await cp(source, backup, { recursive: true, preserveTimestamps: true });
    await cp(backup, recovery, { recursive: true, preserveTimestamps: true });
    const ask = vi.fn(async () => false);
    restored = new DesktopHost({
      dataDir: recovery,
      secretStore: stores(recovery),
      confirm: { ask },
    });
    await restored.initialize();
    expect((await restored.listAgents()).map((r) => r.components)).toEqual(
      pins,
    );
    const after = (await restored.resources(agent.instanceId)) as any;
    expect(after.packages[0].settings.values).toEqual(
      before.packages[0].settings.values,
    );
    expect(after.packages[0].settings.secrets.apiKey).toBe(true);
    expect(after.packages[0].enabled).toBe(true);
    expect(after.packages[0].needsApproval).toBe(false);
    expect(
      await stores(recovery)(agent.instanceId).get("secret:model/apiKey"),
    ).toBe("fake-backup-key");
    const secretsDir = path.join(
      recovery,
      "instances",
      agent.instanceId,
      "secrets",
    );
    if (process.platform !== "win32") {
      expect((await stat(secretsDir)).mode & 0o777).toBe(0o700);
      for (const file of await readdir(secretsDir))
        expect((await stat(path.join(secretsDir, file))).mode & 0o777).toBe(
          0o600,
        );
    }
    const plan = await restored.resourcePlan(f.a);
    expect(plan.active).toBeUndefined();
    await expect(
      restored.invoke(
        f.a,
        "records-provider",
        "records-provider",
        "commands",
        "records",
        { op: "read", resourceId: f.shared, key: "restore-record" },
      ),
    ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
    expect(ask).toHaveBeenCalled();
    ask.mockResolvedValue(true);
    await restored.grantResourceRange(
      f.a,
      plan.fingerprint,
      "task",
      900_000,
      plan.bindings.map((b) => ({
        componentId: b.componentId,
        resourceId: b.resourceId,
        operations: ["read"],
      })),
    );
    ask.mockClear();
    ask.mockResolvedValue(false);
    expect(
      await restored.invoke(
        f.a,
        "records-provider",
        "records-provider",
        "commands",
        "records",
        { op: "read", resourceId: f.shared, key: "restore-record" },
      ),
    ).toMatchObject({ exists: true, value: { synthetic: "backup-body" } });
    expect(ask).not.toHaveBeenCalled();
    await restored.setSettings(
      agent.instanceId,
      "model",
      { model: "changed-only-in-recovery" },
      {},
    );
    expect(
      await stores(backup)(agent.instanceId).get("secret:model/apiKey"),
    ).toBe("fake-backup-key");
    const originalSettings = await readFile(
      path.join(
        source,
        "instances",
        agent.instanceId,
        "core",
        "data",
        "model",
        "settings.json",
      ),
      "utf8",
    );
    expect(originalSettings).toContain("synthetic-model");
  } finally {
    await original?.close();
    await restored?.close();
    if (source) await rm(source, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
