import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
  type Core,
  type ManifestV2,
  type PackageLimits,
} from "../src/index.js";

const fixtures: { core: Core; dir: string }[] = [];
afterEach(async () => {
  for (const { core, dir } of fixtures.splice(0)) {
    core.close();
    await rm(dir, { recursive: true, force: true });
  }
});
async function fixture(limits?: Partial<PackageLimits>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-contents-"));
  const secrets = new MemorySecretStore();
  const core = createCore({
    dataDir: dir,
    secrets,
    egress: new RecordingEgressSink(),
    limits,
  });
  fixtures.push({ core, dir });
  const manifest: ManifestV2 = {
    formatVersion: "2.7",
    kind: "extension",
    id: "contents",
    name: "Contents",
    version: "1.0.0",
    description: "fixture",
    dependencies: [],
    permissions: [],
    settingsSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          title: "Token",
          description: "fixture",
          "x-secret": true,
        },
      },
    },
    payload: { future: [1, null, { nested: true }] },
    unknown: { kept: "yes" },
  };
  const installed = await core.importPackage(
    await core.exportPackage({
      manifest,
      files: { "data.bin": new Uint8Array([0, 255, 127]) },
    }),
  );
  return { core, dir, secrets, manifest, installed };
}

it("reads the current installed contents, keeps unknown fields and owns returned data", async () => {
  const { core, installed, manifest } = await fixture();
  await writeFile(
    path.join(installed.installDir, "data.bin"),
    new Uint8Array([1, 0, 255]),
  );
  const contents = await core.getPackageContents(manifest.id);
  expect(contents.manifest).toEqual(manifest);
  expect(contents.files["data.bin"]).toEqual(new Uint8Array([1, 0, 255]));
  expect(Object.keys(contents.files)).toEqual(["data.bin"]);
  expect(
    await core.validatePackage(await core.exportPackage(contents)),
  ).toEqual(contents);
  contents.manifest.payload = "changed";
  contents.files["data.bin"]![0] = 99;
  const next = await core.getPackageContents(manifest.id);
  expect(next.manifest).toEqual(manifest);
  expect(next.files["data.bin"]).toEqual(new Uint8Array([1, 0, 255]));
});

it.each(["name", "body"])(
  "rejects an installed file containing a saved secret in its %s",
  async (where) => {
    const { core, installed, secrets, manifest } = await fixture();
    await secrets.set(secretRef(manifest.id, "token"), "private-value");
    await writeFile(
      path.join(
        installed.installDir,
        where === "name" ? "private-value.txt" : "data.bin",
      ),
      where === "body" ? "private-value" : "safe",
    );
    try {
      await core.getPackageContents(manifest.id);
      throw Error("secret-bearing contents were accepted");
    } catch (error) {
      expect(error).toMatchObject({ code: "IMPORT_INVALID" });
      expect(String(error)).not.toContain("private-value");
      expect(JSON.stringify(error)).not.toContain("private-value");
    }
  },
);

it("rechecks installed file count and size limits", async () => {
  const count = await fixture({ maxFiles: 2 });
  await writeFile(path.join(count.installed.installDir, "extra.txt"), "extra");
  await expect(count.core.getPackageContents("contents")).rejects.toMatchObject(
    { code: "IMPORT_INVALID" },
  );
  const size = await fixture({ maxTotalBytes: 2048 });
  await writeFile(
    path.join(size.installed.installDir, "data.bin"),
    new Uint8Array(2048),
  );
  await expect(size.core.getPackageContents("contents")).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
});

it.skipIf(process.platform === "win32")(
  "rejects an unsafe filename added after installation",
  async () => {
    const { core, installed } = await fixture();
    await writeFile(path.join(installed.installDir, "bad\\name"), "unsafe");
    await expect(core.getPackageContents("contents")).rejects.toMatchObject({
      code: "IMPORT_INVALID",
      path: undefined,
    });
  },
);

it("rechecks the manifest entry path when limits are tightened after installation", async () => {
  const { core, dir, secrets } = await fixture();
  core.close();
  const reopened = createCore({
    dataDir: dir,
    secrets,
    egress: new RecordingEgressSink(),
    limits: { maxPathLength: 8 },
  });
  fixtures.push({ core: reopened, dir });
  await expect(reopened.getPackageContents("contents")).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    path: undefined,
  });
});
