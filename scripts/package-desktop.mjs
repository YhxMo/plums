import { packager } from "@electron/packager";
import { cp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
const root = process.cwd(),
  artifacts = path.join(root, ".artifacts"),
  stage = path.join(artifacts, "desktop-app");
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("This packaging target is macOS arm64");
const nodeVersion = "26.5.1",
  archive = `node-v${nodeVersion}-darwin-arm64.tar.gz`,
  nodeDir = path.join(artifacts, archive.replace(".tar.gz", ""));
await mkdir(artifacts, { recursive: true });
try {
  await access(path.join(nodeDir, "bin/node"));
} catch {
  console.log("Downloading verified standalone Node " + nodeVersion);
  const base = `https://nodejs.org/dist/v${nodeVersion}/`;
  execFileSync(
    "curl",
    [
      "--fail",
      "--location",
      "--connect-timeout",
      "15",
      "--max-time",
      "180",
      "--output",
      path.join(artifacts, archive),
      base + archive,
    ],
    { stdio: "inherit" },
  );
  const checksums = execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--connect-timeout",
      "15",
      "--max-time",
      "30",
      base + "SHASUMS256.txt",
    ],
    { encoding: "utf8" },
  );
  const bytes = await readFile(path.join(artifacts, archive)),
    sha = createHash("sha256").update(bytes).digest("hex");
  const line = checksums
    .split("\n")
    .find((l) => l.trim().endsWith(" " + archive));
  if (!line || line.split(/\s+/)[0] !== sha)
    throw Error("Node checksum mismatch");
  await writeFile(path.join(artifacts, archive), bytes);
  execFileSync("tar", ["-xzf", path.join(artifacts, archive), "-C", artifacts]);
}
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "plums-desktop",
      productName: "Plums",
      version: "0.1.0",
      type: "module",
      main: "dist/main.js",
      license: "Apache-2.0",
    },
    null,
    2,
  ),
);
await cp(path.join(root, "packages/desktop/dist"), path.join(stage, "dist"), {
  recursive: true,
});
await cp(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
const hostRequire = createRequire(
    path.join(root, "packages/host/package.json"),
  ),
  coreRequire = createRequire(path.join(root, "packages/core/package.json"));
for (const [name, req] of [
  ["isolated-vm", hostRequire],
  ["node-gyp-build", createRequire(hostRequire.resolve("isolated-vm"))],
  ["better-sqlite3", coreRequire],
]) {
  const location = path.dirname(req.resolve(name + "/package.json"));
  await cp(location, path.join(stage, "node_modules", name), {
    recursive: true,
    dereference: true,
  });
}
const applications = await packager({
  dir: stage,
  out: path.join(root, "release"),
  name: "Plums",
  platform: "darwin",
  arch: "arm64",
  electronVersion: "44.5.1",
  appBundleId: "com.plums.desktop",
  appVersion: "0.1.0",
  extendInfo: { LSMinimumSystemVersion: "13.5" },
  overwrite: true,
  prune: false,
  asar: false,
});
const application = path.join(applications[0], "Plums.app"),
  resource = path.join(application, "Contents/Resources");
await rm(path.join(resource, "node"), { recursive: true, force: true });
await mkdir(path.join(resource, "node/bin"), { recursive: true });
await cp(path.join(nodeDir, "bin/node"), path.join(resource, "node/bin/node"), {
  dereference: true,
});
await cp(path.join(nodeDir, "LICENSE"), path.join(resource, "node/LICENSE"));
execFileSync(
  "codesign",
  ["--force", "--sign", "-", path.join(resource, "node/bin/node")],
  { stdio: "inherit" },
);
execFileSync("codesign", ["--force", "--deep", "--sign", "-", application], {
  stdio: "inherit",
});
execFileSync("codesign", ["--verify", "--deep", "--strict", application], {
  stdio: "inherit",
});
execFileSync(
  path.join(resource, "node/bin/node"),
  [
    "--no-node-snapshot",
    "--input-type=module",
    "-e",
    "import ivm from './node_modules/isolated-vm/isolated-vm.js';import DB from './node_modules/better-sqlite3/lib/index.js';const isolate=new ivm.Isolate({memoryLimit:64});const db=new DB(':memory:');db.close();isolate.dispose();console.log('Packaged native modules loaded');",
  ],
  { cwd: path.join(resource, "app"), stdio: "inherit" },
);
const dmg = path.join(root, "release", "Plums-0.1.0-arm64.dmg");
execFileSync(
  "hdiutil",
  [
    "create",
    "-volname",
    "Plums",
    "-srcfolder",
    application,
    "-ov",
    "-format",
    "UDZO",
    dmg,
  ],
  { stdio: "inherit" },
);
console.log("App: " + application);
console.log("Installer: " + dmg);
