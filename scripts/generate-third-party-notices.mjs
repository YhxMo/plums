import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const ALLOWED_LICENSES = Object.freeze([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "0BSD",
  "CC0-1.0",
  "Python-2.0",
  "Unlicense",
]);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));

async function resolvePackage(parent, name) {
  let directory = parent;
  for (;;) {
    try {
      return await realpath(path.join(directory, "node_modules", name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const next = path.dirname(directory);
    if (next === directory)
      throw Error(`Production dependency not installed: ${name}`);
    directory = next;
  }
}

async function licenseText(directory, id) {
  const files = (await readdir(directory))
    .filter((file) => /^(?:LICEN[CS]E|COPYING)(?:[._-].*)?$/i.test(file))
    .sort();
  if (!files.length) throw Error(`Missing LICENSE file: ${id}`);
  const texts = [];
  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    if (!text.trim()) throw Error(`Empty LICENSE file: ${id}/${file}`);
    texts.push(`${file}\n${text.trimEnd()}\n`);
  }
  return texts.join("\n");
}

export async function collectProductionPackages(root = repository) {
  const lock = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  const locked = new Set(
    [...lock.matchAll(/^  ['"]?([^\s]+?)['"]?:\s*(?:\{|$)/gm)].map((match) =>
      match[1].replace(/\(.*$/, ""),
    ),
  );
  const workspaces = [root];
  for (const entry of await readdir(path.join(root, "packages"), {
    withFileTypes: true,
  }))
    if (entry.isDirectory())
      workspaces.push(path.join(root, "packages", entry.name));
  const queue = [];
  for (const directory of workspaces) {
    let manifest;
    try {
      manifest = await json(path.join(directory, "package.json"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const name of Object.keys(manifest.dependencies ?? {}))
      if (!manifest.dependencies[name].startsWith("workspace:"))
        queue.push({ parent: directory, name });
  }
  const seen = new Set(),
    packages = new Map();
  while (queue.length) {
    const { parent, name } = queue.shift();
    const directory = await resolvePackage(parent, name);
    if (seen.has(directory)) continue;
    seen.add(directory);
    const manifest = await json(path.join(directory, "package.json"));
    const id = `${manifest.name}@${manifest.version}`;
    if (manifest.name !== name || !locked.has(id))
      throw Error(
        `Installed production dependency differs from lockfile: ${id}`,
      );
    if (!ALLOWED_LICENSES.includes(manifest.license))
      throw Error(
        `License outside allowlist: ${id} (${manifest.license ?? "UNKNOWN"})`,
      );
    const text = await licenseText(directory, id);
    const previous = packages.get(id);
    if (previous && previous.text !== text)
      throw Error(`Conflicting LICENSE files for ${id}`);
    packages.set(id, {
      id,
      name,
      version: manifest.version,
      license: manifest.license,
      text,
      directory,
    });
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    }))
      queue.push({ parent: directory, name: dependency });
  }
  return [...packages.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

export function formatProductionNotices(packages) {
  return packages
    .map(
      ({ id, license, text }) =>
        `${"=".repeat(72)}\n${id}\nLicense: ${license}\n\n${text}`,
    )
    .join("\n");
}

export async function generateThirdPartyNotices({
  root = repository,
  nodeLicense = path.join(root, ".artifacts/node-v26.5.1-darwin-arm64/LICENSE"),
  output = path.join(root, "THIRD_PARTY_NOTICES.txt"),
} = {}) {
  const packages = await collectProductionPackages(root);
  const desktop = await json(path.join(root, "packages/desktop/package.json"));
  const electronDir = await resolvePackage(
    path.join(root, "packages/desktop"),
    "electron",
  );
  const electron = await json(path.join(electronDir, "package.json"));
  const lock = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  if (
    electron.version !== desktop.devDependencies.electron ||
    !lock.includes(`electron@${electron.version}:`) ||
    electron.license !== "MIT"
  )
    throw Error(
      "Electron runtime identity/license differs from the pinned manifest",
    );
  const electronText = await readFile(
    path.join(electronDir, "dist/LICENSE"),
    "utf8",
  );
  const chromiumSource = path.join(electronDir, "dist/LICENSES.chromium.html");
  if (!(await readFile(chromiumSource, "utf8")).trim())
    throw Error("Missing Chromium third-party licenses");
  const nodeText = await readFile(nodeLicense, "utf8");
  if (!nodeText.includes("V8") || !electronText.trim())
    throw Error("Runtime license text is incomplete");
  const sqlite = packages.find((pkg) => pkg.name === "better-sqlite3");
  const isolate = packages.find((pkg) => pkg.name === "isolated-vm");
  if (!sqlite || !isolate)
    throw Error("Native runtime dependencies are missing");
  const sqliteSource = await readFile(
    path.join(sqlite.directory, "deps/sqlite3/sqlite3.h"),
    "utf8",
  );
  const sqliteNotice = sqliteSource.match(/^\/\*[\s\S]*?\*\//)?.[0];
  if (
    !sqliteNotice ||
    !sqliteNotice.includes(
      "The author disclaims copyright to this source code.",
    )
  )
    throw Error("SQLite public-domain dedication is missing");
  const text =
    [
      "Plums — third-party notices",
      "Production dependency closure only. Development tools are excluded.",
      formatProductionNotices(packages),
      `${"=".repeat(72)}\nElectron ${electron.version}\nLicense: MIT\n\n${electronText.trimEnd()}`,
      "Chromium: see the accompanying LICENSES.chromium.html for complete license texts.",
      "isolated-vm uses V8 (BSD-3-Clause). V8 and its bundled notices are reproduced in the Node.js license section below.",
      `better-sqlite3 bundles SQLite, dedicated to the public domain. Source: https://www.sqlite.org/copyright.html\n\n${sqliteNotice}`,
      `${"=".repeat(72)}\nNode.js 26.5.1 and bundled dependencies\nSource: node/LICENSE\n\n${nodeText.trimEnd()}`,
    ].join("\n\n") + "\n";
  await writeFile(output, text);
  return {
    productionPackages: packages.length,
    electronLicense: path.join(electronDir, "dist/LICENSE"),
    chromiumSource,
    output,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2)
      throw Error("Usage: node scripts/generate-third-party-notices.mjs");
    const result = await generateThirdPartyNotices();
    console.log(
      JSON.stringify({
        ok: true,
        productionPackages: result.productionPackages,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
