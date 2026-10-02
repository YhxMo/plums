import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createCore,
  FakeModelProvider,
  MemorySecretStore,
  PlumsError,
  RecordingEgressSink,
  ScriptedConfirm,
  type Core,
  type Dependency,
  type Manifest,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import { expectPlumsError, listAll, manifestZip, validManifest } from "./package-helpers.js";

const openCores: Core[] = [];

function coreAt(dataDir: string): Core {
  const core = createCore({
    dataDir,
    model: new FakeModelProvider(),
    egress: new RecordingEgressSink(),
    confirm: new ScriptedConfirm(),
    secrets: new MemorySecretStore(),
  });
  openCores.push(core);
  return core;
}

function freshCore(): { core: Core; dataDir: string } {
  const dataDir = mkdtempSync(path.join(tmpdir(), "plums-t4-"));
  return { core: coreAt(dataDir), dataDir };
}

afterEach(() => {
  for (const core of openCores.splice(0)) {
    core.close();
  }
});

function manifestWith(overrides: Partial<Manifest> = {}): Manifest {
  return { ...validManifest("extension"), id: "demo-ext", dependencies: [], ...overrides };
}

function dep(id: string, range: string, optional?: boolean): Dependency {
  return {
    kind: "extension",
    id,
    range,
    ...(optional === undefined ? {} : { optional }),
  };
}

async function importManifest(
  core: Core,
  manifest: Manifest,
  extra: { name: string; data: string }[] = [],
): Promise<void> {
  await core.importPackage(await manifestZip(manifest, extra));
}

describe("import leaves a package installed, not enabled, not consented", () => {
  it("shows up in listInstalled with the right state", async () => {
    const { core } = freshCore();
    expect(await core.listInstalled()).toEqual([]);
    await importManifest(core, manifestWith());
    const [installed, ...rest] = await core.listInstalled();
    expect(rest).toEqual([]);
    expect(installed).toMatchObject({
      id: "demo-ext",
      kind: "extension",
      name: "Demo extension",
      version: "1.2.3",
      enabled: false,
      enabledAt: null,
      consented: false,
    });
    expect(new Date(installed?.installedAt ?? "").toISOString()).toBe(installed?.installedAt);
    await expect(core.getConsent("demo-ext")).resolves.toBeNull();
  });

  it("lists packages ordered by id", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith({ id: "b-pack" }));
    await importManifest(core, manifestWith({ id: "a-pack" }));
    expect((await core.listInstalled()).map((p) => p.id)).toEqual(["a-pack", "b-pack"]);
  });

  it("a package that fails validation is not recorded and creates no database", async () => {
    const { core, dataDir } = freshCore();
    await expectPlumsError(core.importPackage(new Uint8Array([1, 2, 3])), "IMPORT_INVALID");
    expect(await core.listInstalled()).toEqual([]);
    expect(listAll(dataDir)).toEqual(["plums.db"]);
    const second = freshCore();
    await expectPlumsError(second.core.importPackage(new Uint8Array([1, 2, 3])), "IMPORT_INVALID");
    expect(listAll(second.dataDir)).toEqual([]);
  });
});

describe("consent and enable", () => {
  it("enable without consent returns CONSENT_REQUIRED and changes nothing", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith());
    const err = await expectPlumsError(core.enable("demo-ext"), "CONSENT_REQUIRED");
    expect(err.message).toContain("同意");
    const [installed] = await core.listInstalled();
    expect(installed?.enabled).toBe(false);
  });

  it("enable succeeds after consent, and the consent record can be read", async () => {
    const { core } = freshCore();
    const zip = await manifestZip(manifestWith());
    const inspected = await core.inspect(zip);
    await core.importPackage(zip);

    const before = Date.now();
    const granted = await core.grantConsent("demo-ext");
    const enabled = await core.enable("demo-ext");

    expect(enabled).toMatchObject({ id: "demo-ext", enabled: true, consented: true });
    expect(new Date(enabled.enabledAt ?? "").toISOString()).toBe(enabled.enabledAt);

    const consent = await core.getConsent("demo-ext");
    expect(consent).toEqual(granted);
    expect(consent?.packageId).toBe("demo-ext");
    expect(consent?.version).toBe("1.2.3");
    expect(consent?.permissions).toEqual(inspected.permissions);
    expect(consent?.permissions.map((p) => [p.id, p.level])).toEqual([
      ["read-notes", "read"],
      ["send-stats", "egress"],
    ]);
    expect(new Date(consent?.grantedAt ?? "").getTime()).toBeGreaterThanOrEqual(before);
  });

  it("a package with no permissions still needs a consent record", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith({ permissions: [] }));
    await expectPlumsError(core.enable("demo-ext"), "CONSENT_REQUIRED");
    const consent = await core.grantConsent("demo-ext");
    expect(consent.permissions).toEqual([]);
    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });
  });

  it("consent keeps unknown fields of the permission items", async () => {
    const { core } = freshCore();
    const permissions = [
      { id: "p", level: "read" as const, target: "t", reason: "r", futureField: { a: 1 } },
    ];
    await importManifest(core, manifestWith({ permissions }));
    expect((await core.grantConsent("demo-ext")).permissions).toEqual(permissions);
  });

  it("enable and disable can be repeated; disable keeps the consent", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith());
    await core.grantConsent("demo-ext");
    await core.enable("demo-ext");
    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });

    const off = await core.disable("demo-ext");
    expect(off).toMatchObject({ enabled: false, consented: true });
    await expect(core.disable("demo-ext")).resolves.toMatchObject({ enabled: false });
    expect(await core.getConsent("demo-ext")).not.toBeNull();

    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });
  });
});

describe("dependencies", () => {
  async function importWithDeps(core: Core, dependencies: Dependency[]): Promise<void> {
    await importManifest(core, manifestWith({ dependencies }));
    await core.grantConsent("demo-ext");
  }

  it("consent is checked before dependencies", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith({ dependencies: [dep("base-pack", "^1.0.0")] }));
    await expectPlumsError(core.enable("demo-ext"), "CONSENT_REQUIRED");
  });

  it("a missing required dependency returns DEPENDENCY_MISSING with its JSON Pointer", async () => {
    const { core } = freshCore();
    await importWithDeps(core, [dep("base-pack", "^1.0.0", false)]);
    const err = await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/0");
    expect(err.message).toMatch(/^依赖不满足：/);
    expect(err.message).toContain("base-pack");
    expect(err.details).toMatchObject({
      id: "demo-ext",
      missing: [{ path: "/dependencies/0", kind: "extension", id: "base-pack", range: "^1.0.0" }],
    });
    expect((await core.listInstalled())[0]?.enabled).toBe(false);
  });

  it("the path points at the missing item, not the first item", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith({ id: "have-it", dependencies: [] }));
    await importWithDeps(core, [dep("have-it", "*"), dep("gone", "^1.0.0")]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/1");
  });

  it("a dependency without `optional` counts as required", async () => {
    const { core } = freshCore();
    await importWithDeps(core, [dep("base-pack", "^1.0.0")]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/0");
  });

  it("a missing optional dependency does not block enable", async () => {
    const { core } = freshCore();
    await importWithDeps(core, [dep("nice-to-have", "^1.0.0", true)]);
    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });
  });

  it("an optional dependency does not hide a required one after it", async () => {
    const { core } = freshCore();
    await importWithDeps(core, [dep("nice", "^1.0.0", true), dep("must", "^1.0.0", false)]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/1");
  });

  it("reports every missing dependency in details, the first one in path", async () => {
    const { core } = freshCore();
    await importWithDeps(core, [dep("one", "^1.0.0"), dep("two", "^1.0.0")]);
    const err = await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/0");
    const missing = (err.details as { missing: { path: string }[] }).missing;
    expect(missing.map((m) => m.path)).toEqual(["/dependencies/0", "/dependencies/1"]);
  });

  it("an installed dependency whose version does not satisfy the range also counts as missing", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith({ id: "base-pack", version: "2.0.0" }));
    await importWithDeps(core, [dep("base-pack", "^1.0.0")]);
    const err = await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/0");
    expect(err.message).toContain("2.0.0");
    expect(err.message).toContain("^1.0.0");
  });

  it("a prerelease does not satisfy a plain range", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith({ id: "base-pack", version: "1.5.0-beta.1" }));
    await importWithDeps(core, [dep("base-pack", "^1.0.0")]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/0");
  });

  it("an installed package of another kind does not satisfy the dependency", async () => {
    const { core } = freshCore();
    await importManifest(core, { ...validManifest("connector"), id: "base-pack", dependencies: [] });
    await importWithDeps(core, [dep("base-pack", "*")]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING", "/dependencies/0");
  });

  it("a connector dependency is matched by its own kind", async () => {
    const { core } = freshCore();
    await importManifest(core, { ...validManifest("connector"), id: "my-conn", version: "1.1.0", dependencies: [] });
    await importWithDeps(core, [{ kind: "connector", id: "my-conn", range: "~1.1.0" }]);
    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });
  });

  it("enable works once a satisfying dependency is installed; it need not be enabled", async () => {
    const { core } = freshCore();
    await importWithDeps(core, [dep("base-pack", ">=1.0.0 <2.0.0")]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING");
    await importManifest(core, manifestWith({ id: "base-pack", version: "1.9.9" }));
    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });
  });

  it("nothing is downloaded: the egress sink stays empty", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "plums-t4-"));
    const egress = new RecordingEgressSink();
    const core = createCore({
      dataDir,
      model: new FakeModelProvider(),
      egress,
      confirm: new ScriptedConfirm(),
      secrets: new MemorySecretStore(),
    });
    openCores.push(core);
    await importWithDeps(core, [dep("base-pack", "^1.0.0")]);
    await expectPlumsError(core.enable("demo-ext"), "DEPENDENCY_MISSING");
    expect(egress.records).toEqual([]);
  });
});

describe("uninstall", () => {
  it("removes files, data, install state and consent", async () => {
    const { core, dataDir } = freshCore();
    await importManifest(core, manifestWith(), [{ name: "prompts/a.txt", data: "hi" }]);
    await importManifest(core, manifestWith({ id: "other-pack" }));
    await core.grantConsent("demo-ext");
    await core.enable("demo-ext");
    const settingsFile = path.join(dataDir, "data", "demo-ext", "settings.json");
    mkdirSync(path.dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, '{"nickname":"x"}');
    const otherData = path.join(dataDir, "data", "other-pack", "keep.txt");
    mkdirSync(path.dirname(otherData), { recursive: true });
    writeFileSync(otherData, "keep");

    await core.uninstall("demo-ext");

    expect(listAll(dataDir).filter((entry) => entry.includes("demo-ext"))).toEqual([]);
    expect(existsSync(path.join(dataDir, "packages", "other-pack", "manifest.json"))).toBe(true);
    expect(readFileSync(otherData, "utf8")).toBe("keep");

    expect((await core.listInstalled()).map((p) => p.id)).toEqual(["other-pack"]);
    await expectPlumsError(core.getConsent("demo-ext"), "PERMISSION_DENIED");

    core.close();
    const db = new Database(path.join(dataDir, "plums.db"), { readonly: true });
    try {
      expect(db.prepare("SELECT id FROM packages").all()).toEqual([{ id: "other-pack" }]);
      expect(db.prepare("SELECT package_id FROM consents").all()).toEqual([]);
    } finally {
      db.close();
    }
    expect(readFileSync(path.join(dataDir, "plums.db")).includes("demo-ext")).toBe(false);
  });

  it("can be imported again, and then needs a fresh consent", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith());
    await core.grantConsent("demo-ext");
    await core.enable("demo-ext");
    await core.uninstall("demo-ext");

    await importManifest(core, manifestWith());
    expect(await core.listInstalled()).toMatchObject([{ id: "demo-ext", enabled: false, consented: false }]);
    await expect(core.getConsent("demo-ext")).resolves.toBeNull();
    await expectPlumsError(core.enable("demo-ext"), "CONSENT_REQUIRED");

    await core.grantConsent("demo-ext");
    await expect(core.enable("demo-ext")).resolves.toMatchObject({ enabled: true });
  });

  it("works on a package that was never enabled or consented", async () => {
    const { core, dataDir } = freshCore();
    await importManifest(core, manifestWith());
    await core.uninstall("demo-ext");
    expect(listAll(dataDir).filter((entry) => entry.includes("demo-ext"))).toEqual([]);
  });
});

describe("importing an id that is already installed", () => {
  it("replaces it and resets it to installed, not enabled, not consented", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith());
    await core.grantConsent("demo-ext");
    await core.enable("demo-ext");

    await importManifest(core, manifestWith({ version: "2.0.0", permissions: [] }));

    expect(await core.listInstalled()).toMatchObject([
      { id: "demo-ext", version: "2.0.0", enabled: false, consented: false },
    ]);
    await expect(core.getConsent("demo-ext")).resolves.toBeNull();
    await expectPlumsError(core.enable("demo-ext"), "CONSENT_REQUIRED");
  });
});

describe("restart", () => {
  it("install state and consent survive a new core on the same dataDir", async () => {
    const { core, dataDir } = freshCore();
    await importManifest(core, manifestWith());
    await importManifest(core, manifestWith({ id: "idle-pack" }));
    const granted = await core.grantConsent("demo-ext");
    await core.enable("demo-ext");
    const before = await core.listInstalled();
    core.close();

    const restarted = coreAt(dataDir);
    expect(await restarted.listInstalled()).toEqual(before);
    expect(await restarted.getConsent("demo-ext")).toEqual(granted);
    expect(await restarted.getConsent("idle-pack")).toBeNull();

    await restarted.uninstall("demo-ext");
    const again = coreAt(dataDir);
    expect((await again.listInstalled()).map((p) => p.id)).toEqual(["idle-pack"]);
  });

  it("works while the first core is still open", async () => {
    const { core, dataDir } = freshCore();
    await importManifest(core, manifestWith());
    await core.grantConsent("demo-ext");
    const second = coreAt(dataDir);
    expect(await second.getConsent("demo-ext")).not.toBeNull();
  });
});

describe("operations on an id that is not installed", () => {
  const operations: [string, (core: Core) => Promise<unknown>][] = [
    ["grantConsent", (core) => core.grantConsent("ghost")],
    ["getConsent", (core) => core.getConsent("ghost")],
    ["enable", (core) => core.enable("ghost")],
    ["disable", (core) => core.disable("ghost")],
    ["uninstall", (core) => core.uninstall("ghost")],
  ];

  it.each(operations)("%s returns PERMISSION_DENIED with reason NOT_INSTALLED", async (_name, run) => {
    const { core } = freshCore();
    const err = await expectPlumsError(run(core), "PERMISSION_DENIED");
    expect(err.message).toContain("ghost");
    expect(err.details).toEqual({ id: "ghost", reason: "NOT_INSTALLED" });
  });

  it("a second uninstall fails the same way", async () => {
    const { core } = freshCore();
    await importManifest(core, manifestWith());
    await core.uninstall("demo-ext");
    const err = await expectPlumsError(core.uninstall("demo-ext"), "PERMISSION_DENIED");
    expect(err).toBeInstanceOf(PlumsError);
  });
});

describe("main line", () => {
  it("import, inspect, consent and enable, uninstall, reinstall", async () => {
    const { core, dataDir } = freshCore();
    const base = await manifestZip(manifestWith({ id: "base-pack", version: "1.0.0" }));
    const app = await manifestZip(
      manifestWith({ id: "my-ext", dependencies: [dep("base-pack", "^1.0.0")] }),
      [{ name: "prompts/hello.txt", data: "hello" }],
    );

    await core.importPackage(base);
    const inspected = await core.inspect(app);
    expect(inspected.permissions.map((p) => [p.id, p.level, p.reason])).toEqual([
      ["read-notes", "read", "Show your notes."],
      ["send-stats", "egress", "Upload usage."],
    ]);
    expect(await core.listInstalled().then((all) => all.map((p) => p.id))).toEqual(["base-pack"]);

    await core.importPackage(app);
    await expectPlumsError(core.enable("my-ext"), "CONSENT_REQUIRED");
    await core.grantConsent("my-ext");
    expect(await core.enable("my-ext")).toMatchObject({ enabled: true });
    expect((await core.getConsent("my-ext"))?.permissions).toEqual(inspected.permissions);

    await core.uninstall("my-ext");
    expect(listAll(dataDir).filter((entry) => entry.includes("my-ext"))).toEqual([]);

    await core.importPackage(app);
    await expectPlumsError(core.enable("my-ext"), "CONSENT_REQUIRED");
    await core.grantConsent("my-ext");
    expect(await core.enable("my-ext")).toMatchObject({ enabled: true });
  });
});
