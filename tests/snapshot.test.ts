import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plums-snapshot-"));
  roots.push(root);
  mkdirSync(join(root, "evidence"), { recursive: true });
  writeFileSync(join(root, "source.js"), "export const version = 1;\n");
  writeFileSync(
    join(root, "evidence/source-manifest.json"),
    "historical evidence\n",
  );
  const run = () =>
    spawnSync(process.execPath, [resolve("scripts/snapshot.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
  return { root, run };
}

it("creates distinct source-addressed manifests and preserves historical evidence", () => {
  const { root, run } = fixture();
  const first = run();
  expect(first.status).toBe(0);
  expect(
    readFileSync(join(root, "evidence/source-manifest.json"), "utf8"),
  ).toBe("historical evidence\n");
  const a = JSON.parse(first.stdout);
  expect(a.path).toBe(`evidence/source-manifest-${a.sha256}.json`);
  const before = readFileSync(join(root, a.path), "utf8");
  writeFileSync(join(root, "source.js"), "export const version = 2;\n");
  const second = run();
  expect(second.status).toBe(0);
  const b = JSON.parse(second.stdout);
  expect(b.path).not.toBe(a.path);
  expect(readFileSync(join(root, a.path), "utf8")).toBe(before);
  expect(JSON.parse(readFileSync(join(root, b.path), "utf8")).sha256).toBe(
    b.sha256,
  );
});

it("refuses to overwrite an existing destination even when its content changed", () => {
  const { root, run } = fixture();
  const first = run();
  expect(first.status).toBe(0);
  const { sha256 } = JSON.parse(first.stdout);
  const target = join(root, `evidence/source-manifest-${sha256}.json`);
  writeFileSync(target, "preserve existing bytes\n");
  const second = run();
  expect(second.status).not.toBe(0);
  expect(readFileSync(target, "utf8")).toBe("preserve existing bytes\n");
});
