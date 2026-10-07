import { it, expect } from "vitest";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { open } from "../../../scripts/platform-conformance-host.mjs";
import { PackagedHost } from "../../../scripts/packaged-conformance-host.mjs";

it("waits for a clean broker exit after IPC disconnect with an active frontend", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-broker-shutdown-"));
  const resource = path.join(dir, "Plums.app/Contents/Resources");
  let scenario: any;
  try {
    await cp(
      path.resolve("packages/desktop/dist"),
      path.join(resource, "app/dist"),
      { recursive: true },
    );
    await mkdir(path.join(resource, "node/bin"), { recursive: true });
    await symlink(process.execPath, path.join(resource, "node/bin/node"));
    for (const [name, pkg] of [
      ["isolated-vm", "host"],
      ["better-sqlite3", "core"],
    ]) {
      const require = createRequire(
        path.resolve(`packages/${pkg}/package.json`),
      );
      await mkdir(path.join(resource, "app/node_modules"), { recursive: true });
      await symlink(
        path.dirname(require.resolve(name + "/package.json")),
        path.join(resource, "app/node_modules", name),
      );
    }
    const adapter = await open({
      runtime: "isolate",
      createHost: (options: any) =>
        new PackagedHost(options, path.join(dir, "Plums.app")),
    });
    scenario = await adapter.scenario();
    await scenario.client();
    const broker = scenario.host.child;
    expect(broker.connected).toBe(true);
    await scenario.close();
    scenario = undefined;
    expect(broker.exitCode).toBe(0);
    expect(broker.signalCode).toBeNull();
  } finally {
    if (scenario) await scenario.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
