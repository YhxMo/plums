import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifests = [
  "package.json",
  ...readdirSync(path.join(root, "packages")).map(
    (name) => `packages/${name}/package.json`,
  ),
];
it.each(manifests)(
  "%s declares Apache-2.0 and only the confirmed public identity",
  (file) => {
    const manifest = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    expect(manifest.license).toBe("Apache-2.0");
    if (manifest.author !== undefined) expect(manifest.author).toBe("YhxMo");
  },
);
it("preserves the byte-exact upstream Apache license and the approved NOTICE holder", () => {
  const license = readFileSync(path.join(root, "LICENSE"));
  expect(createHash("sha256").update(license).digest("hex")).toBe(
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  );
  const notice = readFileSync(path.join(root, "NOTICE"), "utf8");
  expect(notice).toContain("Copyright 2026 Plums");
  expect(notice).toContain("Licensed under the Apache License, Version 2.0.");
});
