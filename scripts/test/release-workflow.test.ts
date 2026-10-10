import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { assertReleaseWorkflow } from "../check-release-workflow.mjs";
const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

it("the preview workflow keeps writes isolated, requires exact-commit CI and only creates a tag-triggered draft", () => {
  expect(assertReleaseWorkflow(workflow)).toEqual({ ok: true, actions: 8 });
});
it.each([
  ["permissions: {}", "permissions: write-all"],
  ["  workflow_dispatch:", "  pull_request:"],
  ["34e114876b0b11c390a56381ad16ebd13914f8d5", "v4"],
  ['test "$conclusion" = success', 'test "$conclusion" = failure'],
  ["      actions: read", "      actions: write"],
  ["      contents: read", "      contents: write"],
  ["      id-token: write", "      id-token: read"],
  ["    needs: [build, attest]", "    needs: build"],
  [
    "    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    "    if: always()",
  ],
  [" --draft --prerelease", " --prerelease"],
  [" --draft --prerelease", " --draft --latest --prerelease"],
])("rejects weakening %s", (before, after) => {
  expect(workflow).toContain(before);
  expect(() =>
    assertReleaseWorkflow(workflow.replace(before, after)),
  ).toThrow();
});
