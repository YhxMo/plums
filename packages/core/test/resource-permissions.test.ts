import { it, expect, afterEach } from "vitest";
import {
  createCore,
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  validatePackage,
  type ManifestV2,
} from "../src/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dirs: string[] = [],
  cores: ReturnType<typeof createCore>[] = [];
afterEach(async () => {
  cores.splice(0).forEach((c) => c.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { force: true, recursive: true })),
  );
});
const manifest: ManifestV2 = {
  formatVersion: "2.0",
  kind: "extension",
  id: "resources",
  name: "Resources",
  version: "1.0.0",
  description: "",
  dependencies: [],
  permissions: [
    {
      kind: "resource",
      id: "records",
      target: "business",
      reason: "Business data",
      operations: ["write"],
    },
  ],
  payload: { opaque: "untouched" },
};
it("validates public resource permissions and preserves unknown fields without write implying read/delete", async () => {
  const contents = await validatePackage(
    await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify({
          ...manifest,
          permissions: [{ ...manifest.permissions[0], future: { keep: true } }],
        }),
      ),
    }),
  );
  expect(contents.manifest.permissions[0]?.future).toEqual({ keep: true });
  for (const permission of [
    { ...manifest.permissions[0], operations: ["exec"] },
    { ...manifest.permissions[0], target: "secrets" },
    { ...manifest.permissions[0], operations: [] },
  ])
    await expect(
      validatePackage(
        await createArchive({
          "manifest.json": Buffer.from(
            JSON.stringify({ ...manifest, permissions: [permission] }),
          ),
        }),
      ),
    ).rejects.toBeDefined();
  const dir = await mkdtemp(path.join(os.tmpdir(), "resource-core-"));
  dirs.push(dir);
  const core = createCore({
    dataDir: dir,
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  cores.push(core);
  await core.importPackage(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
    }),
  );
  await core.grantConsent("resources");
  await core.enable("resources");
  const checkpoint = core.resourceAccessCheckpoint([
    {
      packageId: "resources",
      permissionId: "records",
      scope: "agent",
      operation: "write",
    },
  ]);
  checkpoint.assertCurrent();
  for (const operation of ["read", "delete"] as const)
    expect(() =>
      core.resourceAccessCheckpoint([
        {
          packageId: "resources",
          permissionId: "records",
          scope: "agent",
          operation,
        },
      ]),
    ).toThrow();
  await core.disable("resources");
  expect(() => checkpoint.assertCurrent()).toThrow();
});
it("requires fresh consent when updates add resource operations, scopes or categories", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "resource-update-"));
  dirs.push(dir);
  const core = createCore({
    dataDir: dir,
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  cores.push(core);
  const zip = (m: ManifestV2) =>
    createArchive({ "manifest.json": Buffer.from(JSON.stringify(m)) });
  await core.importPackage(await zip(manifest));
  await core.grantConsent("resources");
  await core.enable("resources");
  const next = {
    ...manifest,
    version: "1.1.0",
    permissions: [
      {
        kind: "resource",
        id: "records",
        target: "business",
        reason: "Business data",
        operations: ["read", "write"],
      },
    ],
  } as ManifestV2;
  await expect(core.updatePackage(await zip(next))).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
    details: { reason: "OPERATIONS_ADDED" },
  });
  await core.updatePackage(await zip(next), { consent: true });
  expect(() =>
    core.resourceAccessCheckpoint([
      {
        packageId: "resources",
        permissionId: "records",
        scope: "agent",
        operation: "read",
      },
    ]),
  ).not.toThrow();
});
