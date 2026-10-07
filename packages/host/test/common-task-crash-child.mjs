import { DesktopHost } from "../dist/host.js";
import { MemorySecretStore } from "../../core/dist/index.js";
const [dir, node, id] = process.argv.slice(2);
const host = new DesktopHost({
  dataDir: dir,
  nodePath: node,
  confirm: { ask: async () => true },
  secretStore: () => new MemorySecretStore(),
});
await host.initialize();
const f = await host.openFrontend(id);
const rpc = (method, args = {}) =>
  host.frontendCommon(f.context.sessionId, f.context.handle, method, args);
const binding = await rpc("binding", { requirementId: "backend" }),
  task = await rpc("invoke", {
    binding: binding.handle,
    operation: "hang",
    input: { private: "body-not-in-metadata" },
  });
while (
  (await rpc("status", { taskId: task.taskId })).status.executionState ===
  "not_started"
)
  await new Promise((r) => setTimeout(r, 20));
process.send?.({ taskId: task.taskId });
process.on("message", () => process.exit(0));
