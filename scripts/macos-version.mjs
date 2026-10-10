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
