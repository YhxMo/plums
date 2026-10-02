import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  MemorySecretStore,
  PlumsError,
  RecordingEgressSink,
  ScriptedConfirm,
  secretRef,
  type Core,
  type Manifest,
} from "@plums/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectPlumsError, listAll, makeCore, manifestZip, validManifest } from "./package-helpers.js";

const FAKE = "sk-FAKE-0123456789abcdef";
const FAKE_TEAM = 'sk-FAKE-"team"-é\\';
const ID = "demo-ext";
const API = secretRef(ID, "apiKey");
const TEAM = secretRef(ID, "team/token");

function manifestWith(extra: Partial<Manifest> = {}): Manifest {
  return {
    ...validManifest("extension"),
    id: ID,
    dependencies: [],
    permissions: [{ id: "send", level: "egress", target: "api.example.com", reason: "Send." }],
    settingsSchema: {
      type: "object",
      properties: {
        nickname: { type: "string" },
        apiKey: { type: "string", "x-secret": true },
        "team/token": { type: "string", "x-secret": true },
      },
    },
    ...extra,
  };
}

class ThrowingEgress extends RecordingEgressSink {
  override async send(): Promise<never> {
    throw Object.assign(new Error(`upstream rejected ${FAKE}`), { token: FAKE });
  }
}

let output: string[];
let secrets: MemorySecretStore;
let egress: RecordingEgressSink;
let core: Core;
let dataDir: string;

beforeEach(async () => {
  output = [];
  for (const target of [console, process.stdout, process.stderr] as const) {
    for (const method of ["log", "info", "warn", "error", "debug", "write"] as const) {
      if (method in target) {
        vi.spyOn(target as never, method as never).mockImplementation(((...args: unknown[]) => {
          output.push(args.map(String).join(" "));
          return true;
        }) as never);
      }
    }
  }
  secrets = new MemorySecretStore();
  egress = new ThrowingEgress();
  ({ core, dataDir } = makeCore({ secrets, egress, confirm: new ScriptedConfirm([true]) }));
  await core.importPackage(await manifestZip(manifestWith()));
  await secrets.set(API, FAKE);
  await secrets.set(TEAM, FAKE_TEAM);
});

afterEach(() => {
  core.close();
  vi.restoreAllMocks();
});

/** Everything an error shows a caller: message, stack, path, details and the code. */
function show(err: unknown): string {
  const e = err as PlumsError;
  return JSON.stringify([e.name, e.message, e.stack, e.code, e.path, e.details, e.cause]);
}

function expectNoSecret(text: string): void {
  for (const secret of [FAKE, FAKE_TEAM, JSON.stringify(FAKE_TEAM).slice(1, -1)]) {
    expect(text).not.toContain(secret);
  }
}

describe("settings hold secret refs, never secret values", () => {
  it("stores the ref, resolves it to the value, and keeps the value out of every file", async () => {
    await core.setSettings(ID, { nickname: "Pat", apiKey: API, "team/token": TEAM });
    const saved = JSON.parse(readFileSync(path.join(dataDir, "data", ID, "settings.json"), "utf8"));
    expect(saved).toEqual({ nickname: "Pat", apiKey: API, "team/token": TEAM });
    expect(await core.resolveSettings(ID)).toEqual({ nickname: "Pat", apiKey: FAKE, "team/token": FAKE_TEAM });
    for (const file of listAll(dataDir).filter((f) => statSync(path.join(dataDir, f)).isFile())) {
      expectNoSecret(readFileSync(path.join(dataDir, file), "latin1"));
      expectNoSecret(readFileSync(path.join(dataDir, file), "utf8"));
    }
  });

  it("resolves to {} when nothing was saved", async () => {
    expect(await core.resolveSettings(ID)).toEqual({});
  });

  it("refuses an unknown package", async () => {
    await expectPlumsError(core.setSettings("nope", {}), "PERMISSION_DENIED");
  });
});

describe("SECRET_NOT_FOUND", () => {
  const cases: [string, Record<string, unknown>, string, string, string][] = [
    ["a plain secret instead of a ref", { apiKey: FAKE }, "/settings/apiKey", "NOT_A_SECRET_REF", API],
    ["another package's ref", { apiKey: secretRef("other", "apiKey") }, "/settings/apiKey", "NOT_A_SECRET_REF", API],
    ["the ref of another field", { apiKey: TEAM }, "/settings/apiKey", "NOT_A_SECRET_REF", API],
    ["a ref without a stored value", { apiKey: API, "team/token": TEAM }, "/settings/team~1token", "NOT_FOUND", TEAM],
  ];

  it.each(cases)("setSettings with %s writes nothing", async (_name, values, at, reason, ref) => {
    if (reason === "NOT_FOUND") await secrets.delete(TEAM);
    const err = await expectPlumsError(core.setSettings(ID, values), "SECRET_NOT_FOUND", at);
    expect(err.details).toEqual({ id: ID, key: at.slice("/settings/".length).replace("~1", "/"), secretRef: ref, reason });
    expectNoSecret(show(err));
    expect(existsSync(path.join(dataDir, "data", ID, "settings.json"))).toBe(false);
  });

  it("resolveSettings fails once the stored value is gone", async () => {
    await core.setSettings(ID, { apiKey: API });
    await secrets.delete(API);
    await expectPlumsError(core.resolveSettings(ID), "SECRET_NOT_FOUND", "/settings/apiKey");
  });
});

describe("redaction on every exit", () => {
  it("removes secrets from errors, including ones thrown by a collaborator", async () => {
    await core.grantConsent(ID);
    await core.enable(ID);
    const thrown: unknown[] = [];
    const attempts = [
      () => core.runAction({ extensionId: ID, permissionId: "send", request: { url: "https://api.example.com/x" } }),
      () => core.exportPackage({ manifest: manifestWith(), files: { [`../${FAKE}`]: "x" } }),
      () => core.setSettings(ID, { apiKey: FAKE }),
    ];
    for (const attempt of attempts) {
      thrown.push(await attempt().catch((e: unknown) => e));
    }
    expect(thrown.map((e) => e instanceof Error)).toEqual([true, true, true]);
    expect((thrown[0] as Error).message).toContain("[REDACTED]");
    expect((thrown[1] as PlumsError).code).toBe("IMPORT_INVALID");
    for (const err of thrown) expectNoSecret(show(err));
  });

  it("leaves no secret in console or stdout/stderr output", async () => {
    await core.setSettings(ID, { apiKey: API });
    await core.resolveSettings(ID);
    await core.runAction({ extensionId: ID, permissionId: "send", request: { url: "https://api.example.com" } }).catch(() => {});
    await core.uninstall(ID);
    expectNoSecret(output.join("\n"));
  });
});

describe("export", () => {
  it("contains no secret value in the zip or in any file inside it", async () => {
    const bytes = await core.exportPackage({ manifest: manifestWith(), files: { "notes.txt": "hello" } });
    const { manifest, files } = await core.validatePackage(bytes);
    for (const text of [Buffer.from(bytes).toString("latin1"), JSON.stringify(manifest), ...Object.values(files).map((f) => Buffer.from(f).toString("latin1"))]) {
      expectNoSecret(text);
    }
    expect(manifest.settingsSchema?.properties.apiKey).toEqual({ type: "string", "x-secret": true });
  });

  const withLiteral = (keyword: string, value: unknown) =>
    manifestWith({
      settingsSchema: { type: "object", properties: { apiKey: { type: "string", "x-secret": true, [keyword]: value } } },
    });
  const rejected: [string, () => Parameters<Core["exportPackage"]>[0], string, string | undefined][] = [
    ...(["default", "const", "enum", "examples"] as const).map((k) => [
      `an x-secret ${k} written in the manifest`,
      () => ({ manifest: withLiteral(k, k === "enum" || k === "examples" ? ["sk-FAKE-unknown"] : "sk-FAKE-unknown") }),
      "MANIFEST_INVALID",
      `/settingsSchema/properties/apiKey/${k}`,
    ] as [string, () => Parameters<Core["exportPackage"]>[0], string, string]),
    ["a stored secret inside the payload", () => ({ manifest: manifestWith({ payload: { note: `key ${FAKE}` } }) }), "IMPORT_INVALID", undefined],
    ["a stored secret with JSON-escaped characters", () => ({ manifest: manifestWith({ payload: FAKE_TEAM }) }), "IMPORT_INVALID", undefined],
    ["a stored secret inside a file", () => ({ manifest: manifestWith(), files: { "a.txt": `x ${FAKE}` } }), "IMPORT_INVALID", undefined],
    ["a stored secret in a binary file", () => ({ manifest: manifestWith(), files: { "a.bin": Buffer.from(FAKE) } }), "IMPORT_INVALID", undefined],
    ["a stored secret in a file name", () => ({ manifest: manifestWith(), files: { [`${FAKE}.txt`]: "x" } }), "IMPORT_INVALID", undefined],
    ["an x-secret pattern", () => ({ manifest: withLiteral("pattern", "sk-FAKE-unknown") }), "MANIFEST_INVALID", "/settingsSchema/properties/apiKey/pattern"],
    ["an x-secret nested allOf", () => ({ manifest: withLiteral("allOf", [{ const: "sk-FAKE-unknown" }]) }), "MANIFEST_INVALID", "/settingsSchema/properties/apiKey/allOf"],
  ];

  it.each(rejected)("refuses %s", async (_name, input, code, at) => {
    const err = await expectPlumsError(core.exportPackage(input()), code, at);
    expectNoSecret(show(err));
  });

  it("refuses to import a manifest that writes an x-secret value", async () => {
    await expectPlumsError(
      core.importPackage(await manifestZip(withLiteral("default", "sk-FAKE-unknown"))),
      "MANIFEST_INVALID",
      "/settingsSchema/properties/apiKey/default",
    );
  });
});

describe("redaction falls back to the original error", () => {
  it("returns the original error when listing secret values fails", async () => {
    let reads = 0;
    secrets.get = async () => {
      reads += 1;
      throw new Error(`store down ${FAKE}`);
    };
    const err = await expectPlumsError(core.enable(ID), "CONSENT_REQUIRED");
    expect(reads).toBeGreaterThan(0);
    expect(show(err)).not.toContain("store down");
    expect(show(err)).not.toContain(FAKE);
  });
});

describe("update drops secrets for removed keys", () => {
  function without(key: string): Manifest {
    const next = manifestWith({ version: "1.3.0" });
    delete next.settingsSchema?.properties[key];
    return next;
  }

  it("deletes only the values of keys the new version no longer declares", async () => {
    await core.setSettings(ID, { apiKey: API, "team/token": TEAM });
    await core.updatePackage(await manifestZip(without("team/token")));
    expect(await secrets.get(API)).toBe(FAKE);
    expect(await secrets.get(TEAM)).toBeUndefined();
  });

  it("leaves every value when the update is refused", async () => {
    const next = without("apiKey");
    next.permissions = [...next.permissions, { id: "more", level: "read", target: "notes", reason: "More." }];
    await expectPlumsError(core.updatePackage(await manifestZip(next)), "CONSENT_REQUIRED");
    expect(await secrets.get(API)).toBe(FAKE);
    expect(await secrets.get(TEAM)).toBe(FAKE_TEAM);
  });
});

describe("uninstall", () => {
  it("reinstalling the same id starts clean: no old settings, consent or secrets", async () => {
    await core.grantConsent(ID);
    await core.enable(ID);
    await core.setSettings(ID, { nickname: "Pat", apiKey: API, "team/token": TEAM });
    await core.uninstall(ID);

    expect(existsSync(path.join(dataDir, "data", ID))).toBe(false);
    expect([await secrets.get(API), await secrets.get(TEAM)]).toEqual([undefined, undefined]);
    await expectPlumsError(core.getConsent(ID), "PERMISSION_DENIED");

    await core.importPackage(await manifestZip(manifestWith()));
    expect(await core.listInstalled()).toMatchObject([{ id: ID, enabled: false, consented: false }]);
    await expect(core.getConsent(ID)).resolves.toBeNull();
    expect(await core.resolveSettings(ID)).toEqual({});
    expect([await secrets.get(API), await secrets.get(TEAM)]).toEqual([undefined, undefined]);
    await expectPlumsError(core.enable(ID), "CONSENT_REQUIRED");
  });

  it("deletes the package's secret values only, and the package can be set up again", async () => {
    await secrets.set("pkg/token", "unrelated");
    await core.setSettings(ID, { apiKey: API });
    await core.uninstall(ID);
    expect([await secrets.get(API), await secrets.get(TEAM)]).toEqual([undefined, undefined]);
    expect(await secrets.get("pkg/token")).toBe("unrelated");

    await core.importPackage(await manifestZip(manifestWith()));
    expect(await core.resolveSettings(ID)).toEqual({});
    await expectPlumsError(core.setSettings(ID, { apiKey: API }), "SECRET_NOT_FOUND", "/settings/apiKey");
  });
});
