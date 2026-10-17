import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, it } from "vitest";
import { projectFiles } from "../scripts/project-files.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), "plums-files-"));
  roots.push(root);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

it("anchors generated-output exclusions instead of matching basenames", () => {
  const root = fixture([
    "src/gen/keep.ts",
    "tests/raw/keep.ts",
    "extensions/x/node_modules/pkg/index.js",
    "pkg/.git/config",
    "src-tauri/gen/drop.ts",
    "src-tauri/target/drop.txt",
    "evidence/raw/drop.txt",
    "node_modules/pkg/index.js",
    "release/app.txt",
  ]);
  const files = projectFiles(root);
  expect(files).toContain("src/gen/keep.ts");
  expect(files).toContain("tests/raw/keep.ts");
  expect(files).not.toContain("src-tauri/gen/drop.ts");
  expect(files).not.toContain("src-tauri/target/drop.txt");
  expect(files).not.toContain("evidence/raw/drop.txt");
  expect(files).not.toContain("release/app.txt");
  expect(files).not.toContain("extensions/x/node_modules/pkg/index.js");
  expect(files).not.toContain("pkg/.git/config");
  expect(files.some((file) => file.startsWith("node_modules/"))).toBe(false);
});
