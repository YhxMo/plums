/** Trusted test driver in another OS process; no third-party code is loaded here. */
import { DesktopHost } from "../packages/host/dist/index.js";
import { MemorySecretStore } from "../packages/core/dist/index.js";
const [dataDir, agentId] = process.argv.slice(2);
const host = new DesktopHost({
  dataDir,
  secretStore: () => new MemorySecretStore(),
  confirm: { ask: async () => true },
});
try {
  await host.initialize();
  const plan = await host.resourcePlan(agentId);
  await host.grantResourceRange(
    agentId,
    plan.fingerprint,
    "task",
    900_000,
    plan.bindings.map((b) => ({
      componentId: b.componentId,
      resourceId: b.resourceId,
      operations: ["read", "write", "delete"],
    })),
  );
  const front = await host.openFrontend(agentId);
  const rpc = (method, args) =>
    host.frontendResource(
      front.context.sessionId,
      front.context.handle,
      method,
      args,
    );
  const shared = (await rpc("list", {})).find(
    (b) => b.requirementId === "shared",
  );
  process.send({ phase: "ready", pid: process.pid });
  await new Promise((resolve) => process.once("message", resolve));
  try {
    const value = await rpc("write", {
      binding: shared.binding,
      key: "process-race",
      expectedRevision: "0",
      value: "child",
    });
    process.send({ status: "fulfilled", value });
  } catch (error) {
    process.send({ status: "rejected", reason: error.details?.reason });
  }
} catch {
  process.send({ status: "failed" });
  process.exitCode = 1;
} finally {
  await host.close();
  process.disconnect();
}
