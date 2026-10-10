import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { createArchive } from "@plums/core";
import {
  assertPackageManifest,
  checkPackageManifest,
} from "../../../scripts/package-manifest.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
it("build and packaging copy production roots without the fixture tree or experimental binaries", async () => {
  const pkg = JSON.parse(
    await readFile("packages/desktop/package.json", "utf8"),
  );
  assertPackageManifest(pkg.build?.files ?? []);
  const packaging = await readFile("scripts/package-desktop.mjs", "utf8"),
    build = await readFile("scripts/build-desktop.mjs", "utf8");
  expect(packaging).toContain('"packages/desktop/dist"');
  expect(packaging).toContain("await checkPackageManifest(resource)");
  for (const source of [packaging, build]) {
    expect(source).not.toMatch(/packages\/host\/(test|src|native)/);
    expect(source).not.toMatch(
      /test\/fixtures|escape-probe|dyld-hook|project-members/,
    );
  }
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
