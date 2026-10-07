// Integration fixtures use the standalone Node runtime required by the OS sandbox.
import { access, mkdir, readFile, rm, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
if (process.platform === "darwin" && process.arch === "arm64") {
  if (process.version !== "v26.5.1")
    throw new Error("Application integration tests require Node.js 26.5.1");
  const version = "26.5.1",
    cache = path.resolve(".artifacts"),
    archive = `node-v${version}-darwin-arm64.tar.gz`,
    directory = path.join(cache, archive.replace(".tar.gz", "")),
    executable = path.join(directory, "bin/node");
  await mkdir(cache, { recursive: true });
  let exists = false;
  try {
    await access(executable);
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (exists && (await lstat(executable)).isSymbolicLink())
    throw new Error("Integration runtime must be a standalone executable");
  if (!exists) {
    const base = `https://nodejs.org/dist/v${version}/`,
      downloaded = path.join(cache, archive);
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
    const checksum = checksums
      .split("\n")
      .find((line) => line.trim().endsWith(" " + archive))
      ?.split(/\s+/)[0];
    if (
      !checksum ||
      checksum !==
        createHash("sha256")
          .update(await readFile(downloaded))
          .digest("hex")
    )
      throw new Error("Node.js archive checksum mismatch");
    execFileSync("tar", ["-xzf", downloaded, "-C", cache]);
    await rm(downloaded);
  }
  if (
    execFileSync(executable, ["--version"], {
      encoding: "utf8",
      env: {},
    }).trim() !== "v26.5.1"
  )
    throw new Error("Integration runtime version mismatch");
}
