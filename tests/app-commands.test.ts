import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { appCommandKeys, commandOf } from "../src/shell/app-commands";

const key = (init: Partial<KeyboardEvent>) =>
  ({
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  }) as KeyboardEvent;

it("keeps the browser preview's keys in step with the native menu", () => {
  const menu = readFileSync("src-tauri/src/menu.rs", "utf8");
  const native = Object.fromEntries(
    [...menu.matchAll(/\("(\w+)",\s*"[^"]+",\s*"CmdOrCtrl\+(.)"\)/g)].map(
      (match) => [match[1], match[2].toLowerCase()],
    ),
  );
  expect(native).toEqual(appCommandKeys);
});
it.each([
  [",", "settings"],
  ["n", "new"],
  ["F", "find"],
] as const)("maps ⌘%s on a Mac to %s", (k, command) => {
  expect(commandOf(key({ key: k, metaKey: true }), true)).toBe(command);
});
it("maps Ctrl on other keyboards", () => {
  expect(commandOf(key({ key: "n", ctrlKey: true }), false)).toBe("new");
  expect(commandOf(key({ key: "n", metaKey: true }), false)).toBeUndefined();
});
it.each([
  key({ key: "n" }),
  key({ key: "n", metaKey: true, shiftKey: true }),
  key({ key: "n", metaKey: true, altKey: true }),
  key({ key: "n", metaKey: true, ctrlKey: true }),
  key({ key: "x", metaKey: true }),
])("leaves other key presses alone: %j", (event) => {
  expect(commandOf(event, true)).toBeUndefined();
});
