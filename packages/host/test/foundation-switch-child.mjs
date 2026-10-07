import { DesktopHost } from "../dist/index.js";
import { MemorySecretStore } from "../../core/dist/index.js";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { chmod } from "node:fs/promises";
const { dataDir, id, selection, phase } = JSON.parse(process.argv[2]);
const host = new DesktopHost({
  dataDir,
  nodePath: process.execPath,
  confirm: { ask: async () => true },
  secretStore: () => new MemorySecretStore(),
  foundationSwitchFault: async (p) => {
    if (p === phase) {
      const db = new DatabaseSync(path.join(dataDir, "foundation-state.db"));
      const pids = db
        .prepare("SELECT pid FROM processes")
        .all()
        .map((r) => r.pid);
      db.close();
      process.send?.({ fault: p, pids });
      process.exit(71);
    }
  },
});
try {
  await host.initialize();
  if (phase === "cleanup-failure") {
    await host.invoke(id, "consumer", "consumer", "commands", "check", {});
    await chmod(path.join(dataDir, "foundation-snapshots"), 0o500);
    const plan = await host.foundationPlan(id, selection);
    const failed = await host
      .switchFoundation(id, plan.fingerprint, selection)
      .catch((e) => e);
    const close = await host.close().then(
      () => "success",
      () => "failed",
    );
    process.send?.({ failed: true, reason: failed.details?.reason, close });
    process.exit(71);
  } else if (phase === "hold") {
    await host.foundationStatus(id);
    process.send?.({ ready: true });
    process.on("message", async () => {
      await host.close();
      process.exit(0);
    });
  } else {
    const plan = await host.foundationPlan(id, selection);
    await host.switchFoundation(id, plan.fingerprint, selection);
    await host.close();
    process.send?.({ switched: true });
    process.exit(0);
  }
} catch (e) {
  process.send?.({ failed: true, reason: e.details?.reason });
  await host.close().catch(() => {});
  process.exit(72);
}
