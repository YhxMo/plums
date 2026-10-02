import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * F: regression for the committed plums launcher (#20).
 * 基线不同、故意自包含、故意绕过 API。
 * Copies the launcher into a temp tree with no dist. Does not build that tree.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(here, "../package.json");
const launcherPath = path.join(here, "../bin/plums.js");

describe("F: plums launcher without dist (#20)", () => {
  it("F: a copied launcher exits 1 and tells you to run pnpm build when dist is missing", () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { bin: { plums: string }; files: string[] };
    expect(pkg.bin.plums).toBe("./bin/plums.js");
    expect(pkg.files).toContain("bin");

    const source = readFileSync(launcherPath, "utf8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(launcherPath).mode & 0o111).not.toBe(0);
    }

    const root = mkdtempSync(path.join(tmpdir(), "plums-reg-bin-"));
    const copied = path.join(root, "bin", "plums.js");
    mkdirSync(path.dirname(copied), { recursive: true });
    copyFileSync(launcherPath, copied);
    copyFileSync(packageJsonPath, path.join(root, "package.json"));

    const missing = spawnSync(process.execPath, [copied, "--version"], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("pnpm build");
  });
});
