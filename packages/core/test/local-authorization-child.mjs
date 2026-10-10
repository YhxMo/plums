import { revokeLocalEntry } from "./local-authorization-fixture.mjs";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
} from "../dist/index.js";
const [dataDir, action] = process.argv.slice(2);
const core = createCore({
  dataDir,
  instanceId: "agent-a",
  secrets: new MemorySecretStore(),
  egress: new RecordingEgressSink(),
  onAudit: () => {},
});
try {
  if (action === "revoke") await revokeLocalEntry(core, "first", "local");
  else if (action === "migrate") await core.localAuthorizationState();
  else throw new Error("Invalid synthetic action");
  process.stdout.write("completed");
} finally {
  core.close();
}
