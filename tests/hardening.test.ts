import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ESLint } from "eslint";
import { boundaryProblems } from "../scripts/check-boundaries.mjs";
import { checkSize } from "../scripts/check-size.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(file: string, lines: number, finalNewline = true) {
  const root = mkdtempSync(join(tmpdir(), "plums-hardening-"));
  roots.push(root);
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    Array(lines).fill("line").join("\n") + (finalNewline ? "\n" : ""),
  );
  return root;
}

it.each([true, false])(
  "accepts 400 lines and rejects 401 with final newline %s",
  (newline) => {
    expect(checkSize(fixture("src/new.ts", 400, newline)).failures).toBe(0);
    const result = checkSize(fixture("src/new.ts", 401, newline));
    expect(result.failures).toBe(1);
    expect(result.rows[0]).toContain("src/new.ts | 401 | 400 | -1");
    expect(result.rows[0]).toContain("请拆分或说明理由");
  },
);

it("rejects growth beyond an existing cap and reports remaining allowance after shrinkage", () => {
  const file = "src/components/Workspace.module.css";
  expect(checkSize(fixture(file, 952)).failures).toBe(1);
  expect(checkSize(fixture(file, 950)).rows).toEqual([
    `${file} | 950 | 951 | 1`,
  ]);
});

it.each([
  "release/generated.js",
  ".cache/generated.rs",
  "src-tauri/target/generated.rs",
  "docs/large.md",
])("excludes generated output or unsupported extensions: %s", (file) =>
  expect(checkSize(fixture(file, 1000))).toEqual({ rows: [], failures: 0 }),
);

it.each([
  'import { Host } from "../extension-host/host";',
  'import type { Host } from "../extension-host/host";',
  'export type { Host } from "../extension-host/host";',
  'export * from "../shell/runtime";',
  'import "../../src/platform";',
  'const load = () => import("../../src/platform");',
  "const load = () => import(`../../src/platform`);",
  'const host = require("../extension-host/host");',
  String.raw`import "\u002e\u002e/extension-host/host";`,
  'export const value = `${import("../../src/platform")}`;',
  'export const quote = /"/; import "../../src/platform";',
  'let value = 1; value++ / 2; import "../../src/platform";',
  'const value = { of: 2 }; export const n = value.of / 2; import "../../src/platform";',
  'const of = 2; export const n = of / 2; import "../../src/platform";',
])("rejects SDK private import syntax: %s", (source) => {
  expect(boundaryProblems("modules/sdk/example.ts", source)).toHaveLength(1);
});

it.each([
  ["extensions/examples/nested/example.tsx", "../../../src/platform"],
  ["extensions/examples/example.js", "../../modules/shell/runtime"],
  ["extensions/examples/example.js", "../../modules/extension-host/host"],
  ["extensions/examples/example.js", "/src/platform"],
  ["modules/sdk/nested/example.ts", "../../extension-host/host"],
])("normalizes private imports from %s", (file, target) => {
  expect(boundaryProblems(file, `import "${target}";`)).toHaveLength(1);
});

it.each([
  'export const view = <div></div>; import "../../src/platform";',
  'export const view = <div />; import "../../src/platform";',
  'export const view = <><span>{import("../../src/platform")}</span></>;',
  'export const identity = <T = unknown>(x: T) => x; import "../../src/platform";',
  String.raw`export const view = <div title="C:\">{import("../../src/platform")}</div>;`,
])("checks static imports around and inside JSX: %s", (source) => {
  expect(
    boundaryProblems("extensions/examples/probe.tsx", source),
  ).toHaveLength(1);
});

it("fails closed when TypeScript cannot parse TSX", () => {
  const problems = boundaryProblems(
    "extensions/examples/probe.tsx",
    'export const identity = <const T>(x: T) => x;\nimport "../../src/platform";\nexport const text = "</const>";',
  );
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.some((problem) => problem.includes("parse error"))).toBe(
    true,
  );
});

it("ignores JSX text and attributes while retaining expression imports", () => {
  expect(
    boundaryProblems(
      "extensions/examples/probe.tsx",
      'export const view = <div title=\'import "../../src/platform";\'>import "../../src/platform";</div>;',
    ),
  ).toEqual([]);
});

it("allows public SDK imports and ignores non-code references", () => {
  const source = [
    'import type { View } from "../../modules/sdk";',
    '// import "../../src/platform";',
    '/* export * from "../../modules/extension-host/host"; */',
    "const text = 'import \"../../src/platform\";';",
    String.raw`export const pattern = /import("..\/..\/src\/platform")/;`,
  ].join("\n");
  expect(boundaryProblems("extensions/examples/example.tsx", source)).toEqual(
    [],
  );
  expect(
    boundaryProblems("src/shell/runtime.ts", 'import "../../src/platform";'),
  ).toEqual([]);
});

it("reports the original line of a forbidden import", () => {
  expect(
    boundaryProblems(
      "modules/sdk/example.ts",
      '\n\nimport "../../src/platform";',
    )[0],
  ).toBe("modules/sdk/example.ts:3: forbidden import ../../src/platform");
});

it("enforces Hooks errors and dependency warnings on supported JavaScript input", async () => {
  const eslint = new ESLint();
  const [bad] = await eslint.lintText(
    'import { useState } from "react"; export function Example({ show }) { if (show) useState(0); return null; }',
    { filePath: "src/hardening-probe.jsx" },
  );
  expect(bad.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "react-hooks/rules-of-hooks",
        severity: 2,
      }),
    ]),
  );
  const [deps] = await eslint.lintText(
    'import { useEffect } from "react"; export function Example({ value }) { useEffect(() => console.log(value), []); return null; }',
    { filePath: "src/hardening-probe.jsx" },
  );
  expect(deps.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ruleId: "react-hooks/exhaustive-deps",
        severity: 1,
      }),
    ]),
  );
});
