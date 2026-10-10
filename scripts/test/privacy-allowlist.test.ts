import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { scanTrackedPrivacy } from "../check-public-ready.mjs";

type Exception = {
  file: string;
  sha256: string;
  spans: [number, number][];
  reason: string;
};
const exceptions: Exception[] = JSON.parse(
  readFileSync(new URL("../privacy-allowlist.json", import.meta.url), "utf8"),
);
const digest = (line: string) =>
  createHash("sha256").update(line).digest("hex");
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cases = exceptions.map((entry) => {
  const source = readFileSync(
    new URL(`../../${entry.file}`, import.meta.url),
    "utf8",
  );
  const line = source.split("\n").find((line) => digest(line) === entry.sha256);
  return { ...entry, line };
});

it("keeps every reviewed exception present and unique", () => {
  expect(exceptions).toHaveLength(27);
  expect(
    new Set(exceptions.map((entry) => `${entry.file}:${entry.sha256}`)).size,
  ).toBe(exceptions.length);
  for (const entry of cases) {
    expect(entry.line).toBeDefined();
    expect(entry.reason.length).toBeGreaterThan(0);
    expect(entry.spans.length).toBeGreaterThan(0);
    for (const [start, end] of entry.spans) {
      expect(Number.isInteger(start)).toBe(true);
      expect(Number.isInteger(end)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(entry.line!.length);
    }
  }
});

it.each(cases)("allows only the reviewed spans in $file ($sha256)", (entry) => {
  const line = entry.line!;
  const expressions = entry.spans.map(([start, end]) =>
    literal(line.slice(start, end)),
  );
  expect(
    scanTrackedPrivacy(new Map([[entry.file, `header\n${line}`]]), expressions),
  ).toEqual([]);
  const [start, end] = entry.spans[0];
  expect(
    scanTrackedPrivacy(new Map([[entry.file, line]]), [
      literal(line.slice(start + 1, end)),
    ]),
  ).toEqual([]);
});

it.each(cases)("rejects reuse in another file for $file ($sha256)", (entry) => {
  const line = entry.line!;
  const [start, end] = entry.spans[0];
  const file = "docs/synthetic.md";
  expect(
    scanTrackedPrivacy(new Map([[file, line]]), [
      literal(line.slice(start, end)),
    ]),
  ).toEqual([{ file, line: 1 }]);
});

it.each(cases)(
  "rejects changed lines and new hits in $file ($sha256)",
  (entry) => {
    const line = entry.line!;
    const [start, end] = entry.spans[0];
    const token = line.slice(start, end);
    const marker = "SYNTHETIC_PRIVATE_MARKER";
    for (const changed of [`${line} ${token}`, `${line} ${marker}`, ` ${line}`])
      expect(
        scanTrackedPrivacy(new Map([[entry.file, changed]]), [
          literal(token),
          marker,
        ]),
      ).toEqual([{ file: entry.file, line: 1 }]);
    expect(
      scanTrackedPrivacy(new Map([[entry.file, `${line}\n${marker}`]]), [
        literal(token),
        marker,
      ]),
    ).toEqual([{ file: entry.file, line: 2 }]);
  },
);

it.each(cases)(
  "rejects matches beyond a reviewed span in $file ($sha256)",
  (entry) => {
    const line = entry.line!;
    const [start, end] = entry.spans[0];
    const outside =
      start > 0 ? line.slice(start - 1, end) : line.slice(start, end + 1);
    expect(
      scanTrackedPrivacy(new Map([[entry.file, line]]), [literal(outside)]),
    ).toEqual([{ file: entry.file, line: 1 }]);
    expect(scanTrackedPrivacy(new Map([[entry.file, line]]), ["^"])).toEqual([
      { file: entry.file, line: 1 },
    ]);
  },
);
