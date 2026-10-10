import {
  localEntryPlan,
  revokeLocalEntry,
} from "./local-authorization-fixture.mjs";
import { it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  type Core,
  type ManifestV2,
} from "../src/index.js";
const cores: Core[] = [],
  dirs: string[] = [];
afterEach(async () => {
  cores.splice(0).forEach((c) => c.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const manifest: ManifestV2 = {
  formatVersion: "2.0",
  id: "trusted",
  kind: "extension",
  name: "Trusted",
  version: "1.0.0",
  description: "",
  dependencies: [],
  permissions: [
    {
      id: "engine-permission",
      kind: "engine",
      target: "main",
      reason: "Run local code",
    },
  ],
  payload: {},
};
async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "plums-trust-"));
  dirs.push(dataDir);
  const options = {
    dataDir,
    instanceId: "agent-instance",
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  };
  const core = createCore(options);
  cores.push(core);
  await core.importPackage(await core.exportPackage({ manifest }));
  return { core, options };
}
it("persists an Agent's user grant and only preserves it across unchanged engine permission upgrades", async () => {
  const { core, options } = await fixture();
  const snapshot = await localEntryPlan(core, "trusted", "main");
  expect(snapshot.trusted).toBe(false);
  expect(await core.commitLocalAuthorization(snapshot)).toBe(true);
  core.close();
  const reopened = createCore(options);
  cores.push(reopened);
  expect((await localEntryPlan(reopened, "trusted", "main")).trusted).toBe(
    true,
  );
  await reopened.updatePackage(
    await reopened.exportPackage({
      manifest: {
        ...manifest,
        version: "1.1.0",
        permissions: [
          {
            reason: "Run local code",
            target: "main",
            kind: "engine",
            id: "engine-permission",
          },
        ],
      },
    }),
  );
  expect((await localEntryPlan(reopened, "trusted", "main")).trusted).toBe(
    true,
  );
  await reopened.updatePackage(
    await reopened.exportPackage({
      manifest: {
        ...manifest,
        version: "1.2.0",
        permissions: [
          {
            ...manifest.permissions[0]!,
            reason: "Changed authority",
          } as ManifestV2["permissions"][number],
        ],
      },
    }),
    { consent: true },
  );
  expect((await localEntryPlan(reopened, "trusted", "main")).trusted).toBe(
    false,
  );
});
it("revocation, uninstall and reinstallation cannot restore a pending or persisted grant", async () => {
  const { core } = await fixture();
  const pending = await localEntryPlan(core, "trusted", "main");
  await revokeLocalEntry(core, "trusted", "main");
  expect(await core.commitLocalAuthorization(pending)).toBe(false);
  expect(
    await core.commitLocalAuthorization(
      await localEntryPlan(core, "trusted", "main"),
    ),
  ).toBe(true);
  const old = await localEntryPlan(core, "trusted", "main");
  await core.uninstall("trusted");
  await core.importPackage(await core.exportPackage({ manifest }));
  expect(await core.commitLocalAuthorization(old)).toBe(false);
  expect((await localEntryPlan(core, "trusted", "main")).trusted).toBe(false);
});
it("another Agent identity and a newly declared engine require their own grant", async () => {
  const { core, options } = await fixture();
  await core.commitLocalAuthorization(
    await localEntryPlan(core, "trusted", "main"),
  );
  const other = createCore({ ...options, instanceId: "another-agent" });
  cores.push(other);
  expect((await localEntryPlan(other, "trusted", "main")).trusted).toBe(false);
  await core.updatePackage(
    await core.exportPackage({
      manifest: {
        ...manifest,
        version: "1.1.0",
        permissions: [
          ...manifest.permissions,
          {
            id: "second",
            kind: "engine",
            target: "second",
            reason: "Second engine",
          },
        ],
      },
    }),
    { consent: true },
  );
  expect((await localEntryPlan(core, "trusted", "second")).trusted).toBe(false);
  expect((await localEntryPlan(core, "trusted", "main")).trusted).toBe(true);
});
it("local authorization cannot be inferred from payload, settings or the package name", async () => {
  const { core } = await fixture();
  expect(
    await core.commitLocalAuthorization(
      await localEntryPlan(core, "trusted", "undeclared"),
    ),
  ).toBe(false);
  expect((await core.localAuthorizationState()).grants).toEqual([]);
});
