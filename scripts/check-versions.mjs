import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PREVIEW_VERSION = "0.1.0";
export const PACKAGE_NAMES = Object.freeze({
  core: "@plumsjs/core",
  cli: "@plumsjs/cli",
  sdk: "@plumsjs/sdk",
  host: "@plumsjs/host",
  desktop: "@plumsjs/desktop",
});
const repository = fileURLToPath(new URL("../", import.meta.url));

export async function checkVersions(root = repository) {
  const files = [
    "package.json",
    ...Object.keys(PACKAGE_NAMES).map(
      (name) => `packages/${name}/package.json`,
    ),
  ];
  for (const file of files) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, file), "utf8"));
    } catch {
      throw Error(`Missing or invalid manifest: ${file}`);
    }
    if (manifest.version !== PREVIEW_VERSION)
      throw Error(`Version mismatch: ${file}; expected ${PREVIEW_VERSION}`);
    const workspace = file.split("/")[1];
    if (workspace && manifest.name !== PACKAGE_NAMES[workspace])
      throw Error(`Package scope mismatch: ${file}`);
    for (const [name, specifier] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }))
      if (
        specifier.startsWith("workspace:") &&
        !Object.values(PACKAGE_NAMES).includes(name)
      )
        throw Error(`Unknown workspace dependency: ${file}`);
    if (workspace === "cli" && manifest.bin?.plums !== "./bin/plums.js")
      throw Error("CLI command mismatch: packages/cli/package.json");
  }
  const source = await readFile(
    path.join(root, "packages/core/src/version.ts"),
    "utf8",
  );
  if (
    !new RegExp(
      `^export const VERSION = ["']${PREVIEW_VERSION.replaceAll(".", "\\.")}["'];`,
      "m",
    ).test(source)
  )
    throw Error("Core API version mismatch: packages/core/src/version.ts");
  return { ok: true, version: PREVIEW_VERSION, packages: files.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2)
      throw Error("Usage: node scripts/check-versions.mjs");
    console.log(JSON.stringify(await checkVersions()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
