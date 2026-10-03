import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  MAX_SHARE_BYTES,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  secretRef,
  type EgressRequest,
  type EgressResult,
} from "@plums/core";
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

const TOKEN = "sekret";
const PAGE = "https://share.example/pkg.zip";
const WITH_SECRET = `${PAGE}?token=${TOKEN}#frag`;
const CONFIRM_REASON = "下载别人分享的包";

function expectPlainCopy(message: string): void {
  expect(message).not.toContain("://");
  expect(message).not.toContain(TOKEN);
  expect(message).not.toContain("pkg.zip");
  expect(message.replace(/允许吗\?$/, "")).not.toContain("?");
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function asText(files: Record<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, Buffer.from(data).toString("latin1")]));
}

function diskFiles(dir: string): Record<string, string> {
  return Object.fromEntries(
    listAll(dir)
      .filter((name) => statSync(path.join(dir, name)).isFile())
      .map((name) => [name, readFileSync(path.join(dir, name)).toString("latin1")]),
  );
}

class ConfirmBeforeSend extends RecordingEgressSink {
  constructor(
    private readonly confirm: ScriptedConfirm,
    body: string,
    status: number,
  ) {
    super({}, { body, status });
  }

  override async send(req: EgressRequest): Promise<EgressResult> {
    expect(this.confirm.asked).toHaveLength(1);
    return super.send(req);
  }
}

async function attempt(
  response: { status?: number; body?: string; error?: unknown } = {},
  redirects: Record<number, string> = {},
  answers: boolean[] = [true],
) {
  const confirm = new ScriptedConfirm(answers);
  const egress = new RecordingEgressSink(redirects, response);
  const made = makeCore({ egress, confirm });
  return { ...made, egress, confirm };
}

describe("shareToFile", () => {
  it("refuses an id that is not installed and writes no file", async () => {
    const { core, dataDir } = makeCore();
    const out = path.join(dataDir, "missing.zip");
    const err = await expectPlumsError(core.shareToFile("missing", out), "PERMISSION_DENIED");
    expect(err.details).toEqual({ id: "missing", reason: "NOT_INSTALLED" });
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a package that contains a stored secret and writes no file", async () => {
    const secrets = new MemorySecretStore();
    const { core, dataDir } = makeCore({ secrets });
    const secret = "sk-FAKE-share-value";
    const manifest = {
      ...validManifest("extension"),
      settingsSchema: {
        type: "object" as const,
        properties: {
          apiKey: { type: "string" as const, title: "API key", description: "Secret key.", "x-secret": true },
        },
      },
    };
    await core.importPackage(await manifestZip(manifest, [{ name: "notes.txt", data: `see ${secret}` }]));
    await secrets.set(secretRef(manifest.id, "apiKey"), secret);
    await core.setSettings(manifest.id, { apiKey: secretRef(manifest.id, "apiKey") });
    const out = path.join(dataDir, "out.zip");
    const err = await expectPlumsError(core.shareToFile(manifest.id, out), "IMPORT_INVALID");
    expect(existsSync(out)).toBe(false);
    expect(JSON.stringify(err)).not.toContain(secret);
  });
});

describe("acceptance: a link import matches a file import", () => {
  it("asks before downloading, then imports the same disabled package", async () => {
    const manifest = validManifest("extension");
    const binary = new Uint8Array([0, 255, 1, 254, 2]);
    const source = makeCore();
    await source.core.importPackage(
      await manifestZip(manifest, [
        { name: "assets/icon.txt", data: "icon" },
        { name: "data/blob.bin", data: binary },
      ]),
    );
    await source.core.grantConsent(manifest.id);
    const out = path.join(source.dataDir, "shared.zip");
    const shared = await source.core.shareToFile(manifest.id, out);
    expect(Buffer.from(readFileSync(out)).equals(Buffer.from(shared))).toBe(true);

    const fileSide = makeCore();
    const fromFile = await fileSide.core.importPackage(out);

    const url = "https://share.example:8443/pkg.zip?token=sekret#frag";
    const confirm = new ScriptedConfirm([true]);
    const egress = new ConfirmBeforeSend(confirm, latin1(shared), 201);
    const urlSide = makeCore({ egress, confirm });
    const fromUrl = await urlSide.core.importFromUrl(url);

    expect(fromUrl.manifest).toEqual(fromFile.manifest);
    expect(fromUrl.manifest).toEqual(manifest);
    expect(asText(fromUrl.files)).toEqual(asText(fromFile.files));
    expect(asText(fromUrl.files)).toEqual({ "assets/icon.txt": "icon", "data/blob.bin": latin1(binary) });
    expect(diskFiles(fromUrl.installDir)).toEqual(diskFiles(fromFile.installDir));
    expect(fromUrl.installDir).toBe(path.join(urlSide.dataDir, "packages", manifest.id));
    expect(await source.core.getConsent(manifest.id)).not.toBeNull();
    for (const core of [fileSide.core, urlSide.core]) {
      expect(await core.getConsent(manifest.id)).toBeNull();
      expect(await core.listInstalled()).toEqual([
        expect.objectContaining({ id: manifest.id, enabled: false, consented: false, enabledAt: null }),
      ]);
    }
    expect(confirm.asked).toEqual([
      expect.objectContaining({ host: "share.example:8443", reason: CONFIRM_REASON }),
    ]);
    expect(confirm.asked[0]?.message).toBe(
      "要从 share.example:8443 下载别人分享的包。原因:下载别人分享的包。允许吗?",
    );
    expectPlainCopy(confirm.asked[0]?.message ?? "");
    expect(egress.records).toEqual([{ url: new URL(url).href, method: "GET" }]);
    expect(listAll(urlSide.dataDir).some((name) => name.includes(".staging-"))).toBe(false);
  });
});

describe("importFromUrl confirmation", () => {
  it.each([
    ["answers false", [false]],
    ["has no answer left", []],
  ] as const)("%s", async (_name, answers) => {
    const { core, dataDir, egress, confirm } = await attempt(
      { body: latin1(await manifestZip(validManifest())) },
      {},
      [...answers],
    );
    const err = await expectPlumsError(core.importFromUrl(WITH_SECRET), "CONFIRMATION_DENIED", "/url");
    expect(err.details).toEqual({ url: PAGE });
    expectPlainCopy(err.message);
    expect(JSON.stringify(err.details)).not.toContain(TOKEN);
    expect(confirm.asked).toEqual([expect.objectContaining({ host: "share.example", reason: CONFIRM_REASON })]);
    expect(confirm.asked[0]?.message).toBe("要从 share.example 下载别人分享的包。原因:下载别人分享的包。允许吗?");
    expectPlainCopy(confirm.asked[0]?.message ?? "");
    expect(egress.records).toEqual([]);
    expect(listAll(dataDir)).toEqual([]);
  });

  it.each([
    ["throws", (confirm: ScriptedConfirm) => {
      confirm.ask = () => Promise.reject(new Error("no handler"));
    }],
    ["is missing", (confirm: ScriptedConfirm) => {
      (confirm as { ask?: unknown }).ask = undefined;
    }],
  ])("ask %s", async (_name, breakAsk) => {
    const { core, dataDir, egress, confirm } = await attempt({ body: latin1(await manifestZip(validManifest())) });
    breakAsk(confirm);
    await expectPlumsError(core.importFromUrl(PAGE), "CONFIRMATION_DENIED", "/url");
    expect(egress.records).toEqual([]);
    expect(listAll(dataDir)).toEqual([]);
  });
});

describe("importFromUrl download failures", () => {
  it.each([
    ["http", `http://share.example/pkg.zip?token=${TOKEN}`, "NOT_HTTPS", "http://share.example/pkg.zip", "分享链接必须是 https。"],
    ["userinfo", `https://user:${TOKEN}@share.example/pkg.zip?token=${TOKEN}#frag`, "USERINFO", PAGE, "分享链接里不能写账号或密码。"],
    ["ipv4", `https://1.2.3.4/pkg.zip?token=${TOKEN}`, "IP_LITERAL", "https://1.2.3.4/pkg.zip", "分享链接不能用 IP 地址。"],
    ["ipv6", `https://[2001:db8::1]/pkg.zip?token=${TOKEN}`, "IP_LITERAL", "https://[2001:db8::1]/pkg.zip", "分享链接不能用 IP 地址。"],
    ["localhost", `https://LOCALHOST/pkg.zip?token=${TOKEN}`, "LOCALHOST", "https://localhost/pkg.zip", "分享链接不能用 localhost。"],
    ["mixed-case localhost", "https://LocalHost/x", "LOCALHOST", "https://localhost/x", "分享链接不能用 localhost。"],
    ["a localhost subdomain", `https://Foo.localhost/pkg.zip?token=${TOKEN}`, "LOCALHOST", "https://foo.localhost/pkg.zip", "分享链接不能用 localhost。"],
    ["localhost with a trailing dot", "https://localhost./x", "TRAILING_DOT", "https://localhost./x", "主机名不能以点结尾。"],
    ["a localhost subdomain with a trailing dot", "https://a.localhost./x", "TRAILING_DOT", "https://a.localhost./x", "主机名不能以点结尾。"],
    ["a normal host with a trailing dot", "https://share.example./p.zip", "TRAILING_DOT", "https://share.example./p.zip", "主机名不能以点结尾。"],
    ["unparsed", `not a url?token=${TOKEN}`, "INVALID_URL", "not a url", "这个分享链接不是有效的网址。"],
  ])("%s never asks and never sends", async (_name, url, reason, shown, message) => {
    const { core, dataDir, egress, confirm } = await attempt({ body: latin1(await manifestZip(validManifest())) });
    const err = await expectPlumsError(core.importFromUrl(url), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: shown, reason });
    expect(err.message).toBe(message);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(confirm.asked).toEqual([]);
    expect(egress.records).toEqual([]);
    expect(listAll(dataDir)).toEqual([]);
  });

  it("reports a network error without the sink message and writes nothing", async () => {
    const raw = `HTTPS://Share.Example/pkg.zip?token=${TOKEN}#frag`;
    const { core, dataDir, egress, confirm } = await attempt({ error: new Error(`offline ${TOKEN}`) });
    const err = await expectPlumsError(core.importFromUrl(raw), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "NETWORK" });
    expect(err.message).not.toContain("offline");
    expectPlainCopy(err.message);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(confirm.asked[0]).toMatchObject({ host: "share.example", reason: CONFIRM_REASON });
    expect(egress.records).toEqual([{ url: new URL(raw).href, method: "GET" }]);
    expect(egress.records[0]?.url).toContain("#frag");
    expect(egress.records[0]?.url).not.toBe(raw);
    expect(listAll(dataDir)).toEqual([]);
  });

  it.each([199, 300, 404])("HTTP %s does not import a zip body", async (status) => {
    const { core, dataDir, confirm } = await attempt({
      status,
      body: latin1(await manifestZip(validManifest())),
    });
    const err = await expectPlumsError(core.importFromUrl(WITH_SECRET), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "HTTP_STATUS" });
    expect(err.message).toContain(`HTTP ${status}`);
    expect(confirm.asked).toHaveLength(1);
    expect(listAll(dataDir)).toEqual([]);
  });

  it("rejects a body over the size cap before treating it as a zip", async () => {
    const { core, dataDir } = await attempt({ body: "x".repeat(MAX_SHARE_BYTES + 1) });
    const err = await expectPlumsError(core.importFromUrl(PAGE), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "TOO_LARGE" });
    expect(listAll(dataDir)).toEqual([]);
  });

  it("rejects a data byte widened above 0xFF and imports the same zip without it", async () => {
    const marker = "ZZDATA";
    const zip = latin1(await manifestZip(validManifest(), [{ name: "note.txt", data: marker, store: true }]));
    const at = zip.indexOf(marker);
    expect(at).toBeGreaterThan(3);
    expect(zip.startsWith("PK\x03\x04")).toBe(true);
    const widened = `${zip.slice(0, at)}${String.fromCharCode(zip.charCodeAt(at) + 0x100)}${zip.slice(at + 1)}`;

    const ok = await attempt({ body: zip });
    const imported = await ok.core.importFromUrl(PAGE);
    expect(imported.manifest.id).toBe("demo-character");
    expect(Buffer.from(imported.files["note.txt"]!).toString("latin1")).toBe(marker);

    const bad = await attempt({ body: widened });
    const err = await expectPlumsError(bad.core.importFromUrl(PAGE), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "NOT_A_ZIP" });
    expect(listAll(bad.dataDir)).toEqual([]);
  });

  it("rejects a response that is not a zip", async () => {
    const { core, dataDir, confirm } = await attempt({ body: "hello" });
    const err = await expectPlumsError(core.importFromUrl(WITH_SECRET), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "NOT_A_ZIP" });
    expectPlainCopy(err.message);
    expectPlainCopy(confirm.asked[0]?.message ?? "");
    expect(listAll(dataDir)).toEqual([]);
  });

  it("stops when the sink reports a redirect and does not send again", async () => {
    const { core, dataDir, egress, confirm } = await attempt(
      { body: latin1(await manifestZip(validManifest())) },
      { 1: `https://cdn.example/pkg.zip?token=${TOKEN}` },
    );
    const err = await expectPlumsError(core.importFromUrl(WITH_SECRET), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "REDIRECT" });
    expect(egress.records[0]?.url).toContain("#frag");
    expectPlainCopy(err.message);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(egress.records).toEqual([{ url: new URL(WITH_SECRET).href, method: "GET" }]);
    expect(confirm.asked).toHaveLength(1);
    expectPlainCopy(confirm.asked[0]?.message ?? "");
    expect(listAll(dataDir)).toEqual([]);
  });
});

describe("importFromUrl package errors", () => {
  it.each([
    ["a bad manifest", () => manifestZip({ ...validManifest(), version: "one" }), "MANIFEST_INVALID", "/version"],
    ["an unsupported format", () => manifestZip({ formatVersion: "3.0", somethingNew: true }), "FORMAT_UNSUPPORTED", "/formatVersion"],
    ["no manifest", () => buildZip([{ name: "readme.txt", data: "hi" }]), "IMPORT_INVALID", undefined],
    [
      "a path that escapes",
      async () => renameEntry(await manifestZip(validManifest(), [{ name: "ab/evil.txt", data: "x" }]), "ab/evil.txt", "../evil.txt"),
      "IMPORT_INVALID",
      undefined,
    ],
    ["a truncated zip that still has a zip header", async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]), "IMPORT_INVALID", undefined],
  ] as const)("keeps %s from importPackage", async (_name, zip, code, at) => {
    const { core, dataDir, confirm } = await attempt({ body: latin1(await zip()) });
    const err = await expectPlumsError(core.importFromUrl(PAGE), code, at);
    expect(err.code).not.toBe("SHARE_FETCH_FAILED");
    expect(confirm.asked).toHaveLength(1);
    expect(listAll(dataDir)).toEqual([]);
  });
});

describe("importFromUrl of an installed id", () => {
  it("refuses an id that is already installed, then accepts it after uninstall", async () => {
    const firstZip = await manifestZip(validManifest(), [{ name: "old.txt", data: "old" }]);
    const second = await manifestZip({ ...validManifest(), version: "2.0.0" }, [{ name: "new.txt", data: "new" }]);
    const secrets = new MemorySecretStore();
    const confirm = new ScriptedConfirm([true, true]);
    const egress = new RecordingEgressSink({}, { body: latin1(second) });
    const { core, dataDir } = makeCore({ egress, confirm, secrets });
    const first = await core.importPackage(firstZip);
    await secrets.set(secretRef("demo-character", "token"), "sk-kept");
    await core.setSettings("demo-character", { nickname: "Pat" });
    const settingsPath = path.join(dataDir, "data", "demo-character", "settings.json");
    const settingsBefore = readFileSync(settingsPath, "utf8");

    const err = await expectPlumsError(core.importFromUrl(WITH_SECRET), "IMPORT_INVALID");
    expect(err.details).toEqual({ id: "demo-character", reason: "ALREADY_INSTALLED" });
    expect(listAll(first.installDir)).toEqual(["manifest.json", "old.txt"]);
    expect(readFileSync(settingsPath, "utf8")).toBe(settingsBefore);
    expect(await secrets.get(secretRef("demo-character", "token"))).toBe("sk-kept");
    expect(readFileSync(path.join(first.installDir, "old.txt"), "utf8")).toBe("old");
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: "demo-character", version: "1.2.3", enabled: false, consented: false }),
    ]);
    expect(confirm.asked).toHaveLength(1);
    expect(egress.records).toEqual([{ url: new URL(WITH_SECRET).href, method: "GET" }]);

    await core.uninstall("demo-character");
    const again = await core.importFromUrl(PAGE);
    expect(again.manifest.version).toBe("2.0.0");
    expect(listAll(again.installDir)).toEqual(["manifest.json", "new.txt"]);
    expect(await core.getConsent("demo-character")).toBeNull();
    expect(await core.listInstalled()).toEqual([
      expect.objectContaining({ id: "demo-character", version: "2.0.0", enabled: false, consented: false }),
    ]);
  });
});

describe("localhost is a string check", () => {
  it("still downloads a host that only contains the word localhost", async () => {
    const { core, egress, confirm } = await attempt({ body: latin1(await manifestZip(validManifest())) });
    const imported = await core.importFromUrl("https://localhost.example/pkg.zip");
    expect(imported.manifest.id).toBe("demo-character");
    expect(confirm.asked[0]).toMatchObject({ host: "localhost.example", reason: CONFIRM_REASON });
    expect(egress.records).toEqual([{ url: "https://localhost.example/pkg.zip", method: "GET" }]);
  });
});
