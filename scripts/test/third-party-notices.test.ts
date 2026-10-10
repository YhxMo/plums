import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  collectProductionPackages,
  formatProductionNotices,
} from "../generate-third-party-notices.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-notices-"));
  roots.push(root);
  await mkdir(path.join(root, "packages"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: { zeta: "1.0.0" },
      devDependencies: { dev: "1.0.0" },
    }),
  );
  await writeFile(
    path.join(root, "pnpm-lock.yaml"),
    "packages:\n  zeta@1.0.0:\n  alpha@2.0.0:\n  dev@1.0.0:\n",
  );
  for (const [name, version, license, dependencies] of [
    ["zeta", "1.0.0", "MIT", { alpha: "2.0.0" }],
    ["alpha", "2.0.0", "ISC", {}],
    ["dev", "1.0.0", "GPL-3.0", {}],
  ] as const) {
    const dir = path.join(root, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version, license, dependencies }),
    );
    await writeFile(
      path.join(dir, "LICENSE"),
      `Copyright synthetic ${name}\nSynthetic ${license} license\n`,
    );
  }
  return root;
}
it("sorts the complete production closure deterministically and excludes development tools", async () => {
  const packages = await collectProductionPackages(await fixture());
  expect(packages.map((pkg) => pkg.id)).toEqual(["alpha@2.0.0", "zeta@1.0.0"]);
  const text = formatProductionNotices(packages);
  expect(text).toContain("Copyright synthetic alpha");
  expect(text).toContain("License: MIT");
  expect(text).not.toContain("dev@1.0.0");
  expect(text).toBe(formatProductionNotices(packages));
});
it.each(["GPL-3.0", "AGPL-3.0", "LGPL-2.1", "MPL-2.0", "UNKNOWN", undefined])(
  "fails closed on production license %s",
  async (license) => {
    const root = await fixture();
    await writeFile(
      path.join(root, "node_modules/alpha/package.json"),
      JSON.stringify({ name: "alpha", version: "2.0.0", license }),
    );
    await expect(collectProductionPackages(root)).rejects.toThrow(
      "License outside allowlist: alpha@2.0.0",
    );
  },
);
it("rejects missing license files and a dependency version absent from the lock", async () => {
  const root = await fixture();
  await rm(path.join(root, "node_modules/alpha/LICENSE"));
  await expect(collectProductionPackages(root)).rejects.toThrow(
    "Missing LICENSE file: alpha@2.0.0",
  );
  await writeFile(
    path.join(root, "node_modules/alpha/package.json"),
    JSON.stringify({ name: "alpha", version: "3.0.0", license: "ISC" }),
  );
  await expect(collectProductionPackages(root)).rejects.toThrow(
    "differs from lockfile: alpha@3.0.0",
  );
});
