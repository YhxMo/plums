import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  type Core,
  type Manifest,
  type Permission,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  expectPlumsError,
  listAll,
  manifestZip,
  validManifest,
} from "./package-helpers.js";

const openCores: Core[] = [];

afterEach(() => {
  for (const core of openCores.splice(0)) {
    core.close();
  }
});

const perm = (
  id: string,
  level: Permission["level"] = "read",
  target = "notes",
): Permission => ({
  id,
  level,
  target,
  reason: `why ${id}`,
});

function manifest(
  version: string,
  permissions: Permission[],
  note = version,
): Manifest {
  return {
    ...validManifest("extension"),
    id: "demo-ext",
    dependencies: [],
    version,
    permissions,
    payload: { note },
  };
}

function bytes(
  m: Manifest,
  files: { name: string; data: string }[] = [
    { name: "a.txt", data: m.version },
  ],
) {
  return manifestZip(m, files);
}

/** Installs 1.0.0 with the given permissions, consented and enabled. */
async function installed(permissions: Permission[]) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "plums-t6-"));
  const core = createCore({
    dataDir,
    egress: new RecordingEgressSink(),
    confirm: new ScriptedConfirm(),
    secrets: new MemorySecretStore(),
  });
  openCores.push(core);
  await core.importPackage(await bytes(manifest("1.0.0", permissions)));
  await core.grantConsent("demo-ext");
  await core.enable("demo-ext");
  return { core, dataDir };
}

async function snapshot({ core, dataDir }: { core: Core; dataDir: string }) {
  const packageDir = path.join(dataDir, "packages");
  return {
    files: listAll(packageDir).map((f) => [
      f,
      f.endsWith(".json") || f.endsWith(".txt")
        ? readFileSync(path.join(packageDir, f), "utf8")
        : null,
    ]),
    installed: await core.listInstalled(),
    consent: await core.getConsent("demo-ext"),
  };
}

describe("updatePackage refuses added or raised permissions", () => {
  const base = [
    perm("a", "read", "notes"),
    perm("b", "write", "files.example.com"),
  ];
  const cases: [string, Permission[], string, string][] = [
    ["a new id", [...base, perm("c")], "/permissions/2", "NEW_PERMISSION"],
    [
      "a raised level",
      [perm("a", "write", "notes"), base[1]!],
      "/permissions/0",
      "LEVEL_RAISED",
    ],
    [
      "a raised level to egress",
      [base[0]!, perm("b", "egress", "files.example.com")],
      "/permissions/1",
      "LEVEL_RAISED",
    ],
    [
      "a changed target",
      [base[0]!, perm("b", "write", "other")],
      "/permissions/1",
      "TARGET_CHANGED",
    ],
  ];

  it.each(cases)(
    "%s: CONSENT_REQUIRED, old version untouched",
    async (_name, next, at, reason) => {
      const ctx = await installed(base);
      const before = await snapshot(ctx);
      const err = await expectPlumsError(
        ctx.core.updatePackage(await bytes(manifest("2.0.0", next))),
        "CONSENT_REQUIRED",
        at,
      );
      expect(err.details).toMatchObject({ id: "demo-ext", reason });
      expect(await snapshot(ctx)).toEqual(before);
      expect(before.installed[0]).toMatchObject({
        version: "1.0.0",
        enabled: true,
        consented: true,
      });
    },
  );
});

describe("CONSENT_REQUIRED lists every added permission", () => {
  it("path points at the first, details.added holds all of them", async () => {
    const ctx = await installed([perm("a", "read", "notes")]);
    const next = [
      perm("c"),
      perm("a", "write", "notes"),
      perm("d", "egress", "x.example.com"),
    ];
    const err = await expectPlumsError(
      ctx.core.updatePackage(await bytes(manifest("2.0.0", next))),
      "CONSENT_REQUIRED",
      "/permissions/0",
    );
    expect(err.details).toEqual({
      id: "demo-ext",
      permissionId: "c",
      reason: "NEW_PERMISSION",
      added: [
        { path: "/permissions/0", permissionId: "c", reason: "NEW_PERMISSION" },
        { path: "/permissions/1", permissionId: "a", reason: "LEVEL_RAISED" },
        { path: "/permissions/2", permissionId: "d", reason: "NEW_PERMISSION" },
      ],
    });
  });
});

describe("updatePackage succeeds", () => {
  const base = [
    perm("a", "write", "notes"),
    perm("b", "egress", "x.example.com"),
  ];
  const cases: [string, Permission[], boolean][] = [
    ["same permissions", base, false],
    ["fewer permissions", [base[0]!], false],
    ["a lowered level", [perm("a", "read", "notes"), base[1]!], false],
    ["a new permission that is approved", [...base, perm("c")], true],
  ];

  it.each(cases)(
    "%s: files replaced, enabled and consent kept",
    async (_name, next, consent) => {
      const ctx = await installed(base);
      const old = await ctx.core.getConsent("demo-ext");
      const next2 = manifest("2.0.0", next);

      const result = await ctx.core.updatePackage(await bytes(next2), {
        consent,
      });

      expect(result).toMatchObject({
        previousVersion: "1.0.0",
        manifest: { version: "2.0.0" },
      });
      expect(readFileSync(path.join(result.installDir, "a.txt"), "utf8")).toBe(
        "2.0.0",
      );
      expect(
        JSON.parse(
          readFileSync(path.join(result.installDir, "manifest.json"), "utf8"),
        ),
      ).toEqual(next2);
      expect(listAll(path.join(ctx.dataDir, "packages"))).toEqual([
        "demo-ext",
        "demo-ext/a.txt",
        "demo-ext/manifest.json",
      ]);
      expect(await ctx.core.listInstalled()).toMatchObject([
        { id: "demo-ext", version: "2.0.0", enabled: true, consented: true },
      ]);
      const now = await ctx.core.getConsent("demo-ext");
      expect(now).toMatchObject({ version: "2.0.0", permissions: next });
      expect(now?.grantedAt === old?.grantedAt).toBe(!consent);
      for (const p of next) {
        const run = ctx.core.runAction({
          extensionId: "demo-ext",
          permissionId: p.id,
          request: { url: "https://x.example.com/" },
        });
        await expect(
          run.catch((e: { code: string }) => e.code),
        ).resolves.not.toBe("CONSENT_REQUIRED");
      }
    },
  );

  it("an unconsented package is updated without gaining consent", async () => {
    const ctx = await installed(base);
    await ctx.core.uninstall("demo-ext");
    await ctx.core.importPackage(await bytes(manifest("1.0.0", base)));
    await ctx.core.updatePackage(await bytes(manifest("2.0.0", base)));
    expect(await ctx.core.listInstalled()).toMatchObject([
      { version: "2.0.0", enabled: false, consented: false },
    ]);
  });
});

describe("updatePackage other rejections", () => {
  const dep = (id: string, range: string, optional = false) => ({
    kind: "extension" as const,
    id,
    range,
    optional,
  });
  const cases: [string, Partial<Manifest>, string, string, unknown][] = [
    [
      "the same version",
      { version: "1.0.0" },
      "IMPORT_INVALID",
      "/version",
      { id: "demo-ext", installed: "1.0.0", incoming: "1.0.0" },
    ],
    [
      "a lower version",
      { version: "0.9.0" },
      "IMPORT_INVALID",
      "/version",
      { id: "demo-ext", installed: "1.0.0", incoming: "0.9.0" },
    ],
    [
      "a prerelease below the release",
      { version: "1.0.0-beta.1" },
      "IMPORT_INVALID",
      "/version",
      { id: "demo-ext", installed: "1.0.0", incoming: "1.0.0-beta.1" },
    ],
    [
      "a changed kind",
      { kind: "connector", permissions: [] },
      "IMPORT_INVALID",
      "/kind",
      { id: "demo-ext", installed: "extension", incoming: "connector" },
    ],
    [
      "a missing required dependency",
      { dependencies: [dep("opt", "*", true), dep("gone", "^1.0.0")] },
      "DEPENDENCY_MISSING",
      "/dependencies/1",
      undefined,
    ],
  ];

  it.each(cases)(
    "%s: rejected before any write, nothing changes",
    async (_name, patch, code, at, details) => {
      const ctx = await installed([perm("a")]);
      const before = await snapshot(ctx);
      const err = await expectPlumsError(
        ctx.core.updatePackage(
          await bytes({ ...manifest("2.0.0", [perm("a")]), ...patch }),
        ),
        code,
        at,
      );
      if (details !== undefined) {
        expect(err.details).toEqual(details);
      }
      if (code === "DEPENDENCY_MISSING") {
        expect(err.message).toMatch(/^依赖不满足：.*gone/);
      }
      expect(await snapshot(ctx)).toEqual(before);
    },
  );

  it("a dependency whose version does not fit is rejected; a satisfied one is accepted", async () => {
    const ctx = await installed([perm("a")]);
    await ctx.core.importPackage(
      await manifestZip({ ...manifest("2.0.0", []), id: "base-pack" }),
    );
    const update = async (range: string) =>
      ctx.core.updatePackage(
        await bytes({
          ...manifest("2.0.0", [perm("a")]),
          dependencies: [dep("base-pack", range)],
        }),
      );
    await expectPlumsError(
      update("^1.0.0"),
      "DEPENDENCY_MISSING",
      "/dependencies/0",
    );
    await expect(update("^2.0.0")).resolves.toMatchObject({
      previousVersion: "1.0.0",
    });
  });

  it("an id that is not installed: PERMISSION_DENIED", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "plums-t6-"));
    const core = createCore({
      dataDir,
      egress: new RecordingEgressSink(),
      confirm: new ScriptedConfirm(),
      secrets: new MemorySecretStore(),
    });
    openCores.push(core);
    const err = await expectPlumsError(
      core.updatePackage(await bytes(manifest("2.0.0", []))),
      "PERMISSION_DENIED",
    );
    expect(err.details).toMatchObject({
      id: "demo-ext",
      reason: "NOT_INSTALLED",
    });
    expect(listAll(dataDir)).toEqual(["plums.db"]);
  });

  it("an invalid zip keeps the old version", async () => {
    const ctx = await installed([perm("a")]);
    const before = await snapshot(ctx);
    await expectPlumsError(
      ctx.core.updatePackage(new Uint8Array([1, 2, 3])),
      "IMPORT_INVALID",
    );
    expect(await snapshot(ctx)).toEqual(before);
  });

  it("a database failure restores the old files", async () => {
    const ctx = await installed([perm("a")]);
    const before = await snapshot(ctx);
    const db = new Database(path.join(ctx.dataDir, "plums.db"));
    db.exec(
      "CREATE TRIGGER boom BEFORE UPDATE ON packages BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    db.close();
    await expect(
      ctx.core.updatePackage(await bytes(manifest("2.0.0", [perm("a")]))),
    ).rejects.toThrow("boom");
    const db2 = new Database(path.join(ctx.dataDir, "plums.db"));
    db2.exec("DROP TRIGGER boom");
    db2.close();
    expect(await snapshot(ctx)).toEqual(before);
  });
});
