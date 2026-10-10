import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { assertNodeArchive } from "../../../scripts/prepare-test-runtime.mjs";
import { assertElectronReady } from "../../../scripts/prepare-electron.mjs";
const bytes = Buffer.from("synthetic runtime archive"),
  sha256 = createHash("sha256").update(bytes).digest("hex");
const pin = { archive: "synthetic.tar.gz", sha256 };
it("requires the Node archive to match both the repository pin and the official manifest", () => {
  expect(assertNodeArchive(bytes, `${sha256}  synthetic.tar.gz\n`, pin)).toBe(
    sha256,
  );
  expect(() =>
    assertNodeArchive(
      Buffer.from("tampered"),
      `${sha256}  synthetic.tar.gz\n`,
      pin,
    ),
  ).toThrow("checksum mismatch");
  expect(() =>
    assertNodeArchive(bytes, `${"0".repeat(64)}  synthetic.tar.gz\n`, pin),
  ).toThrow("checksum mismatch");
  expect(() =>
    assertNodeArchive(bytes, `${sha256}  synthetic.tar.gz\n`, {
      ...pin,
      sha256: "0".repeat(64),
    }),
  ).toThrow("checksum mismatch");
});
it("fails Electron readiness before its index.js fallback can download anything", async () => {
  await expect(
    assertElectronReady({ directory: "/synthetic/nonexistent-electron" }),
  ).rejects.toThrow("run node scripts/prepare-electron.mjs before the tests");
});
