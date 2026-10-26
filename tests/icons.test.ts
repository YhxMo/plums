import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildDarkIcon, decodePng } from "../scripts/icons.mjs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url));

// Compares pixels, not bytes: the deflate output differs between the
// zlib builds of supported Node versions.
it("still derives the committed dark brand mark from the light one", () => {
  const built = decodePng(buildDarkIcon(read("../public/brand/plums.png")));
  const committed = decodePng(read("../public/brand/plums-dark.png"));
  expect([built.width, built.height]).toEqual([
    committed.width,
    committed.height,
  ]);
  expect(built.pixels.equals(committed.pixels)).toBe(true);
});
