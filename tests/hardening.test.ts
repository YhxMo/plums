import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ESLint } from "eslint";
import {
  boundaryProblems,
  checkBoundaries,
} from "../scripts/check-boundaries.mjs";
import { checkSize, sizeLimits } from "../scripts/check-size.mjs";

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
  const file = "src-tauri/src/documents.rs";
  const limit = sizeLimits[file];
  expect(checkSize(fixture(file, limit + 1)).failures).toBe(1);
  expect(checkSize(fixture(file, limit - 1)).rows).toEqual([
    `${file} | ${limit - 1} | ${limit} | 1`,
  ]);
});

it("fails closed when no eligible boundary source is present", () => {
  expect(checkBoundaries([["tests/hardening.test.ts", "export {};"]])).toEqual([
    "no eligible SDK/kernel/extension source files for import boundary check",
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
  ["modules/sdk/example.ts", "../agents/store"],
  ["modules/sdk/example.ts", "../../extensions/contracts"],
  ["extensions/examples/example.js", "../../modules/agents/store"],
  ["extensions/examples/example.js", "../../modules/text-workbench/store"],
  ["modules/extension-host/example.ts", "../shell/composition"],
  ["modules/extension-host/example.ts", "../agents/provider"],
  ["modules/extension-host/example.ts", "../../src/platform"],
  ["modules/shell/example.ts", "../agents/store"],
  ["modules/shell/example.ts", "../text-workbench/extension"],
  ["modules/shell/example.ts", "../../extensions/ui/default"],
  ["modules/shell/example.ts", "../../src/shell/runtime"],
])("keeps kernel layers off business and app code: %s -> %s", (file, target) =>
  expect(boundaryProblems(file, `import "${target}";`)).toHaveLength(1),
);

it.each([
  ["modules/sdk/example.ts", "./errors"],
  ["modules/sdk/nested/example.ts", "../index"],
  ["modules/extension-host/example.ts", "../sdk"],
  ["modules/shell/example.ts", "../extension-host/host"],
  ["modules/shell/example.ts", "../sdk/pages"],
  ["extensions/examples/example.js", "../../modules/sdk"],
  ["extensions/examples/example.js", "../contracts"],
])("allows downward imports: %s -> %s", (file, target) =>
  expect(boundaryProblems(file, `import "${target}";`)).toEqual([]),
);

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

it.each(["src/hardening-probe.jsx", "src/hardening-probe.tsx"])(
  "rejects Hooks violations in %s",
  async (filePath) => {
    const eslint = new ESLint();
    const [bad] = await eslint.lintText(
      'import { useState } from "react"; export function Example({ show }: { show: boolean }) { if (show) useState(0); return null; }'.replace(
        filePath.endsWith(".jsx") ? ": { show: boolean }" : "\0",
        "",
      ),
      { filePath },
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
      'import { useEffect } from "react"; export function Example({ value }: { value: string }) { useEffect(() => console.log(value), []); return null; }'.replace(
        filePath.endsWith(".jsx") ? ": { value: string }" : "\0",
        "",
      ),
      { filePath },
    );
    expect(deps.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "react-hooks/exhaustive-deps",
          severity: 2,
        }),
      ]),
    );
  },
);

it.each([
  ["modules/sdk/probe.ts", "../unknown-business/store"],
  ["modules/extension-host/probe.ts", "../unknown-business/store"],
  ["modules/shell/probe.ts", "../unknown-business/store"],
  ["extensions/examples/probe.ts", "../../modules/unknown-business/store"],
  ["modules/sdk/probe.ts", "../"],
  ["modules/extension-host/probe.ts", "../"],
  ["modules/shell/probe.ts", "../"],
  ["extensions/probe.ts", "../"],
  ["modules/shell/probe.ts", "../../outside"],
  ["modules/shell/probe.ts", "../../../outside"],
])(
  "rejects unknown layers and directory-only escapes: %s -> %s",
  (file, target) => {
    expect(boundaryProblems(file, `import "${target}";`)).toHaveLength(1);
  },
);

it.each([
  ["src/shell/probe.ts", "../../modules/sdk/agents"],
  ["modules/shell/probe.ts", "../sdk/agents"],
  ["modules/extension-host/probe.ts", "../sdk/agents"],
  ["src/shell/probe.ts", "../../modules/agents/store"],
])(
  "keeps generic shells and host away from Agent contracts: %s",
  (file, target) => {
    expect(
      boundaryProblems(file, `import type { Agent } from "${target}";`),
    ).toHaveLength(1);
  },
);
it.each([
  "agents",
  "default",
  "board",
  "text-workbench",
  "broken",
  "role-settings",
])("rejects business view ID %s in generic shell", (id) => {
  expect(
    boundaryProblems("src/shell/probe.ts", `const selected = "${id}";`),
  ).toHaveLength(1);
  expect(
    boundaryProblems("modules/shell/probe.ts", `const selected = "${id}";`),
  ).toHaveLength(1);
});
it("rejects Agent contracts re-exported through SDK barrels", () => {
  expect(
    checkBoundaries([
      ["modules/sdk/bridge.ts", 'export type { Agent } from "./agents";'],
      ["modules/sdk/index.ts", 'export * from "./bridge";'],
      ["src/shell/probe.ts", 'import type { Agent } from "../../modules/sdk";'],
    ]),
  ).toEqual([
    "src/shell/probe.ts:1: forbidden import ../../modules/sdk (Agent contract via SDK)",
  ]);
});

it.each([
  ["modules/sdk/probe.ts", ".."],
  ["modules/extension-host/probe.ts", ".."],
  ["modules/shell/probe.ts", ".."],
  ["src/shell/probe.ts", ".."],
  ["extensions/probe.ts", ".."],
])("rejects bare parent-directory escape: %s -> %s", (file, target) => {
  expect(boundaryProblems(file, `import "${target}";`)).toHaveLength(1);
});
it.each([
  ["modules/sdk/probe.ts", "."],
  ["modules/shell/probe.ts", "."],
  ["modules/sdk/nested/probe.ts", ".."],
  ["extensions/examples/probe.ts", ".."],
])(
  "allows bare directories inside an approved layer: %s -> %s",
  (file, target) => {
    expect(boundaryProblems(file, `import "${target}";`)).toEqual([]);
  },
);
