import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstat,
  readFile,
  realpath,
  readdir,
  readlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPackageManifest } from "./package-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inventory(directory) {
  const entries = [];
  async function visit(relative) {
    const file = path.join(directory, relative),
      info = await lstat(file);
    if (info.isSymbolicLink())
      entries.push({
        path: relative,
        type: "link",
        target: await readlink(file),
      });
    else if (info.isFile())
      entries.push({
        path: relative,
        type: "file",
        mode: info.mode & 0o777,
        sha256: sha256(await readFile(file)),
      });
    else if (info.isDirectory())
      for (const name of (await readdir(file)).sort())
        await visit(relative ? relative + "/" + name : name);
    else throw Error("Unexpected special file in delivery");
  }
  await visit("");
  return entries;
}
async function productionInputs() {
  const entries = [];
  for (const name of ["core", "cli", "sdk", "host", "desktop"]) {
    for (const entry of await inventory(
      path.join(root, "packages", name, "src"),
    ))
      entries.push({ ...entry, path: `packages/${name}/src/${entry.path}` });
    for (const file of ["package.json", "tsconfig.json"])
      entries.push({
        path: `packages/${name}/${file}`,
        sha256: sha256(await readFile(path.join(root, "packages", name, file))),
      });
  }
  for (const file of ["package.json", "pnpm-lock.yaml", "tsconfig.base.json"])
    entries.push({
      path: file,
      sha256: sha256(await readFile(path.join(root, file))),
    });
  for (const file of (await readdir(path.join(root, "scripts"))).sort())
    if (file.endsWith(".mjs"))
      entries.push({
        path: `scripts/${file}`,
        sha256: sha256(await readFile(path.join(root, "scripts", file))),
      });
  return { sha256: sha256(JSON.stringify(entries)), entries };
}

async function main() {
  const [builtPath, installedPath, imagePath, out] = process.argv.slice(2);
  if (
    !builtPath ||
    !installedPath ||
    !imagePath ||
    !out ||
    process.argv.length !== 6
  )
    throw Error(
      "Usage: node scripts/verify-desktop-delivery.mjs <built.app> <installed.app> <image.dmg> <report.json>",
    );
  const built = path.resolve(builtPath),
    installed = path.resolve(installedPath);
  assert.notEqual(
    await realpath(built),
    await realpath(installed),
    "Use an independent installed app copy",
  );
  const [builtInventory, installedInventory] = await Promise.all([
    inventory(built),
    inventory(installed),
  ]);
  assert.deepEqual(
    installedInventory,
    builtInventory,
    "Installed app differs from the packaged app",
  );
  const resources = path.join(installed, "Contents/Resources");
  const packageInventory = await checkPackageManifest(resources);
  const dist = await inventory(path.join(root, "packages/desktop/dist"));
  const distPrefix = "Contents/Resources/app/dist/";
  assert.deepEqual(
    installedInventory
      .filter((entry) => entry.path.startsWith(distPrefix))
      .map((entry) => ({
        ...entry,
        path: entry.path.slice(distPrefix.length),
      })),
    dist,
    "Delivered desktop build differs from current dist",
  );
  const expected = JSON.parse(
    await readFile(path.join(root, "packages/desktop/package.json"), "utf8"),
  ).version;
  assert.equal(
    JSON.parse(await readFile(path.join(resources, "app/package.json"), "utf8"))
      .version,
    expected,
  );
  const plist = await readFile(
    path.join(installed, "Contents/Info.plist"),
    "utf8",
  );
  assert.match(
    plist,
    /<key>LSMinimumSystemVersion<\/key>\s*<string>27\.0\.1<\/string>/,
  );
  const node = path.join(resources, "node/bin/node");
  assert.equal(
    execFileSync(node, ["--version"], { encoding: "utf8" }).trim(),
    "v26.5.1",
  );
  execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
  const signature = spawnSync(
    "codesign",
    ["--display", "--verbose=4", installed],
    { encoding: "utf8" },
  );
  assert.equal(signature.status, 0);
  assert.match(signature.stderr, /Signature=adhoc/);
  const assessment = spawnSync(
    "spctl",
    ["--assess", "--type", "execute", "--verbose=4", installed],
    { encoding: "utf8" },
  );
  assert.notEqual(
    assessment.status,
    null,
    "Gatekeeper assessment did not finish",
  );
  const report = {
    reportVersion: "1.0",
    createdAt: new Date().toISOString(),
    version: expected,
    environment: {
      macOS: execFileSync("sw_vers", ["-productVersion"], {
        encoding: "utf8",
      }).trim(),
      arch: process.arch,
      nodeDriver: process.versions.node,
    },
    productionInputs: await productionInputs(),
    desktopBuildSha256: sha256(JSON.stringify(dist)),
    imageSha256: sha256(await readFile(path.resolve(imagePath))),
    appSha256: sha256(JSON.stringify(installedInventory)),
    inventory: installedInventory,
    resourceInventory: packageInventory,
    checks: {
      installedCopyMatches: true,
      deliveredBuildMatches: true,
      packageManifest: true,
      node: "26.5.1",
      minimumMacOS: "27.0.1",
      signatureVerified: true,
      signature: "local-ad-hoc",
      gatekeeperAccepted: assessment.status === 0,
      gatekeeperExitCode: assessment.status,
      distributionVerified: false,
    },
  };
  await writeFile(path.resolve(out), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      ok: true,
      version: expected,
      imageSha256: report.imageSha256,
      appSha256: report.appSha256,
      entries: installedInventory.length,
      gatekeeperAccepted: report.checks.gatekeeperAccepted,
    }),
  );
}
await main();
