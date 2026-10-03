import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MemorySecretStore, PACKAGE_FORMAT_VERSION, SUPPORTED_FORMAT_MAJOR, PlumsError, secretRef, type Manifest } from "@plums/core";
import { describe, expect, it } from "vitest";
import {
  buildZip,
  expectPlumsError,
  listAll,
  makeCore,
  manifestZip,
  renameEntry,
  validManifest,
} from "./package-helpers.js";

describe("importPackage: valid packages", () => {
  for (const kind of ["character", "extension", "connector"] as const) {
    it(`imports a ${kind} package`, async () => {
      const { core, dataDir } = makeCore();
      const manifest = validManifest(kind);
      const zip = await manifestZip(manifest, [{ name: "assets/icon.txt", data: "icon" }]);

      const imported = await core.importPackage(zip);

      expect(imported.manifest).toEqual(manifest);
      expect(imported.installDir).toBe(path.join(core.dataDir, "packages", manifest.id));
      expect(Object.keys(imported.files)).toEqual(["assets/icon.txt"]);
      expect(readFileSync(path.join(imported.installDir, "assets", "icon.txt"), "utf8")).toBe("icon");
      expect(JSON.parse(readFileSync(path.join(imported.installDir, "manifest.json"), "utf8"))).toEqual(
        manifest,
      );
      expect(listAll(dataDir).some((name) => name.includes(".staging-"))).toBe(false);
    });
  }

  it("imports from a file path", async () => {
    const { core, dataDir } = makeCore();
    const zipPath = path.join(dataDir, "..", `in-${Date.now()}.zip`);
    writeFileSync(zipPath, await manifestZip(validManifest()));
    const imported = await core.importPackage(zipPath);
    expect(imported.manifest.id).toBe("demo-character");
  });

  it("keeps unknown fields, signature and payload as they were", async () => {
    const { core } = makeCore();
    const manifest = {
      ...validManifest("extension"),
      futureField: { a: [1, "two", null, true], b: 1.5 },
      signature: { alg: "ed25519", sig: "AAAA", extra: [1] },
      payload: [{ "weird key": "value" }, 0, "", null, { __proto__: "x" }],
    };
    manifest.permissions = [
      { ...manifest.permissions[0]!, note: "kept" },
      manifest.permissions[1]!,
    ];
    const text = JSON.stringify(manifest);
    const zip = await buildZip([{ name: "manifest.json", data: text }]);

    const imported = await core.importPackage(zip);

    expect(JSON.stringify(imported.manifest)).toBe(text);
    expect(readFileSync(path.join(imported.installDir, "manifest.json"), "utf8")).toBe(text);
  });

  it("accepts a higher minor formatVersion and an empty dependency list", async () => {
    const { core } = makeCore();
    const manifest = { ...validManifest(), formatVersion: "1.7", dependencies: [], permissions: [] };
    await expect(core.importPackage(await manifestZip(manifest))).resolves.toBeDefined();
  });

  it("refuses an id that is already installed and leaves the old files", async () => {
    const secrets = new MemorySecretStore();
    const { core, dataDir } = makeCore({ secrets });
    const first = await core.importPackage(await manifestZip(validManifest(), [{ name: "old.txt", data: "old" }]));
    await secrets.set(secretRef("demo-character", "token"), "sk-kept");
    await core.setSettings("demo-character", { nickname: "Pat" });
    const settingsPath = path.join(dataDir, "data", "demo-character", "settings.json");
    const settingsBefore = readFileSync(settingsPath, "utf8");
    const err = await expectPlumsError(
      core.importPackage(await manifestZip({ ...validManifest(), version: "2.0.0" }, [{ name: "new.txt", data: "new" }])),
      "IMPORT_INVALID",
    );
    expect(err.details).toEqual({ id: "demo-character", reason: "ALREADY_INSTALLED" });
    expect(listAll(first.installDir)).toEqual(["manifest.json", "old.txt"]);
    expect(readFileSync(settingsPath, "utf8")).toBe(settingsBefore);
    expect(await secrets.get(secretRef("demo-character", "token"))).toBe("sk-kept");
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: "demo-character", version: "1.2.3", enabled: false, consented: false }),
    ]);
  });

  it("imports the same id again after uninstall", async () => {
    const { core } = makeCore();
    await core.importPackage(await manifestZip(validManifest()));
    await core.uninstall("demo-character");
    const again = await core.importPackage(await manifestZip({ ...validManifest(), version: "2.0.0" }));
    expect(again.manifest.version).toBe("2.0.0");
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: "demo-character", version: "2.0.0", enabled: false, consented: false }),
    ]);
  });

  it("validatePackage does not write anything, even for a good package", async () => {
    const { core, dataDir } = makeCore();
    const result = await core.validatePackage(await manifestZip(validManifest()));
    expect(result.manifest.id).toBe("demo-character");
    expect(listAll(dataDir)).toEqual([]);
  });
});

describe("exportPackage", () => {
  it("round-trips: export then import gives the same content", async () => {
    const { core } = makeCore();
    const manifest = {
      ...validManifest("connector"),
      formatVersion: "1.7",
      futureField: { keep: "me" },
      signature: "opaque",
    } as Manifest;
    const binary = new Uint8Array([0, 255, 1, 254, 2]);

    const bytes = await core.exportPackage({
      manifest,
      files: { "data/blob.bin": binary, "README.txt": "hello 你好" },
    });
    const imported = await core.importPackage(bytes);

    expect(imported.manifest).toEqual(manifest);
    expect(Object.keys(imported.files).sort()).toEqual(["README.txt", "data/blob.bin"]);
    expect(Array.from(imported.files["data/blob.bin"]!)).toEqual(Array.from(binary));
    expect(Buffer.from(imported.files["README.txt"]!).toString("utf8")).toBe("hello 你好");

    const again = await core.exportPackage({ manifest: imported.manifest, files: imported.files });
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });

  it("writes to outPath when asked", async () => {
    const { core, dataDir } = makeCore();
    const outPath = path.join(dataDir, "out.zip");
    const bytes = await core.exportPackage({ manifest: validManifest() }, { outPath });
    expect(Buffer.from(readFileSync(outPath)).equals(Buffer.from(bytes))).toBe(true);
  });

  it("refuses an invalid manifest with MANIFEST_INVALID", async () => {
    const { core } = makeCore();
    const manifest = { ...validManifest(), version: "one" } as Manifest;
    await expectPlumsError(core.exportPackage({ manifest }), "MANIFEST_INVALID", "/version");
  });

  it("refuses a too-new formatVersion with FORMAT_UNSUPPORTED", async () => {
    const { core } = makeCore();
    const manifest = { ...validManifest(), formatVersion: "3.0" };
    await expectPlumsError(core.exportPackage({ manifest }), "FORMAT_UNSUPPORTED", "/formatVersion");
  });

  it("refuses unsafe or reserved file paths with IMPORT_INVALID", async () => {
    const { core } = makeCore();
    const manifest = validManifest();
    await expectPlumsError(core.exportPackage({ manifest, files: { "../x": "x" } }), "IMPORT_INVALID");
    await expectPlumsError(core.exportPackage({ manifest, files: { "/x": "x" } }), "IMPORT_INVALID");
    await expectPlumsError(
      core.exportPackage({ manifest, files: { "manifest.json": "{}" } }),
      "IMPORT_INVALID",
      "/manifest.json",
    );
  });
});

describe("importPackage: formatVersion", () => {
  it("exports the default format version and readable major", () => {
    expect(PACKAGE_FORMAT_VERSION).toBe("2.0");
    expect(SUPPORTED_FORMAT_MAJOR).toBe(2);
  });
  it("returns FORMAT_UNSUPPORTED when the major is higher than supported", async () => {
    const { core, dataDir } = makeCore();
    const zip = await manifestZip({ formatVersion: "3.0", somethingNew: true });
    await expectPlumsError(core.importPackage(zip), "FORMAT_UNSUPPORTED", "/formatVersion");
    expect(listAll(dataDir)).toEqual([]);
  });
});

describe("importPackage: bad zips return IMPORT_INVALID and write nothing", () => {
  const cases: [string, () => Promise<Uint8Array>][] = [
    ["not a zip", async () => new TextEncoder().encode("this is plain text, not a zip")],
    ["empty bytes", async () => new Uint8Array()],
    [
      "a truncated zip",
      async () => (await manifestZip(validManifest())).slice(0, 40),
    ],
    ["no manifest.json", () => buildZip([{ name: "readme.txt", data: "hi" }])],
    [
      "manifest.json inside a subfolder",
      () => buildZip([{ name: "pack/manifest.json", data: JSON.stringify(validManifest()) }]),
    ],
    [
      "a ../ path",
      async () =>
        renameEntry(
          await manifestZip(validManifest(), [{ name: "ab/evil.txt", data: "x" }]),
          "ab/evil.txt",
          "../evil.txt",
        ),
    ],
    [
      "a nested ../ path",
      async () =>
        renameEntry(
          await manifestZip(validManifest(), [{ name: "a/xx/evil.txt", data: "x" }]),
          "a/xx/evil.txt",
          "a/../evil.txt",
        ),
    ],
    [
      "an absolute path",
      async () =>
        renameEntry(
          await manifestZip(validManifest(), [{ name: "xetc/evil.txt", data: "x" }]),
          "xetc/evil.txt",
          "/etc/evil.txt",
        ),
    ],
    [
      "a Windows drive path",
      async () =>
        renameEntry(
          await manifestZip(validManifest(), [{ name: "Cx/evil.txt", data: "x" }]),
          "Cx/evil.txt",
          "C:/evil.txt",
        ),
    ],
    [
      "a backslash path",
      async () =>
        renameEntry(
          await manifestZip(validManifest(), [{ name: "a/evil.txt", data: "x" }]),
          "a/evil.txt",
          "a\\evil.txt",
        ),
    ],
    [
      "a path longer than 255 characters",
      () => manifestZip(validManifest(), [{ name: `${"a".repeat(256)}.txt`, data: "x" }]),
    ],
    [
      "more than 1000 files",
      () =>
        manifestZip(
          validManifest(),
          Array.from({ length: 1000 }, (_, i) => ({ name: `f/${i}.txt`, data: "x" })),
        ),
    ],
    [
      "a file that is also a folder",
      () => manifestZip(validManifest(), [{ name: "a", data: "x" }, { name: "a/b", data: "y" }]),
    ],
  ];

  for (const [label, make] of cases) {
    it(label, async () => {
      const { core, dataDir } = makeCore();
      await expectPlumsError(core.importPackage(await make()), "IMPORT_INVALID");
      expect(listAll(dataDir)).toEqual([]);
    });
  }

  it("accepts exactly 1000 files and a path of exactly 255 characters", async () => {
    const { core } = makeCore();
    const longName = `${"a".repeat(251)}.txt`;
    const files = Array.from({ length: 998 }, (_, i) => ({ name: `f/${i}.txt`, data: "x" }));
    const zip = await manifestZip(validManifest(), [...files, { name: longName, data: "x" }]);
    const result = await core.validatePackage(zip);
    expect(Object.keys(result.files)).toHaveLength(999);
  });

  it("gives a missing-file error for a path that does not exist", async () => {
    const { core, dataDir } = makeCore();
    await expectPlumsError(core.importPackage(path.join(dataDir, "nope.zip")), "IMPORT_INVALID");
    mkdirSync(path.join(dataDir, "adir"));
    await expectPlumsError(core.importPackage(path.join(dataDir, "adir")), "IMPORT_INVALID");
  });
});

describe("importPackage: size limits and zip bombs", () => {
  const MB = 1024 * 1024;

  it("rejects a package of about 50 MB when decompressed", async () => {
    const { core, dataDir } = makeCore();
    const zip = await manifestZip(validManifest(), [{ name: "bomb.bin", data: new Uint8Array(50 * MB) }]);
    expect(zip.length).toBeLessThan(1 * MB);
    const err = await expectPlumsError(core.importPackage(zip), "IMPORT_INVALID");
    expect(err.message).toContain("20 MB");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("rejects a bomb split over many files", async () => {
    const { core, dataDir } = makeCore();
    const chunk = new Uint8Array(2 * MB);
    const files = Array.from({ length: 25 }, (_, i) => ({ name: `part${i}.bin`, data: chunk }));
    await expectPlumsError(core.importPackage(await manifestZip(validManifest(), files)), "IMPORT_INVALID");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("rejects a bomb whose headers lie about the size", async () => {
    const { core, dataDir } = makeCore();
    const honest = await manifestZip(validManifest(), [{ name: "bomb.bin", data: new Uint8Array(50 * MB) }]);
    const lying = Buffer.from(honest);
    const sizeBytes = Buffer.alloc(4);
    sizeBytes.writeUInt32LE(50 * MB);
    const claimed = Buffer.alloc(4);
    claimed.writeUInt32LE(100);
    let patched = 0;
    for (let at = lying.indexOf(sizeBytes); at !== -1; at = lying.indexOf(sizeBytes, at + 1)) {
      claimed.copy(lying, at);
      patched += 1;
    }
    expect(patched).toBeGreaterThanOrEqual(2);

    await expectPlumsError(core.importPackage(new Uint8Array(lying)), "IMPORT_INVALID");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("lets the host raise or lower the limits in createCore", async () => {
    const small = makeCore({ limits: { maxTotalBytes: 1024, maxFiles: 3, maxPathLength: 20 } });
    expect(small.core.limits).toEqual({ maxTotalBytes: 1024, maxFiles: 3, maxPathLength: 20 });

    await expectPlumsError(
      small.core.importPackage(await manifestZip(validManifest(), [{ name: "a.bin", data: new Uint8Array(2048) }])),
      "IMPORT_INVALID",
    );
    await expectPlumsError(
      small.core.importPackage(
        await manifestZip(validManifest(), [
          { name: "1", data: "x" },
          { name: "2", data: "x" },
          { name: "3", data: "x" },
        ]),
      ),
      "IMPORT_INVALID",
    );
    await expectPlumsError(
      small.core.importPackage(await manifestZip(validManifest(), [{ name: `${"n".repeat(21)}`, data: "x" }])),
      "IMPORT_INVALID",
    );
    expect(listAll(small.dataDir)).toEqual([]);

    const big = makeCore({ limits: { maxTotalBytes: 60 * MB } });
    const zip = await manifestZip(validManifest(), [{ name: "big.bin", data: new Uint8Array(30 * MB) }]);
    await expect(big.core.importPackage(zip)).resolves.toBeDefined();
    await expectPlumsError(makeCore().core.importPackage(zip), "IMPORT_INVALID");
  });

  it("rejects nonsense limits when the core is created", () => {
    expect(() => makeCore({ limits: { maxFiles: 0 } })).toThrow(TypeError);
    expect(() => makeCore({ limits: { maxTotalBytes: 1.5 } })).toThrow(TypeError);
  });
});

describe("errors are PlumsError instances", () => {
  it("never leaks a raw library error", async () => {
    const { core } = makeCore();
    const err = await core.importPackage(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlumsError);
  });
});
