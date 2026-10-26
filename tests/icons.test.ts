import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildDarkIcon } from "../scripts/icons.mjs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url));

it("still derives the committed dark brand mark from the light one", () => {
  expect(
    buildDarkIcon(read("../public/brand/plums.png")).equals(
      read("../public/brand/plums-dark.png"),
    ),
  ).toBe(true);
});
