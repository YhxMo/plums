import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true })),
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plums-docs-"));
  roots.push(root);
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, ".gitignore"), "/goal.md\n");
  writeFileSync(join(root, "README.md"), "[文档](docs/README.md)\n");
  writeFileSync(join(root, "docs/README.md"), "# 文档导航\n");
  const run = () =>
    spawnSync(process.execPath, [resolve("scripts/check-project.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
  return { root, run };
}

it("accepts a current-only documentation tree without an archive", () => {
  const { run } = fixture();
  const result = run();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it("still requires current documents to be indexed and dated", () => {
  const { root, run } = fixture();
  writeFileSync(join(root, "docs/CONTRACT.md"), "# 契约\n");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("missing docs index entry");
  expect(result.stdout).toContain("missing status line");
});

it("still rejects links to removed documents", () => {
  const { root, run } = fixture();
  writeFileSync(join(root, "docs/README.md"), "[旧说明](removed.md)\n");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stdout).toContain("missing link removed.md");
});
