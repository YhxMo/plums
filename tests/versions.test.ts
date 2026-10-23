import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { versionProblems } from "../scripts/versions.mjs";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture(tauriVersion: string, cargoVersion: string) {
  const root = mkdtempSync(join(tmpdir(), "plums-versions-"));
  roots.push(root);
  mkdirSync(join(root, "src-tauri"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version: tauriVersion }),
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    `[package]\nname = "plums"\nversion = "${cargoVersion}"\n\n[dependencies]\nserde = { version = "1" }\n`,
  );
  return root;
}

it("accepts package.json as the one version source", () => {
  expect(versionProblems(fixture("../package.json", "1.2.3"))).toEqual([]);
});

it("rejects a version written into the Tauri config", () => {
  expect(versionProblems(fixture("1.2.3", "1.2.3"))).toEqual([
    'src-tauri/tauri.conf.json: version must be "../package.json"',
  ]);
});

it("rejects a crate version that differs from package.json", () => {
  expect(versionProblems(fixture("../package.json", "1.2.2"))).toEqual([
    "src-tauri/Cargo.toml: version 1.2.2 differs from package.json 1.2.3",
  ]);
});

it("checks the repository itself", () => {
  expect(versionProblems(".")).toEqual([]);
});
