import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, symlink, mkdtemp, readFile } from "node:fs/promises";
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
export async function readHistoricalArchive(
  version: 6 | 7,
  directory = fileURLToPath(
    new URL("./fixtures/historical-core/", import.meta.url),
  ),
) {
  const expectedCommit =
    version === 7 ? HISTORICAL_CORE_SEVEN_COMMIT : HISTORICAL_CORE_COMMIT;
  const expectedHash = version === 7 ? SEVEN_ARCHIVE_SHA256 : ARCHIVE_SHA256;
  const name = `core-schema-${version}.tar`;
  const manifest = JSON.parse(
    await readFile(path.join(directory, "sha256.json"), "utf8"),
  ) as { archive: string; commit: string; sha256: string }[];
  const entry = manifest.find((item) => item.archive === name);
  if (
    manifest.length !== 2 ||
    !entry ||
    entry.commit !== expectedCommit ||
    entry.sha256 !== expectedHash
  )
    throw Error(
      "Historical Core archive manifest does not match its pinned fixture identity",
    );
  let archive: Buffer;
  try {
    archive = await readFile(path.join(directory, name));
  } catch {
    throw Error(
      `Historical Core fixture ${name} is unavailable; restore the checked-in fixtures/historical-core directory (Git history is not required)`,
    );
  }
  const actualHash = createHash("sha256").update(archive).digest("hex");
  if (actualHash !== expectedHash)
    throw Error(
      `Historical fixture ${name} hash mismatch: expected ${expectedHash}, got ${actualHash}`,
    );
  return archive;
}
// Validate raw headers before tar can normalize paths or create any entry.
export function validateHistoricalArchive(archive: Buffer) {
  const field = (header: Buffer, start: number, length: number) =>
    header
      .subarray(start, start + length)
      .toString("utf8")
      .replace(/\0.*$/s, "");
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (!archive.subarray(offset).every((byte) => byte === 0))
        throw Error("Historical archive has entries after its end marker");
      return;
    }
    const octal = (start: number, length: number) => {
      const value = field(header, start, length).trim();
      if (!/^[0-7]+$/.test(value)) throw Error("Invalid historical tar number");
      return Number.parseInt(value, 8);
    };
    const checksum = [...header].reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (checksum !== octal(148, 8))
      throw Error("Invalid historical tar checksum");
    const size = octal(124, 12);
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(size) || end > archive.length)
      throw Error("Truncated historical tar entry");
    const prefix = field(header, 345, 155);
    const name = (prefix ? `${prefix}/` : "") + field(header, 0, 100);
    const type = field(header, 156, 1);
    if (type === "g") {
      const metadata = archive
        .subarray(offset + 512, offset + 512 + size)
        .toString("utf8");
      if (
        name !== "pax_global_header" ||
        !/^\d+ comment=[a-f0-9]{40}\n$/.test(metadata)
      )
        throw Error("Unsupported historical tar metadata");
    } else {
      const parts = name.split("/");
      if (
        name.startsWith("/") ||
        name.includes("\\") ||
        parts.includes("..") ||
        parts.includes(".") ||
        !(
          name === "packages/" ||
          name === "packages/core/" ||
          name.startsWith("packages/core/src/")
        )
      )
        throw Error(
          `Historical archive entry escapes the source directory: ${name}`,
        );
      if (!["", "0", "5"].includes(type))
        throw Error(`Historical archive entry has forbidden type: ${type}`);
      if ((name === "packages/" || name === "packages/core/") && type !== "5")
        throw Error("Historical archive ancestor must be a directory");
    }
    offset = end;
  }
  throw Error("Historical archive is missing its end marker");
}
export async function buildHistoricalCore(version: 6 | 7 = 6) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dir = await mkdtemp(
    path.join(os.tmpdir(), `plums-authentic-core-${version}-`),
  );
  try {
    const archive = await readHistoricalArchive(version);
    const archiveDigest = version === 7 ? SEVEN_ARCHIVE_SHA256 : ARCHIVE_SHA256;
    validateHistoricalArchive(archive);
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
    )) as Omit<typeof Current, "createCore"> & {
      createCore(options: Current.CreateCoreOptions): Current.Core & {
        engineTrustSnapshot(packageId: string, engineId: string): Promise<any>;
        grantEngineTrust(snapshot: any): Promise<boolean>;
        revokeEngineTrust(packageId: string, engineId?: string): Promise<void>;
      };
    };
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
