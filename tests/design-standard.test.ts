import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  blackA,
  gray,
  grayA,
  grayDark,
  green,
  greenDark,
  orange,
  orangeDark,
  red,
  redDark,
  whiteA,
} from "@radix-ui/colors";
import { plumPalette, plumParts } from "../src/agents/plum";

/** docs/DESIGN.md, checked against the packaged interface's source. */

const styles = readFileSync("src/styles.css", "utf8");
const app = readFileSync("src/app.css", "utf8");

/** The custom properties a CSS block sets, by name. */
function block(selector: string) {
  const start = styles.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = styles.slice(start, styles.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [
      k,
      v.trim().toLowerCase(),
    ]),
  );
}
/** rgba(255, 255, 255, 0.3) → rgb(255 255 255 / 0.3), as styles.css writes it. */
const alpha = (rgba: string) =>
  rgba.replace(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/, "rgb($1 $2 $3 / $4)");
const white = "#ffffff";

test("built-in colours are Radix Gray and Orange steps used for their purpose", () => {
  const light = block(":root");
  const dark = block(':root[data-theme="dark"]');
  const expected = (
    g: typeof gray,
    o: typeof orange,
    r: typeof red,
    gr: typeof green,
    mode: "light" | "dark",
  ) => ({
    "--text": g.gray12,
    "--muted": g.gray11,
    "--background": g.gray1,
    "--surface": mode === "light" ? g.gray2 : g.gray3,
    "--card": mode === "light" ? g.gray1 : g.gray2,
    "--overlay": mode === "light" ? g.gray1 : g.gray2,
    "--subtle": mode === "light" ? g.gray3 : g.gray4,
    "--border": g.gray6,
    "--control-border": g.gray7,
    "--focus": o.orange8,
    "--accent": o.orange9,
    "--accent-hover": o.orange10,
    "--accent-ink": white,
    "--accent-soft": o.orange3,
    "--accent-text": o.orange11,
    "--error": r.red11,
    "--running": gr.green9,
    "--shadow": mode === "light" ? grayA.grayA4 : "#00000080",
    "--chrome": g.gray3,
    "--chat": mode === "light" ? g.gray1 : g.gray2,
    "--bubble": mode === "light" ? g.gray3 : g.gray4,
    "--row-pinned": g.gray4,
    "--selection": o.orange9,
    "--selection-text": white,
    "--rail-icon": g.gray11,
    "--rail-glass": alpha(mode === "light" ? whiteA.whiteA5 : whiteA.whiteA1),
    "--user": g.gray5,
    "--user-ink": g.gray9,
  });
  expect(light).toMatchObject(expected(gray, orange, red, green, "light"));
  expect(dark).toMatchObject(
    expected(grayDark, orangeDark, redDark, greenDark, "dark"),
  );
  // The dark shadow is Black A7.
  expect(alpha(blackA.blackA7)).toBe("rgb(0 0 0 / 0.5)");
});

test("the default avatars are drawn from Radix scales", () => {
  const steps = new Set(
    Object.values(
      import.meta.glob<Record<string, Record<string, string>>>(
        "/node_modules/@radix-ui/colors/index.mjs",
        { eager: true },
      ),
    ).flatMap((module) =>
      Object.values(module).flatMap((scale) =>
        Object.values(scale).map((value) => value.toLowerCase()),
      ),
    ),
  );
  for (const plum of plumPalette)
    for (const value of [plum.body, plum.light, plum.dark])
      expect(steps, value).toContain(value.toLowerCase());
  for (const value of Object.values(plumParts))
    expect(steps, value).toContain(value.toLowerCase());
});

/** Source files of the packaged interface: the shell and built-in extensions. */
function sources(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".generated.ts"))
      out.push(path);
  }
  return out;
}
const packaged = [
  ...sources("src"),
  ...sources("modules/agents"),
  ...sources("modules/models"),
  ...sources("modules/shell"),
];

test("text uses four sizes: 12, 14, 16 and 20px", () => {
  const offenders = packaged.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [
      ...text.matchAll(
        /\btext-(\[[\d.]+(px|rem)\]|lg|2xl|3xl|4xl)(?![\w-])|font-size:\s*(?!\s|(12|14|16|20)px|inherit)[^;]+/g,
      ),
    ].map((m) => `${path}: ${m[0]}`);
  });
  expect(offenders).toEqual([]);
});

test("lines are 0.5px, and only floating layers cast shadows", () => {
  expect(app).toMatch(/--default-border-width:\s*0\.5px/);
  const offenders = packaged.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [
      ...text.matchAll(
        /\b1px solid\b|\bshadow-(panel|raised|sm|md|lg)(?![\w-])|drop-shadow-\w+|backdrop-blur[\w\-[\]]*/g,
      ),
    ].map((m) => `${path}: ${m[0]}`);
  });
  expect(offenders).toEqual([]);
});

test("nothing animates in; no motion library", () => {
  const offenders = packaged.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [
      ...text.matchAll(/from "motion\/react"|\bzoom-(in|out)\b[\w\-[\].]*/g),
    ].map((m) => `${path}: ${m[0]}`);
  });
  expect(offenders).toEqual([]);
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  expect(manifest.dependencies.motion).toBeUndefined();
});

test("copy never uses a middle dot as a separator", () => {
  const offenders = packaged.flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("·") && !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map((line) => `${path}: ${line.trim()}`),
  );
  expect(offenders).toEqual([]);
});
