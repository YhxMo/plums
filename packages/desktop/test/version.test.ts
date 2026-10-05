import { expect, it } from "vitest";
import { newerVersion, latestUpdate } from "../src/shared/version.js";
import type { CatalogItem } from "../src/shared/types.js";

it("orders imported releases and complete prerelease identifiers without treating build metadata as an update", () => {
  const releases = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 1; i < releases.length; i++) {
    expect(newerVersion(releases[i]!, releases[i - 1]!)).toBe(true);
    expect(newerVersion(releases[i - 1]!, releases[i]!)).toBe(false);
  }
  expect(newerVersion("1.0.0-alpha-test.2", "1.0.0-alpha-test.1")).toBe(true);
  expect(
    newerVersion(
      "1.0.0-alpha.9007199254740993",
      "1.0.0-alpha.9007199254740992",
    ),
  ).toBe(true);
  expect(newerVersion("1.0.0+new", "1.0.0+old")).toBe(false);
});

it("offers the highest imported version for the same component and offers no downgrade", () => {
  const item = (id: string, version: string) =>
    ({ digest: `${id}:${version}`, manifest: { id, version } }) as CatalogItem;
  const items = [
    item("other", "9.0.0"),
    item("tool", "1.0.0"),
    item("tool", "2.0.0-beta.1"),
    item("tool", "2.0.0"),
    item("tool", "1.2.0"),
  ];
  expect(latestUpdate(items, "tool", "1.0.0")?.manifest.version).toBe("2.0.0");
  expect(latestUpdate(items, "tool", "2.0.0")).toBeUndefined();
});
