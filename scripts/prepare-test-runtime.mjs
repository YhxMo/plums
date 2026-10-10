// Integration fixtures use the standalone Node runtime required by the OS sandbox.
import { mkdir, readFile, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const version = "26.5.1";
export function assertNodeArchive(bytes, checksums, pin) {
  const siteHash = checksums
    .split("\n")
    .find((line) => line.trim().endsWith(" " + pin.archive))
    ?.split(/\s+/)[0];
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== pin.sha256 || hash !== siteHash)
    throw new Error(
      "Node.js archive checksum mismatch against repository pin or official manifest",
    );
  return hash;
}
export async function prepareTestRuntime() {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  if (process.version !== `v${version}`)
    throw new Error("Application integration tests require Node.js 26.5.1");
  const pin = JSON.parse(
    await readFile(new URL("../ci/node-runtime.json", import.meta.url), "utf8"),
  );
  const archive = `node-v${version}-darwin-arm64.tar.gz`;
  if (
    pin.version !== version ||
    pin.archive !== archive ||
    !/^[a-f0-9]{64}$/.test(pin.sha256)
  )
    throw new Error("Pinned Node.js runtime identity mismatch");
  const cache = path.resolve(".artifacts"),
    downloaded = path.join(cache, archive);
  const directory = path.join(cache, archive.replace(".tar.gz", "")),
    executable = path.join(directory, "bin/node");
  await mkdir(cache, { recursive: true });
  const base = `https://nodejs.org/dist/v${version}/`;
  if (!existsSync(downloaded))
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
        downloaded,
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
  assertNodeArchive(await readFile(downloaded), checksums, pin);
  if (existsSync(executable) && (await lstat(executable)).isSymbolicLink())
    throw new Error("Integration runtime must be a standalone executable");
  // Re-extract the verified archive so an older/unverified extracted cache cannot be reused.
  execFileSync("tar", ["-xzf", downloaded, "-C", cache]);
  if (
    execFileSync(executable, ["--version"], {
      encoding: "utf8",
      env: {},
    }).trim() !== `v${version}`
  )
    throw new Error("Integration runtime version mismatch");
  console.log(
    JSON.stringify({
      runtime: version,
      archive,
      sha256: pin.sha256,
      repositoryPin: true,
      officialManifest: true,
      signatureVerified: false,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await prepareTestRuntime();
