import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { atLeast, below, breakpoints } from "../src/components/breakpoints";

const css = readFileSync("src/app.css", "utf8");
const theme = Object.fromEntries(
  [...css.matchAll(/--breakpoint-([a-z]+):\s*([^;]+);/g)].map((m) => [
    m[1],
    m[2].trim(),
  ]),
);
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return path === join("src", "components", "ui") ? [] : sources(path);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

it("names every layout width once, in the theme and in TypeScript", () => {
  expect(theme).toEqual(breakpoints);
  expect(below("md")).toBe("(width < 40.5rem)");
  expect(atLeast("wide")).toBe("(width >= 68.75rem)");
});

it("leaves no layout width as a literal in components or styles", () => {
  const literal =
    /max-\[\d|min-\[\d|useMediaQuery\(\s*["'`]\((?:min-|max-)?width|@media \(width [<>]=? \d/;
  const offenders = sources("src").filter(
    (path) =>
      !path.endsWith("breakpoints.ts") &&
      literal.test(readFileSync(path, "utf8")),
  );
  expect(offenders).toEqual([]);
});
