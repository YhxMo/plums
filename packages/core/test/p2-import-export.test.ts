import { readFileSync } from "node:fs";
import path from "node:path";
import { PlumsError, type Manifest } from "@plums/core";
import { describe, expect, it } from "vitest";
import { buildZip, expectPlumsError, listAll, makeCore, manifestZip, validManifest } from "./package-helpers.js";

function plainManifest(id = "demo-character"): Manifest {
  return { ...validManifest(), id, dependencies: [], permissions: [] };
}

function ownText(files: Record<string, Uint8Array>, name: string): string | undefined {
  const value = Object.getOwnPropertyDescriptor(files, name)?.value as Uint8Array | undefined;
  return value === undefined ? undefined : Buffer.from(value).toString("utf8");
}

describe("case-insensitive path collisions", () => {
  it("rejects A.txt and a.txt and writes nothing", async () => {
    const { core, dataDir } = makeCore();
    const zip = await manifestZip(plainManifest(), [
      { name: "A.txt", data: "UPPER" },
      { name: "a.txt", data: "lower" },
    ]);
    const err = await expectPlumsError(core.importPackage(zip), "IMPORT_INVALID", "/a.txt");
    expect(err.message).toContain("A.txt");
    expect(err.message).toContain("a.txt");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("rejects a manifest.json alias and writes nothing", async () => {
    const { core, dataDir } = makeCore();
    const zip = await manifestZip(plainManifest(), [{ name: "MANIFEST.JSON", data: "ALIAS-BYTES" }]);
    const err = await expectPlumsError(core.importPackage(zip), "IMPORT_INVALID", "/MANIFEST.JSON");
    expect(err.message).toContain("MANIFEST.JSON");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("rejects the same collisions on export", async () => {
    const { core, dataDir } = makeCore();
    const manifest = plainManifest();
    const caseErr = await expectPlumsError(
      core.exportPackage({ manifest, files: { "A.txt": "UPPER", "a.txt": "lower" } }),
      "IMPORT_INVALID",
      "/a.txt",
    );
    expect(caseErr.message).toContain("a.txt");
    const aliasErr = await expectPlumsError(
      core.exportPackage({ manifest, files: { "MANIFEST.JSON": "ALIAS-BYTES" } }, { outPath: path.join(dataDir, "alias.zip") }),
      "IMPORT_INVALID",
      "/MANIFEST.JSON",
    );
    expect(aliasErr.message).toContain("MANIFEST.JSON");
    expect(listAll(dataDir)).toEqual([]);
  });
});

describe("export path conflicts", () => {
  it("refuses a file that is also a directory", async () => {
    const { core, dataDir } = makeCore();
    const outPath = path.join(dataDir, "clash.zip");
    const err = await expectPlumsError(
      core.exportPackage({ manifest: plainManifest(), files: { a: "file", "a/b.txt": "child" } }, { outPath }),
      "IMPORT_INVALID",
    );
    expect(err.path).toBeUndefined();
    expect(err.message).toContain("既是文件又是文件夹");
    expect(err.message).toContain("a");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("refuses a child of manifest.json", async () => {
    const { core } = makeCore();
    const err = await expectPlumsError(
      core.exportPackage({ manifest: plainManifest(), files: { "manifest.json/child": "nope" } }),
      "IMPORT_INVALID",
    );
    expect(err.message).toContain("manifest.json");
    expect(err.message).toContain("既是文件又是文件夹");
  });

  it("imports every package it successfully exports", async () => {
    const { core } = makeCore();
    const manifest = plainManifest();
    const cases: Record<string, string>[] = [
      {},
      { "readme.txt": "hi" },
      { "dir/a.txt": "a", "dir/b.txt": "b" },
      { "A.txt": "only-upper" },
    ];
    for (const files of cases) {
      const bytes = await core.exportPackage({ manifest, files });
      const imported = await makeCore().core.importPackage(bytes);
      expect(imported.manifest).toEqual(manifest);
      expect(Object.keys(imported.files).sort()).toEqual(Object.keys(files).sort());
      for (const [name, text] of Object.entries(files)) {
        expect(ownText(imported.files, name)).toBe(text);
      }
    }

    const protoFiles = Object.create(null) as Record<string, Uint8Array>;
    protoFiles["__proto__"] = Buffer.from("proto-bytes");
    protoFiles["notes.txt"] = Buffer.from("keep");
    const protoZip = await core.exportPackage({ manifest, files: protoFiles });
    const protoBack = await makeCore().core.importPackage(protoZip);
    expect(ownText(protoBack.files, "__proto__")).toBe("proto-bytes");
    expect(ownText(protoBack.files, "notes.txt")).toBe("keep");
    expect(readFileSync(path.join(protoBack.installDir, "__proto__"), "utf8")).toBe("proto-bytes");
  });
});

describe("__proto__ file name", () => {
  it("survives shareToFile and import with the same bytes", async () => {
    const { core, dataDir } = makeCore();
    const manifest = plainManifest();
    const zip = await buildZip([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "__proto__", data: "proto-bytes" },
      { name: "notes.txt", data: "keep" },
    ]);
    const imported = await core.importPackage(zip);
    expect(ownText(imported.files, "__proto__")).toBe("proto-bytes");
    expect(readFileSync(path.join(imported.installDir, "__proto__"), "utf8")).toBe("proto-bytes");

    const shared = await core.shareToFile(manifest.id, path.join(dataDir, "shared.zip"));
    const back = await makeCore().core.importPackage(shared);
    expect(ownText(back.files, "__proto__")).toBe("proto-bytes");
    expect(ownText(back.files, "notes.txt")).toBe("keep");
    expect(readFileSync(path.join(back.installDir, "__proto__"), "utf8")).toBe("proto-bytes");
  });
});

describe("concurrent import of one id", () => {
  it("lets exactly one win across repeated bursts", async () => {
    const zip = await manifestZip(plainManifest(), [{ name: "a.txt", data: "same" }]);
    for (let round = 0; round < 3; round += 1) {
      const { core } = makeCore();
      const results = await Promise.all(
        Array.from({ length: 40 }, () => core.importPackage(zip).then(() => "ok" as const, (err: unknown) => err)),
      );
      expect(results.filter((item) => item === "ok")).toHaveLength(1);
      for (const err of results) {
        if (err === "ok") continue;
        expect(err).toBeInstanceOf(PlumsError);
        const plums = err as PlumsError;
        expect(plums.code).toBe("IMPORT_INVALID");
        expect(plums.details).toEqual({ id: "demo-character", reason: "ALREADY_INSTALLED" });
        expect(plums.message).not.toContain("ENOTEMPTY");
      }
      expect(await core.listInstalled()).toEqual([
        expect.objectContaining({ id: "demo-character", version: "1.2.3", enabled: false, consented: false }),
      ]);
      expect(readFileSync(path.join(core.dataDir, "packages", "demo-character", "a.txt"), "utf8")).toBe("same");
    }
  });

  it("does not clear consent or enabled when the same id loses the race", async () => {
    const { core } = makeCore();
    const manifest = plainManifest();
    const zip = await manifestZip(manifest);
    await core.importPackage(zip);
    await core.grantConsent(manifest.id);
    await core.enable(manifest.id);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => core.importPackage(zip).then(() => "ok" as const, (err: unknown) => err)),
    );
    expect(results).toHaveLength(20);
    for (const err of results) {
      expect(err).toBeInstanceOf(PlumsError);
      expect((err as PlumsError).details).toEqual({ id: manifest.id, reason: "ALREADY_INSTALLED" });
    }
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: manifest.id, enabled: true, consented: true }),
    ]);
    expect(await core.getConsent(manifest.id)).not.toBeNull();
  });

  it("imports different ids at the same time", async () => {
    const { core } = makeCore();
    const [first, second] = await Promise.all([
      manifestZip(plainManifest("pack-a")),
      manifestZip(plainManifest("pack-b")),
    ]);
    await Promise.all([core.importPackage(first), core.importPackage(second)]);
    expect((await core.listInstalled()).map((item) => item.id)).toEqual(["pack-a", "pack-b"]);
  });
});
