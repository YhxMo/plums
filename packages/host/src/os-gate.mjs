import { execFileSync } from "node:child_process";
export function parseMacosMajor(version) {
  const match = /^(\d+)\.\d+(?:\.\d+)?$/.exec(version.trim());
  return match ? Number(match[1]) : null;
}
export function macosMajor() {
  if (process.platform !== "darwin") return null;
  const major = parseMacosMajor(
    execFileSync("/usr/bin/sw_vers", ["-productVersion"], {
      encoding: "utf8",
      timeout: 10_000,
    }),
  );
  if (major === null)
    throw Error("Cannot determine macOS major for test gates");
  return major;
}

export const controlledRuntimeSupported =
  process.platform === "darwin" && process.arch === "arm64";
// macOS 15 rejects re-signed system arm64e programs; target acceptance starts at 27.
export function controlledSystemProgramSupported() {
  return controlledRuntimeSupported && macosMajor() >= 27;
}
