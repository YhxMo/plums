import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishDirectory } from "./publish-directory.mjs";
import { projectFiles } from "./project-files.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", ...options });
const args = process.argv.slice(2);
if (args[0] === "--publish" && args.length === 2) {
  const candidate = resolve(args[1]);
  const info = JSON.parse(readFileSync(join(candidate, "build-info.json")));
  run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    join(candidate, info.app),
  ]);
  console.log(
    JSON.stringify(
      publishDirectory(
        candidate,
        join(root, "release/mac"),
        join(root, ".cache/archive/releases"),
      ),
    ),
  );
  process.exit(0);
}
if (args.length && !(args.length === 1 && args[0] === "--stage"))
  throw new Error("Usage: release-mac.mjs [--stage | --publish candidate]");
if (process.platform !== "darwin")
  throw new Error("Mac packaging requires macOS");

run(
  process.execPath,
  [
    "scripts/tauri.mjs",
    "build",
    "--debug",
    "--bundles",
    "app",
    "--config",
    JSON.stringify({ bundle: { macOS: { signingIdentity: "-" } } }),
  ],
  { stdio: "inherit" },
);

const config = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.conf.json")),
);
const release = join(root, "release");
mkdirSync(release, { recursive: true });
const stage = mkdtempSync(join(release, ".mac-"));
const name = `${config.productName}.app`;
const app = join(stage, name);
const target = resolve(
  root,
  process.env.CARGO_TARGET_DIR ?? "src-tauri/target",
);
const built = join(target, "debug/bundle/macos", name);
run("ditto", [built, app]);
run("codesign", ["--verify", "--deep", "--strict", app]);

const sourceFiles = new Set(projectFiles(root));
let patch = run("git", ["diff", "--binary", "HEAD"]);
for (const path of run("git", [
  "ls-files",
  "--others",
  "--exclude-standard",
]).split("\n")) {
  if (!sourceFiles.has(path) || path === "goal.md") continue;
  try {
    patch += run("git", ["diff", "--no-index", "--", "/dev/null", path]);
  } catch (error) {
    if (error.status !== 1) throw error;
    patch += error.stdout;
  }
}
writeFileSync(join(stage, "source.patch"), patch);

const files = {};
function checksum(directory, prefix = "") {
  const names = readdirSync(directory).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify(readdirSync(join(app, prefix)).sort())
  )
    throw new Error(`Copied app inventory differs: ${prefix}`);
  for (const name of names) {
    const path = join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(path);
    if (stat.isDirectory()) checksum(path, relative);
    else {
      const content = stat.isSymbolicLink()
        ? Buffer.from(`symlink:${readlinkSync(path)}`)
        : readFileSync(path);
      const copied = stat.isSymbolicLink()
        ? Buffer.from(`symlink:${readlinkSync(join(app, relative))}`)
        : readFileSync(join(app, relative));
      if (!content.equals(copied))
        throw new Error(`Copied app content differs: ${relative}`);
      files[relative] = createHash("sha256").update(content).digest("hex");
    }
  }
}
checksum(built);
const info = JSON.parse(
  run("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    join(app, "Contents/Info.plist"),
  ]),
);
const metadata = {
  schema: 1,
  builtAt: new Date().toISOString(),
  app: name,
  version: info.CFBundleShortVersionString,
  bundleIdentifier: info.CFBundleIdentifier,
  architecture: run("lipo", [
    "-archs",
    join(app, "Contents/MacOS", info.CFBundleExecutable),
  ]).trim(),
  profile: "debug",
  signing: "ad-hoc",
  source: {
    commit: run("git", ["rev-parse", "HEAD"]).trim(),
    patch: "source.patch",
  },
  verification: { build: "passed", codeSignature: "passed" },
  checksumMethod:
    "SHA-256 per file; symbolic links use their target prefixed by symlink:",
  files,
};
writeFileSync(
  join(stage, "build-info.json"),
  JSON.stringify(metadata, null, 2) + "\n",
);
writeFileSync(
  join(stage, "README.md"),
  `# Plums Mac 本地预览\n\n打开 \`${name}\`。版本 ${metadata.version}，${metadata.architecture}，debug 本地临时签名；SDK 仍为实验接口。\n\n来源和文件校验见 build-info.json，未提交差异见 source.patch。实际运行范围以项目 evidence/RESULTS.md 的对应源码记录为准。\n`,
);

if (args[0] === "--stage") {
  console.log(JSON.stringify({ candidate: stage, app: join(stage, name) }));
} else {
  const result = publishDirectory(
    stage,
    join(release, "mac"),
    join(root, ".cache/archive/releases"),
  );
  console.log(
    JSON.stringify({
      app: `release/mac/${name}`,
      archived: result.archived ? result.archived.slice(root.length) : null,
    }),
  );
}
