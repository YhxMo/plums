import {
  localEntryPlan,
  revokeLocalEntry,
} from "./local-authorization-fixture.mjs";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
} from "../dist/index.js";
const [dataDir, packageId, action] = process.argv.slice(2);
const core = createCore({
  dataDir,
  instanceId: "agent-a",
  secrets: new MemorySecretStore(),
  egress: new RecordingEgressSink(),
  onAudit: () => {},
});
try {
  if (action === "restore") await revokeLocalEntry(core, packageId, "local");
  if (action !== "grant" && action !== "restore") throw Error("Invalid action");
  await core.commitLocalAuthorization(
    await localEntryPlan(core, packageId, "local"),
  );
  process.stdout.write("completed");
} finally {
  core.close();
}
