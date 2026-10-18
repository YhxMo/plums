import { expect, it, vi } from "vitest";
import { checkIpcImports } from "../scripts/check-ipc-imports.mjs";
const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => bridge);
import { invokeNative } from "../src/native/invoke";

it.each([
  'import { invoke } from "@tauri-apps/api/core";',
  'import { invoke as call } from "@tauri-apps/api/core";',
  'import * as core from "@tauri-apps/api/core";',
  'const core = import("@tauri-apps/api/core");',
  'export { invoke } from "@tauri-apps/api/core";',
])("refuses an untyped production native bridge: %s", (source) => {
  expect(checkIpcImports([["src/escaped.ts", source]])).toHaveLength(1);
});
it.each([
  'import { core } from "@tauri-apps/api"; core.invoke("missing_command", {});',
  'import { core as native } from "@tauri-apps/api";',
  'import * as tauri from "@tauri-apps/api";',
  'const tauri = import("@tauri-apps/api");',
  'export { core as native } from "@tauri-apps/api";',
  'export * from "@tauri-apps/api";',
  'export * as tauri from "@tauri-apps/api";',
])("refuses the package-root core bridge: %s", (source) => {
  expect(checkIpcImports([["src/escaped.ts", source]])).toHaveLength(1);
});
it.each([
  "src/shell/example.tsx",
  "modules/shell/example.ts",
  "modules/example/entry.js",
  "extensions/example/main.mjs",
])("checks the production source %s", (file) => {
  expect(
    checkIpcImports([
      ["src/safe.ts", "export {};"],
      [file, 'import { invoke } from "@tauri-apps/api/core";'],
    ]),
  ).toHaveLength(1);
  expect(
    checkIpcImports([
      ["src/safe.ts", "export {};"],
      [file, 'import { core } from "@tauri-apps/api";'],
    ]),
  ).toHaveLength(1);
});
it("allows non-core package exports and excludes deliberate test bridges", () => {
  expect(
    checkIpcImports([
      ["src/events.ts", 'import { event as events } from "@tauri-apps/api";'],
      [
        "modules/example/exports.ts",
        'export { event } from "@tauri-apps/api";',
      ],
      ["tests/example.ts", 'import { core } from "@tauri-apps/api";'],
    ]),
  ).toEqual([]);
});
it.each([
  'import { core } from "@tauri-apps/api/index"; core.invoke("missing", {});',
  'import * as tauri from "@tauri-apps/api/index";',
  'export { core } from "@tauri-apps/api/index";',
])("rejects the exported index alias: %s", (source) => {
  expect(checkIpcImports([["src/escaped.ts", source]])).toHaveLength(1);
});
it("allows non-core named imports from the exported index alias", () => {
  expect(
    checkIpcImports([
      ["src/events.ts", 'import { event } from "@tauri-apps/api/index";'],
    ]),
  ).toEqual([]);
});
it("allows only the bridge and native environment detection", () => {
  expect(
    checkIpcImports([
      [
        "src/platform.ts",
        'import { isTauri as native } from "@tauri-apps/api/core";',
      ],
      [
        "src/native/invoke.ts",
        'import { invoke } from "@tauri-apps/api/core";',
      ],
    ]),
  ).toEqual([]);
  expect(checkIpcImports([])).toHaveLength(1);
});
it("preserves arguments and explicit rejection objects without retries", async () => {
  const args = {
    owner: "sample",
    operationId: "one",
    handle: "h",
    maxBytes: 10,
  };
  const failure = { code: "state-corrupt", outcome: "not-committed" };
  bridge.invoke.mockRejectedValueOnce(failure);
  await expect(invokeNative("document_read", args)).rejects.toBe(failure);
  expect(bridge.invoke).toHaveBeenLastCalledWith("document_read", args);
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
});
