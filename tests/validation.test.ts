import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ContractError } from "../modules/sdk/errors";
import { identifier, sameOrigin } from "../modules/sdk/validation";
import { projectFiles } from "../scripts/project-files.mjs";

it.each(["a", "ui.default", "agents.local", "x-1.y", "a".repeat(64)])(
  "accepts id %s",
  (id) => {
    expect(identifier(id, "extension.invalid")).toBe(id);
  },
);

it.each(["", "A", "1a", "a..b", "a_b", "a".repeat(65), 7, null])(
  "rejects id %s with the caller's code and path",
  (id) => {
    expect(() =>
      identifier(id, "state.composition", { path: "enabled.0.id" }),
    ).toThrow(
      expect.objectContaining({
        code: "state.composition",
        detail: "enabled.0.id",
      }) as ContractError,
    );
  },
);

it("keeps only same-origin targets", () => {
  const base = "https://app.test/index.html";
  expect(sameOrigin("/ext/a.js?v=1", base)?.href).toBe(
    "https://app.test/ext/a.js?v=1",
  );
  expect(sameOrigin("https://evil.test/a.js", base)).toBeUndefined();
  expect(sameOrigin("//evil.test/a.js", base)).toBeUndefined();
  expect(sameOrigin("http://[bad", base)).toBeUndefined();
});

it("defines the id and origin rules in one place", () => {
  const offenders = projectFiles(".")
    .filter((file: string) => /^(src|modules)\/.*\.tsx?$/.test(file))
    .filter((file: string) => file !== "modules/sdk/validation.ts")
    .filter((file: string) => {
      const text = readFileSync(file, "utf8");
      return (
        text.includes("[a-z][a-z0-9.-]{0,63}") || /\.origin\s*!==/.test(text)
      );
    });
  expect(offenders).toEqual([]);
});
