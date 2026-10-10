import { afterEach, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { desktopContribution } from "@plumsjs/sdk";
import type { Core, EnginePermission, ManifestV2 } from "../src/index.js";
import { validateEnginePermission } from "../src/index.js";
import { makeCore, manifestZip } from "./package-helpers.js";
const worlds: { core: Core; dataDir: string }[] = [];
afterEach(() =>
  worlds.splice(0).forEach((w) => {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }),
);
const machine: EnginePermission = {
  id: "local",
  kind: "engine",
  target: "local",
  reason: "Synthetic execution",
};
const project: EnginePermission = {
  ...machine,
  tier: "project",
  network: { hosts: ["pkg.fixture.test", "*.fixture.test"], future: true },
  toolchains: ["node", "git"],
  credentials: [
    {
      id: "npm",
      kind: "npm-token",
      host: "pkg.fixture.test",
      reason: "Synthetic package install",
    },
  ],
  future: { keep: true },
};
const manifest: ManifestV2 = {
  formatVersion: "2.0",
  kind: "extension",
  id: "fixture",
  name: "Fixture",
  version: "1.0.0",
  description: "",
  dependencies: [],
  permissions: [machine],
  payload: {
    plumsDesktop: {
      sdkVersion: "2",
      engines: [
        {
          id: "local",
          title: "Fixture",
          entry: "engine/main.mjs",
          runtime: "node",
          platforms: ["darwin-arm64"],
          protocol: "jsonrpc-jsonl-v1",
        },
      ],
    },
  },
};
function world() {
  const w = makeCore();
  worlds.push(w);
  return w.core;
}
it("returns the public manifest error for non-object declarations without an invalid root pointer", () => {
  for (const value of [null, undefined, [], "project", 0]) {
    expect(() => validateEnginePermission(value)).toThrowError(
      expect.objectContaining({ code: "MANIFEST_INVALID", path: undefined }),
    );
  }
});
it("round-trips machine omission and project declarations without materializing a tier or changing unknown fields", async () => {
  const core = world();
  for (const permission of [
    machine,
    { ...machine, tier: "machine" as const },
    project,
  ]) {
    const m = { ...manifest, permissions: [permission] };
    const contents = await core.validatePackage(
      await core.exportPackage({
        manifest: m,
        files: { "engine/main.mjs": Buffer.from("process.exit(0)") },
      }),
    );
    expect(contents.manifest).toEqual(m);
    expect(
      desktopContribution(contents.manifest, contents.files)?.engines?.[0]?.id,
    ).toBe("local");
  }
});
it.each([
  [{ tier: "sandbox" }, "/tier"],
  [{ tier: "invalid" }, "/tier"],
  [{ network: { hosts: ["pkg.fixture.test"] } }, "/network"],
  [{ tier: "machine", network: { hosts: [] } }, "/network"],
  [{ toolchains: ["node"] }, "/toolchains"],
  [{ credentials: [] }, "/credentials"],
  [{ tier: "project", network: {} }, "/network/hosts"],
  [{ tier: "project", network: { hosts: ["localhost"] } }, "/network/hosts/0"],
  [{ tier: "project", network: { hosts: ["127.0.0.1"] } }, "/network/hosts/0"],
  [
    { tier: "project", network: { hosts: ["https://pkg.fixture.test"] } },
    "/network/hosts/0",
  ],
  [{ tier: "project", network: { hosts: ["*.com"] } }, "/network/hosts/0"],
  [
    { tier: "project", network: { hosts: ["pkg.fixture.test:8443"] } },
    "/network/hosts/0",
  ],
  [
    {
      tier: "project",
      network: { hosts: ["PKG.fixture.test", "pkg.fixture.test"] },
    },
    "/network/hosts/1",
  ],
  [{ tier: "project", toolchains: ["arbitrary"] }, "/toolchains/0"],
  [
    {
      tier: "project",
      credentials: [
        { id: "npm", kind: "npm-token", host: "not-declared.test" },
      ],
    },
    "/credentials/0/host",
  ],
  [
    {
      ...project,
      credentials: [{ id: "npm", kind: "unknown", host: "pkg.fixture.test" }],
    },
    "/credentials/0/kind",
  ],
  [
    {
      ...project,
      credentials: [project.credentials![0], project.credentials![0]],
    },
    "/credentials/1/id",
  ],
] as const)(
  "rejects invalid local declarations at the public pointer (%j)",
  async (extra, pointer) => {
    const m = {
      ...manifest,
      permissions: [{ ...machine, ...extra }],
    } as ManifestV2;
    await expect(
      world().validatePackage(await manifestZip(m)),
    ).rejects.toMatchObject({
      code: "MANIFEST_INVALID",
      path: "/permissions/0" + pointer,
    });
    expect(() => desktopContribution(m)).toThrowError(
      expect.objectContaining({ code: "IMPORT_INVALID" }),
    );
  },
);
it.each([
  {
    ...project,
    tier: "machine" as const,
    network: undefined,
    toolchains: undefined,
    credentials: undefined,
  },
  { ...project, network: { hosts: ["new.fixture.test"] }, credentials: [] },
  { ...project, toolchains: ["python" as const] },
  { ...project, credentials: [] },
  { ...project, future: { keep: false } },
])(
  "requires reconsent for every full engine declaration change (%j)",
  async (next) => {
    const core = world();
    await core.importPackage(
      await manifestZip({ ...manifest, permissions: [project] }),
    );
    await core.grantConsent("fixture");
    const bytes = await manifestZip({
      ...manifest,
      version: "1.1.0",
      permissions: [next],
    });
    await expect(core.updatePackage(bytes)).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
      path: "/permissions/0",
      details: { reason: "ENGINE_PERMISSION_CHANGED" },
    });
    expect((await core.getPackage("fixture")).installed.version).toBe("1.0.0");
    await core.updatePackage(bytes, { consent: true });
    expect((await core.getConsent("fixture"))?.permissions).toEqual(
      JSON.parse(JSON.stringify([next])),
    );
  },
);
