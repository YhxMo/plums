import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createArchive } from "@plumsjs/core";
import {
  assertPackageManifest,
  EXPERIMENTAL_HELPERS,
  ALLOWED_ZIPS,
  REQUIRED_LICENSE_FILES,
  checkPackageManifest,
} from "../../../scripts/package-manifest.mjs";

import * as packaging from "../../../scripts/package-desktop.mjs";
import { copyNativeRuntime } from "../../../scripts/native-build-metadata.mjs";
import {
  NATIVE_HELPERS,
  SHIPPED_NATIVE_HELPERS,
} from "../../../scripts/host-native-assets.mjs";

const roots: string[] = [];
async function licenses(root: string) {
  for (const name of REQUIRED_LICENSE_FILES) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), "Synthetic license");
  }
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("omits build setup paths while preserving native runtime and license bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-native-copy-"));
  roots.push(root);
  const source = path.join(root, "source"),
    destination = path.join(root, "runtime");
  await mkdir(path.join(source, "build/Release"), { recursive: true });
  for (const name of ["Makefile", "config.gypi", "addon.target.mk"])
    await writeFile(path.join(source, "build", name), "Synthetic build path");
  await writeFile(
    path.join(source, "build/Release/addon.node"),
    "Synthetic native bytes",
  );
  await writeFile(path.join(source, "LICENSE"), "Synthetic license bytes");
  await copyNativeRuntime(source, destination);
  expect(await readdir(path.join(destination, "build"))).toEqual(["Release"]);
  for (const name of ["build/Release/addon.node", "LICENSE"])
    expect(await readFile(path.join(destination, name))).toEqual(
      await readFile(path.join(source, name)),
    );
  for (const name of ["Makefile", "config.gypi", "addon.target.mk"])
    expect(() =>
      assertPackageManifest([
        ...REQUIRED_LICENSE_FILES,
        "app/node_modules/addon/build/" + name,
      ]),
    ).toThrow("Native build metadata");
  expect(() =>
    assertPackageManifest([
      ...REQUIRED_LICENSE_FILES,
      "app/node_modules/addon/build/Release/addon.node",
    ]),
  ).not.toThrow();
});
it("rejects an unpacked fixture while accepting production files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-package-manifest-"));
  roots.push(root);
  await licenses(root);
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
  expect(() =>
    assertPackageManifest([...ALLOWED_ZIPS, ...REQUIRED_LICENSE_FILES]),
  ).not.toThrow();
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
  await licenses(root);
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

it("the callable manifest gate accepts clean Resources and rejects a fixture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-manifest-gate-"));
  roots.push(root);
  await licenses(root);
  await mkdir(path.join(root, "app/dist"), { recursive: true });
  await writeFile(path.join(root, "app/dist/main.js"), "synthetic");
  expect(await packaging.runManifestGate(root)).toContain("app/dist/main.js");
  await writeFile(path.join(root, "app/dist/escape-probe"), "synthetic");
  await expect(packaging.runManifestGate(root)).rejects.toThrow("Test fixture");
});
it("the exported main entry always gates Resources before creating an image", async () => {
  expect(Object.keys(packaging).sort()).toEqual(["main", "runManifestGate"]);
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-packaging-main-"));
  roots.push(root);
  await licenses(root);
  const fixture = path.join(root, "test/fixtures");
  await mkdir(fixture, { recursive: true });
  await writeFile(path.join(fixture, "synthetic"), "synthetic");
  const prepared = {
      resource: root,
      application: "synthetic",
      output: "synthetic",
      desktopVersion: "1.0.0",
    },
    prepare = vi.fn(async () => prepared),
    createImage = vi.fn(async () => {});
  await expect(packaging.main({ prepare, createImage })).rejects.toThrow(
    "Test fixture",
  );
  expect(prepare).toHaveBeenCalledOnce();
  expect(createImage).not.toHaveBeenCalled();
  await rm(path.join(root, "test"), { recursive: true });
  await expect(
    packaging.main({ prepare, createImage }),
  ).resolves.toBeUndefined();
  expect(createImage).toHaveBeenCalledExactlyOnceWith(prepared);
});
it.each(REQUIRED_LICENSE_FILES)(
  "rejects an app missing required license %s",
  async (name) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "plums-missing-license-"),
    );
    roots.push(root);
    await licenses(root);
    await rm(path.join(root, name));
    await expect(checkPackageManifest(root)).rejects.toThrow(
      "Required desktop license missing: " + name,
    );
  },
);
