import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, symlink, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as Current from "../src/index.js";

// The fixture is built from the immutable historical implementation, never from
// current Store SQL with a forged user_version. No ignored artifact is required.
export const HISTORICAL_CORE_COMMIT =
  "27be7067d3b1571608561a8bf277370b0ddf74d2";
const ARCHIVE_SHA256 =
  "8c9db29cfba0ecae3a59fffdca8863d4c020048254b5474961c68a85c53582ed";
export const HISTORICAL_CORE_SEVEN_COMMIT =
  "69c01b734ffb9c8e9143d40b98641abb73f04c85";
const SEVEN_ARCHIVE_SHA256 =
  "20914c1d3aeed3b8e95a65b2999bdbe46dc788ace3f07129ede7ef2c00d717b6";
export async function buildHistoricalCore(version: 6 | 7 = 6) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dir = await mkdtemp(
    path.join(os.tmpdir(), `plums-authentic-core-${version}-`),
  );
  try {
    const archive = execFileSync(
      "git",
      [
        "archive",
        version === 7 ? HISTORICAL_CORE_SEVEN_COMMIT : HISTORICAL_CORE_COMMIT,
        "packages/core/src",
      ],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 },
    );
    const archiveDigest = version === 7 ? SEVEN_ARCHIVE_SHA256 : ARCHIVE_SHA256;
    if (createHash("sha256").update(archive).digest("hex") !== archiveDigest)
      throw Error(
        "Historical Core source archive does not match its fixture identity",
      );
    execFileSync("tar", ["-xf", "-", "-C", dir], { input: archive });
    const pkg = path.join(dir, "packages/core");
    await mkdir(pkg, { recursive: true });
    await writeFile(path.join(pkg, "package.json"), '{"type":"module"}');
    await symlink(
      path.join(root, "packages/core/node_modules"),
      path.join(pkg, "node_modules"),
      "dir",
    );
    await writeFile(
      path.join(pkg, "tsconfig.json"),
      JSON.stringify({
        extends: path.join(root, "tsconfig.base.json"),
        compilerOptions: {
          rootDir: "src",
          outDir: "implementation",
          declaration: false,
          sourceMap: false,
        },
        include: ["src"],
      }),
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        path.join(pkg, "tsconfig.json"),
      ],
      { cwd: root, timeout: 15_000 },
    );
    const old = (await import(
      /* @vite-ignore */ pathToFileURL(
        path.join(pkg, "implementation/index.js"),
      ).href
    )) as typeof Current;
    const store = (await import(
      /* @vite-ignore */ pathToFileURL(
        path.join(pkg, "implementation/install/store.js"),
      ).href
    )) as {
      InstallStore: typeof import("../src/install/store.js").InstallStore;
      SCHEMA_VERSION: number;
    };
    if (store.SCHEMA_VERSION !== version)
      throw Error(`Historical Core must create schema ${version}`);
    return { dir, old, store, archiveDigest };
  } catch (error) {
    await (
      await import("node:fs/promises")
    ).rm(dir, { recursive: true, force: true });
    throw error;
  }
}
