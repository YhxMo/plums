import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { createArchive } from "@plums/core";
import {
  assertPackageManifest,
  EXPERIMENTAL_HELPERS,
  ALLOWED_ZIPS,
  checkPackageManifest,
} from "../../../scripts/package-manifest.mjs";

import {
  NATIVE_HELPERS,
  SHIPPED_NATIVE_HELPERS,
} from "../../../scripts/host-native-assets.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("rejects an unpacked fixture while accepting production files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-package-manifest-"));
  roots.push(root);
  await mkdir(path.join(root, "app/dist"), { recursive: true });
  await writeFile(path.join(root, "app/dist/main.js"), "synthetic");
  expect(await checkPackageManifest(root)).toContain("app/dist/main.js");
  await mkdir(path.join(root, "app/test/fixtures"), { recursive: true });
  await writeFile(path.join(root, "app/test/fixtures/x"), "synthetic");
  await expect(checkPackageManifest(root)).rejects.toThrow("Test fixture");
});
it("every native helper built into packages/host/dist is either shipped by build-host-adapter or listed as experimental", () => {
  expect(
    NATIVE_HELPERS.filter(
      (name) =>
        !SHIPPED_NATIVE_HELPERS.includes(name) &&
        !EXPERIMENTAL_HELPERS.includes(name),
    ),
  ).toEqual([]);
  expect(
    SHIPPED_NATIVE_HELPERS.filter((name) =>
      EXPERIMENTAL_HELPERS.includes(name),
    ),
  ).toEqual([]);
});
it.each(EXPERIMENTAL_HELPERS)(
  "rejects each experimental helper and its extension: %s",
  (name) => {
    for (const suffix of ["", ".c", ".dylib", "/child"])
      expect(() =>
        assertPackageManifest(["app/dist/" + name + suffix]),
      ).toThrow("Test fixture");
  },
);
it("allows only the declared ZIP inventory paths", () => {
  expect(() => assertPackageManifest(ALLOWED_ZIPS)).not.toThrow();
  expect(() => assertPackageManifest(["other/official.zip"])).toThrow(
    "Test fixture",
  );
});
it.each([
  "app/packages/host/test/fixtures/extensions/coding-tools/engine.mjs",
  "extraResources/test/fixtures/custom.zip",
  "app/dist/escape-probe",
  "app/dist/dyld-hook.dylib",
  "app/dist/project-members",
  "extraResources/fixture.zip",
])("rejects a fixture in the package inventory: %s", (name) => {
  expect(() => assertPackageManifest([name])).toThrow("Test fixture");
});
it("checks an unpacked app, official ZIP contents and ASAR inventories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-package-manifest-"));
  roots.push(root);
  const foundation = path.join(root, "app/dist/foundation-resources");
  await mkdir(foundation, { recursive: true });
  const archive = path.join(foundation, "official.zip");
  await writeFile(
    archive,
    await createArchive({ "code/adapter.mjs": Buffer.from("synthetic") }),
  );
  expect(await checkPackageManifest(root)).toContain(
    "app/dist/foundation-resources/official.zip/code/adapter.mjs",
  );
  await writeFile(
    archive,
    await createArchive({ "code/escape-probe": Buffer.from("synthetic") }),
  );
  await expect(checkPackageManifest(root)).rejects.toThrow("Test fixture");
  await rm(path.join(root, "app"), { recursive: true });
  const stage = path.join(root, "stage");
  await mkdir(path.join(stage, "test/fixtures"), { recursive: true });
  await writeFile(path.join(stage, "test/fixtures/probe.txt"), "synthetic");
  const req = createRequire(import.meta.url),
    packager = createRequire(req.resolve("@electron/packager"));
  await packager("@electron/asar").createPackage(
    stage,
    path.join(root, "app.asar"),
  );
  await rm(stage, { recursive: true });
  await expect(checkPackageManifest(root)).rejects.toThrow("Test fixture");
});
