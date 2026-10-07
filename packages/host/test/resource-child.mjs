import { DesktopHost } from "../dist/index.js";
import { MemorySecretStore } from "../../core/dist/index.js";
const agent = process.env.PLUMS_FIXTURE_AGENT,
  resource = process.env.PLUMS_FIXTURE_RESOURCE;
let auditRelease;
const host = new DesktopHost({
  dataDir: process.env.PLUMS_FIXTURE_DIR,
  confirm: { ask: async () => true },
  secretStore: () => new MemorySecretStore(),
  audit: process.env.PLUMS_FIXTURE_AUDIT_WAIT
    ? async (_id, event) => {
        if (event.phase === "allow") {
          process.send({ auditWait: true });
          await new Promise((r) => (auditRelease = r));
        }
      }
    : undefined,
  resourceCommitFault: (phase) => {
    if (phase === process.env.PLUMS_FIXTURE_FAULT) process.exit(73);
  },
});
await host.initialize();
const plan = await host.resourcePlan(agent);
await host.grantResourceRange(agent, plan.fingerprint, "task", 900_000, [
  {
    componentId: "records-provider",
    resourceId: resource,
    operations: ["read", "write", "delete"],
  },
]);
process.send({ ready: true });
process.on("message", async (m) => {
  if (m.resume) {
    auditRelease?.();
    return;
  }
  if (m.close) {
    await host.close();
    process.exit(0);
  }
  try {
    if (m.plan) {
      process.send({
        ok: true,
        active: (await host.resourcePlan(agent)).active,
      });
      return;
    }
    const value = await host.invoke(
      agent,
      "records-provider",
      "records-provider",
      "commands",
      "records",
      m.input ?? {
        op: m.read ? "read" : "write",
        resourceId: resource,
        key: m.key,
        expectedRevision: "0",
        value: agent,
      },
    );
    process.send({ ok: true, value });
  } catch (e) {
    process.send({
      ok: false,
      reason: e.details?.reason,
      executionState: e.details?.executionState,
    });
  }
});
