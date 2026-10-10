import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  checkVersions,
  PACKAGE_NAMES,
  PREVIEW_VERSION,
} from "../../../scripts/check-versions.mjs";

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "plums-versions-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: PREVIEW_VERSION }),
    );
    for (const [directory, name] of Object.entries(PACKAGE_NAMES)) {
      await mkdir(path.join(root, "packages", directory), { recursive: true });
      await writeFile(
        path.join(root, "packages", directory, "package.json"),
        JSON.stringify({
          name,
          version: PREVIEW_VERSION,
          ...(directory === "cli" ? { bin: { plums: "./bin/plums.js" } } : {}),
        }),
      );
    }
    await mkdir(path.join(root, "packages/core/src"));
    await writeFile(
      path.join(root, "packages/core/src/version.ts"),
      `export const VERSION = "${PREVIEW_VERSION}";\n`,
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it("all repository manifests and the core/CLI public version match the selected preview", async () => {
  expect(await checkVersions()).toEqual({
    ok: true,
    version: "0.1.0",
    packages: 6,
  });
});
it.each([
  "package.json",
  ...Object.keys(PACKAGE_NAMES).map((name) => `packages/${name}/package.json`),
])("rejects an inconsistent version in %s", async (file) => {
  await fixture(async (root) => {
    await writeFile(
      path.join(root, file),
      JSON.stringify({ version: "1.0.0" }),
    );
    await expect(checkVersions(root)).rejects.toThrow("Version mismatch");
  });
});
it("rejects an old package identity, CLI executable change and drifting public API version", async () => {
  await fixture(async (root) => {
    const file = path.join(root, "packages/cli/package.json");
    await writeFile(
      file,
      JSON.stringify({ name: "plums", version: PREVIEW_VERSION }),
    );
    await expect(checkVersions(root)).rejects.toThrow("Package scope mismatch");
    await writeFile(
      file,
      JSON.stringify({ name: PACKAGE_NAMES.cli, version: PREVIEW_VERSION }),
    );
    await expect(checkVersions(root)).rejects.toThrow("CLI command mismatch");
    await writeFile(
      file,
      JSON.stringify({
        name: PACKAGE_NAMES.cli,
        version: PREVIEW_VERSION,
        bin: { plums: "./bin/plums.js" },
      }),
    );
    await writeFile(
      path.join(root, "packages/core/src/version.ts"),
      'export const VERSION = "1.0.0";',
    );
    await expect(checkVersions(root)).rejects.toThrow(
      "Core API version mismatch",
    );
  });
});
