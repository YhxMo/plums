import { expect, test } from "vitest";
import { plumFor, plumPalette } from "../src/agents/plum";

const hex = /^#[0-9a-f]{6}$/i;

test("the default avatar palette has at least five plums, each with a light and a dark tile", () => {
  expect(plumPalette.length).toBeGreaterThanOrEqual(5);
  for (const plum of plumPalette) {
    expect(plum.body).toMatch(hex);
    expect(plum.light).toMatch(hex);
    expect(plum.dark).toMatch(hex);
    expect(plum.light).not.toBe(plum.dark);
  }
  expect(new Set(plumPalette.map((plum) => plum.body)).size).toBe(
    plumPalette.length,
  );
});

test("a name always gets the same plum, and names spread over the palette", () => {
  expect(plumFor("编程助手")).toBe(plumFor("编程助手"));
  // Surrounding spaces are not part of the name.
  expect(plumFor("  编程助手 ")).toBe(plumFor("编程助手"));
  const names = ["编程助手", "写作搭子", "英语老师", "旅行规划", "健身教练"];
  const seen = new Set(
    [...names, ...names.map((name) => `${name}2`)].map((name) => plumFor(name)),
  );
  expect(seen.size).toBeGreaterThanOrEqual(3);
  for (const plum of seen) expect(plumPalette).toContain(plum);
});
