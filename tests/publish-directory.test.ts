import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  candidateProblems,
  publishDirectory,
} from "../scripts/publish-directory.mjs";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plums-publish-"));
  roots.push(root);
  const stage = join(root, "candidate"),
    current = join(root, "mac"),
    archives = join(root, "archives");
  for (const [dir, value] of [
    [stage, "accepted"],
    [current, "previous"],
  ]) {
    mkdirSync(dir);
    writeFileSync(join(dir, "app"), value);
  }
  return { root, stage, current, archives };
}
test("publishes accepted candidate and archives the previous complete directory", () => {
  const f = fixture();
  const result = publishDirectory(f.stage, f.current, f.archives);
  expect(readFileSync(join(f.current, "app"), "utf8")).toBe("accepted");
  expect(readFileSync(join(result.archived!, "app"), "utf8")).toBe("previous");
  expect(existsSync(f.stage)).toBe(false);
});
test("replacement failure restores the previous delivery and leaves candidate for inspection", () => {
  const f = fixture();
  expect(() =>
    publishDirectory(
      f.stage,
      f.current,
      f.archives,
      (from: string, to: string) => {
        if (from === f.stage) throw Error("injected replacement failure");
        renameSync(from, to);
      },
    ),
  ).toThrow("injected replacement failure");
  expect(readFileSync(join(f.current, "app"), "utf8")).toBe("previous");
  expect(readFileSync(join(f.stage, "app"), "utf8")).toBe("accepted");
});
test("missing and overlapping candidates never move the current delivery", () => {
  const f = fixture();
  for (const stage of [
    f.current,
    join(f.current, "nested"),
    f.root,
    join(f.root, "absent"),
  ])
    expect(() => publishDirectory(stage, f.current, f.archives)).toThrow();
  expect(readFileSync(join(f.current, "app"), "utf8")).toBe("previous");
});

test("a candidate is published only if no packaged source changed since it was built", () => {
  const ok = {
    patch: "",
    changed: ["HANDOFF.md", "evidence/X.md", "docs/a.md"],
  };
  expect(candidateProblems(ok)).toEqual([]);
  expect(candidateProblems({ ...ok, patch: "diff --git a/x b/x" })).toEqual([
    "the candidate was built from uncommitted changes",
  ]);
  expect(
    candidateProblems({
      ...ok,
      changed: ["evidence/X.md", "src/features/extensions/ExtensionCard.tsx"],
    }),
  ).toEqual([
    "source changed since the candidate was built: src/features/extensions/ExtensionCard.tsx",
  ]);
  expect(candidateProblems({ ...ok, changed: null })).toEqual([
    "the candidate's commit is not part of the current history",
  ]);
});
