import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { writeSourcePatch } from "../scripts/source-patch.mjs";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

test("source patches stream large tracked and new files and replay the complete candidate", () => {
  const root = mkdtempSync(join(tmpdir(), "plums-source-patch-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "--quiet");
  writeFileSync(join(root, "tracked.txt"), "baseline\n");
  writeFileSync(join(root, "deleted.txt"), "remove me\n");
  git("add", "tracked.txt", "deleted.txt");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "fixture baseline",
  );
  const large = "candidate line\n".repeat(100_000);
  writeFileSync(join(root, "tracked.txt"), large);
  writeFileSync(join(root, "new module.js"), large);
  writeFileSync(join(root, "ignored.txt"), "not source\n");
  writeFileSync(join(root, "goal.md"), "private fixture\n");
  rmSync(join(root, "deleted.txt"));
  const patch = join(root, "candidate.patch");
  writeSourcePatch(
    root,
    patch,
    new Set(["tracked.txt", "new module.js", "goal.md"]),
  );
  const text = readFileSync(patch, "utf8");
  expect(text.length).toBeGreaterThan(2 * 1024 * 1024);
  expect(text).not.toContain("private fixture");
  expect(text).not.toContain("not source");
  git("restore", "--source=HEAD", "--", "tracked.txt", "deleted.txt");
  rmSync(join(root, "new module.js"));
  git("apply", "--check", patch);
  git("apply", patch);
  expect(readFileSync(join(root, "tracked.txt"), "utf8")).toBe(large);
  expect(readFileSync(join(root, "new module.js"), "utf8")).toBe(large);
  expect(() => readFileSync(join(root, "deleted.txt"))).toThrow();
});
