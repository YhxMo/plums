import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MemorySecretStore,
  PlumsError,
  RecordingEgressSink,
  ScriptedConfirm,
  secretRef,
  type Core,
  type Manifest,
} from "@plumsjs/core";
import { describe, expect, it } from "vitest";
import { serializeError } from "./contract-helpers.js";
import {
  expectPlumsError,
  listAll,
  makeCore,
  manifestZip,
  validManifest,
  type ZipSpec,
} from "./package-helpers.js";

/**
 * Regression tests for the review fixes in #20 and #21.
 * Leak checks use the shared serializeError helper, which walks the cause chain,
 * including non-enumerable properties.
 *
 * The same-id burst, A.txt/a.txt, MANIFEST.JSON, and the a-versus-a/b.txt export
 * clash already live in import-export-boundaries.test.ts. This file keeps the boundaries
 * that file does not: in-flight overlap, importFromUrl, Dir/ versus dir/, the
 * Manifest.json/ directory alias, and Dir/x versus dir/x.
 */

const FAKE = "plums-fake-secret-9f3a7c1e-DO-NOT-USE";

function pack(id: string, extra: Partial<Manifest> = {}): Manifest {
  return {
    ...validManifest("extension"),
    id,
    name: id,
    dependencies: [],
    permissions: [],
    ...extra,
  };
}

function ownText(
  files: Record<string, Uint8Array>,
  name: string,
): string | undefined {
  const value = Object.getOwnPropertyDescriptor(files, name)?.value as
    | Uint8Array
    | undefined;
  return value === undefined ? undefined : Buffer.from(value).toString("utf8");
}

function leaked(label: string): Error {
  const cause = new Error(`${label} cause ${FAKE}`);
  const err = new Error(`${label} ${FAKE}`);
  Object.defineProperty(err, "cause", { value: cause, enumerable: false });
  Object.defineProperty(err, "details", {
    value: { secret: FAKE },
    enumerable: false,
  });
  err.stack = `${label} stack ${FAKE}\n    at leaked (${FAKE})`;
  return err;
}

function assertSecretHidden(err: unknown): void {
  expect(err).toBeInstanceOf(PlumsError);
  const plums = err as PlumsError;
  expect(plums.code).toBe("SECRET_NOT_FOUND");
  expect(plums.message).toBe("读取密钥失败，原来的错误已隐藏，以免带出密钥。");
  expect(plums.cause).toBeUndefined();
  expect(plums.details).toBeUndefined();
  expect(plums.path).toBeUndefined();
  expect(serializeError(err)).not.toContain(FAKE);
}

function packageZip(id: string, extra: ZipSpec[] = []): Promise<Uint8Array> {
  return manifestZip(pack(id), extra);
}

async function expectImportRejected(
  zip: Uint8Array,
  entryPath: string,
): Promise<void> {
  const { core, dataDir } = makeCore();
  const err = await expectPlumsError(
    core.importPackage(zip),
    "IMPORT_INVALID",
    entryPath,
  );
  expect(err.message.length).toBeGreaterThan(0);
  expect(listAll(dataDir)).toEqual([]);
  expect(await core.listInstalled()).toEqual([]);
  core.close();
}

async function expectExportRejected(
  files: Record<string, string>,
  needle: string,
): Promise<Core> {
  const { core, dataDir } = makeCore();
  const outPath = path.join(dataDir, "rejected.zip");
  const err = await expectPlumsError(
    core.exportPackage(
      { manifest: pack("test.reg.export"), files },
      { outPath },
    ),
    "IMPORT_INVALID",
  );
  expect(err.message).toContain(needle);
  expect(existsSync(outPath)).toBe(false);
  expect(listAll(dataDir)).toEqual([]);
  return core;
}

const egressManifest = (id: string): Manifest =>
  pack(id, {
    permissions: [
      {
        id: "send",
        level: "egress",
        target: "api.example.com",
        reason: "Send a hook.",
      },
    ],
    settingsSchema: {
      type: "object",
      properties: {
        apiKey: {
          type: "string",
          title: "API key",
          description: "A secret used by the hook.",
          "x-secret": true,
        },
      },
    },
  });

async function actionCore(
  get: MemorySecretStore["get"],
  egressError: unknown,
): Promise<Core> {
  const id = "test.reg.secret";
  const secrets = new MemorySecretStore();
  const egress = new RecordingEgressSink();
  egress.send = async () => {
    throw egressError;
  };
  const { core } = makeCore({
    secrets,
    egress,
    confirm: new ScriptedConfirm([true]),
  });
  await core.importPackage(await manifestZip(egressManifest(id)));
  await secrets.set(secretRef(id, "apiKey"), FAKE);
  await core.grantConsent(id);
  await core.enable(id);
  secrets.get = get;
  return core;
}

async function runSend(core: Core): Promise<unknown> {
  return core
    .runAction({
      extensionId: "test.reg.secret",
      permissionId: "send",
      request: { url: "https://api.example.com/hook" },
    })
    .then(
      () => {
        throw new Error("runAction succeeded");
      },
      (err: unknown) => err,
    );
}

describe("A: secret-store read failure (#20)", () => {
  it("A: SecretStore.get rejects with the secret while egress throws the same secret", async () => {
    const core = await actionCore(async () => {
      throw leaked("get");
    }, leaked("egress"));
    assertSecretHidden(await runSend(core));
    core.close();
  });

  it("A: egress error has no secret, but SecretStore.get still rejects with one", async () => {
    const core = await actionCore(async () => {
      throw leaked("get");
    }, new Error("network down without a secret"));
    assertSecretHidden(await runSend(core));
    core.close();
  });

  it("A: SecretStore.get throws synchronously, not as a rejected promise", async () => {
    const core = await actionCore(() => {
      throw leaked("sync-get");
    }, leaked("egress"));
    assertSecretHidden(await runSend(core));
    core.close();
  });
});

describe("B: case collisions and manifest aliases (#21)", () => {
  it("B: folder entries Dir/ and dir/ are IMPORT_INVALID", async () => {
    await expectImportRejected(
      await packageZip("test.reg.dir", [
        { name: "Dir/", directory: true },
        { name: "dir/", directory: true },
        { name: "Dir/x", data: "one" },
        { name: "dir/y", data: "two" },
      ]),
      "/dir",
    );
  });

  it("B: Manifest.json/ is IMPORT_INVALID and leaves the data dir empty", async () => {
    await expectImportRejected(
      await packageZip("test.reg.aliasdir", [
        { name: "Manifest.json/", directory: true },
      ]),
      "/Manifest.json",
    );
  });

  it("B: export rejects Dir/x versus dir/x, then another export works", async () => {
    const core = await expectExportRejected(
      { "Dir/x": "one", "dir/x": "two" },
      "dir/x",
    );
    const bytes = await core.exportPackage({
      manifest: pack("test.reg.export"),
      files: { "ok.txt": "yes" },
    });
    expect(Buffer.from(bytes.subarray(0, 2)).toString("utf8")).toBe("PK");
    core.close();
  });
});

describe("C: concurrent import of one id (#21)", () => {
  it("C: consent, enabled, and settings survive when a second same-id import is in flight", async () => {
    const id = "test.reg.overlap";
    const manifest = pack(id);
    const fast = await manifestZip(manifest, [
      { name: "note.txt", data: "fast" },
    ]);
    const slow = await manifestZip(manifest, [
      { name: "blob.bin", data: Buffer.alloc(16 * 1024 * 1024, 7) },
    ]);
    const { core, dataDir } = makeCore();
    const settings = path.join(dataDir, "data", id, "settings.json");
    const marker = `{"kept":"${id}"}\n`;

    const slowImport = core.importPackage(slow);
    await waitForStaging(dataDir);
    const fastImport = core.importPackage(fast);
    const fastResult = await fastImport.then(
      () => "ok" as const,
      (err: unknown) => err,
    );
    await core.grantConsent(id);
    await core.enable(id);
    await mkdir(path.dirname(settings), { recursive: true });
    await writeFile(settings, marker);
    const slowResult = await slowImport.then(
      () => "ok" as const,
      (err: unknown) => err,
    );

    const results = [fastResult, slowResult];
    expect(results.filter((item) => item === "ok")).toHaveLength(1);
    for (const err of results) {
      if (err === "ok") continue;
      expect(err).toBeInstanceOf(PlumsError);
      const plums = err as PlumsError;
      expect(plums.code).toBe("IMPORT_INVALID");
      expect(plums.details).toEqual({ id, reason: "ALREADY_INSTALLED" });
      const text = `${plums.message}\n${serializeError(err)}`;
      expect(text).not.toContain("ENOTEMPTY");
      expect(text).not.toContain("SQLITE");
    }
    expect(await core.getConsent(id)).not.toBeNull();
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id, enabled: true, consented: true }),
    ]);
    expect(readFileSync(settings, "utf8")).toBe(marker);
    core.close();
  });
});

describe("D: __proto__ file name round trip (#21)", () => {
  it("D: __proto__, constructor, and toString survive export, import, share, validate, and importFromUrl", async () => {
    const id = "test.reg.proto";
    const manifest = pack(id);
    const files = Object.create(null) as Record<string, Uint8Array>;
    files["__proto__"] = Buffer.from("proto-body");
    files.constructor = Buffer.from("ctor-body");
    files.toString = Buffer.from("string-body");

    const { core, dataDir } = makeCore();
    const exported = await core.exportPackage({ manifest, files });
    const imported = await core.importPackage(exported);
    expectSameFiles(imported.files);

    const shared = await core.shareToFile(id, path.join(dataDir, "shared.zip"));
    const validated = await core.validatePackage(shared);
    expectSameFiles(validated.files);

    const again = await makeCore();
    expectSameFiles((await again.core.importPackage(shared)).files);
    again.core.close();

    const body = Buffer.from(shared).toString("latin1");
    const egress = new RecordingEgressSink({}, { status: 200, body });
    const fromUrl = makeCore({ egress, confirm: new ScriptedConfirm([true]) });
    expectSameFiles(
      (await fromUrl.core.importFromUrl("https://share.example/pkg.zip")).files,
    );
    fromUrl.core.close();
    core.close();
  });
});

function expectSameFiles(files: Record<string, Uint8Array>): void {
  expect(Object.getOwnPropertyNames(files).sort()).toEqual([
    "__proto__",
    "constructor",
    "toString",
  ]);
  expect(ownText(files, "__proto__")).toBe("proto-body");
  expect(ownText(files, "constructor")).toBe("ctor-body");
  expect(ownText(files, "toString")).toBe("string-body");
}

async function waitForStaging(dataDir: string): Promise<void> {
  const root = path.join(dataDir, "packages");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // `.staging-*` is the prefix install.ts passes to mkdtemp. If it never appears this throws, so a slow machine can time out but cannot pass.
    if (
      existsSync(root) &&
      readdirSync(root).some((name) => name.startsWith(".staging-"))
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("staging directory did not appear");
}
