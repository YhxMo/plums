import { expect, it } from "vitest";
import {
  checkDocLinks,
  markdownAnchors,
} from "../../../scripts/check-doc-links.mjs";

const documents = (link: string) =>
  new Map([
    ["README.md", `# Intro\n\n[guide](${link})\n`],
    [
      "docs/guide.md",
      '# Guide\n\n## 中文标题\n\n## Duplicate\n## Duplicate\n<a id="explicit"></a>\n',
    ],
  ]);
const tracked = new Set(["README.md", "docs/guide.md"]);
it("accepts tracked relative links, Chinese/duplicate/explicit anchors and collects external URLs", () => {
  for (const link of [
    "docs/guide.md",
    "docs/guide.md#中文标题",
    "docs/guide.md#duplicate-1",
    "docs/guide.md#explicit",
    "#intro",
  ])
    expect(checkDocLinks(documents(link), tracked).ok).toBe(true);
  expect(
    checkDocLinks(documents("https://example.com/guide"), tracked).external,
  ).toEqual(["https://example.com/guide"]);
});
it.each(["docs/missing.md", "docs/guide.md#missing", "../outside.md"])(
  "rejects broken link %s",
  (link) => {
    expect(checkDocLinks(documents(link), tracked).ok).toBe(false);
  },
);
it("rejects an ignored target even when its contents exist on disk", () => {
  expect(
    checkDocLinks(documents("docs/guide.md"), new Set(["README.md"]))
      .failures[0]?.reason,
  ).toContain("not a tracked");
});
it("reads reference links and HTML links while ignoring fenced/inline code", () => {
  const input = documents("docs/guide.md");
  input.set(
    "README.md",
    '[guide][g]\n\n[g]: docs/guide.md#duplicate\n<a href="docs/guide.md#中文标题">guide</a>\n`[bad](missing.md)`\n```md\n[bad](missing.md)\n```\n',
  );
  expect(checkDocLinks(input, tracked).ok).toBe(true);
  input.set("README.md", "[bad][g]\n[g]: missing.md\n");
  expect(checkDocLinks(input, tracked).ok).toBe(false);
});
it("extracts headings in source order and ignores code headings", () => {
  expect([
    ...markdownAnchors(
      '<h1 align="center">Plums</h1>\n## **API** & details\n```md\n## Not a heading\n```\n',
    ),
  ]).toEqual(["plums", "api--details"]);
});
