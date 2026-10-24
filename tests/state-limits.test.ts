import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { isRecordName, STATE_LIMITS } from "../modules/sdk";

// The native store and the SDK state the same limits in two languages.
const rust = readFileSync("src-tauri/src/storage.rs", "utf8");
const constant = (name: string) => {
  const match = rust.match(
    new RegExp(`const ${name}: usize = (\\d+)(?: << (\\d+))?;`),
  );
  if (!match) throw new Error(`${name} not found in storage.rs`);
  return Number(match[1]) * 2 ** Number(match[2] ?? 0);
};

it("matches the native store's limits", () => {
  expect({
    document: constant("MAX_DOCUMENT"),
    record: constant("MAX_RECORD"),
    batchOperations: constant("MAX_BATCH_OPERATIONS"),
    batchBytes: constant("MAX_BATCH_BYTES"),
    pageBytes: constant("MAX_PAGE_BYTES"),
  }).toEqual(STATE_LIMITS);
});

it("names records by the native store's rule", () => {
  const records = readFileSync("src-tauri/src/storage_records.rs", "utf8");
  // Length 1–128, an ASCII letter or digit first, then also : . _ -
  expect(records).toContain("(1..=128).contains(&name.len())");
  expect(records).toContain(
    "name.starts_with(|c: char| c.is_ascii_alphanumeric())",
  );
  expect(records).toContain("matches!(c, b':' | b'.' | b'_' | b'-')");
  for (const name of ["a", "session:9f-1", "A.b_c", "x".repeat(128)])
    expect(isRecordName(name)).toBe(true);
  for (const name of ["", "-a", ":a", "a b", "会话", "x".repeat(129), 1])
    expect(isRecordName(name)).toBe(false);
});
