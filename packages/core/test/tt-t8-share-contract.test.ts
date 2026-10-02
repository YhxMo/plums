import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_SHARE_BYTES,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  secretRef,
  type Confirm,
  type EgressRequest,
  type EgressResult,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import { expectPlumsError, listAll, makeCore, manifestZip, validManifest } from "./package-helpers.js";

/**
 * Share and URL import contract.
 * 基线不同、故意自包含、故意绕过 API。
 * The other test PRs sit on different baselines, so this file keeps its own world()
 * and does not import their helpers. Leak checks use the local serializeError, which
 * walks the whole cause chain, including non-enumerable error properties.
 * @plums/core does not export that function. One case clears confirm.ask after createCore.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "packages");
const fixturePath = (rel: string) => path.join(FIXTURES, rel);
const fixtureBytes = (rel: string) => new Uint8Array(readFileSync(fixturePath(rel)));
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

const FAKE = "plums-fake-secret-9f3a7c1e-DO-NOT-USE";
const PAGE = "https://share.example/pkg.zip";
const REASON = "下载别人分享的包";
const TOKEN = "xxx";
const PASSWORD = "hunter2";

interface WorldOptions {
  response?: { status?: number; body?: string; error?: unknown };
  redirects?: Record<number, string>;
  answers?: boolean[];
  confirm?: Confirm;
}

const open: ReturnType<typeof makeCore>[] = [];
afterEach(() => {
  for (const { core, dataDir } of open.splice(0)) {
    core.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function world(options: WorldOptions = {}) {
  const egress = new RecordingEgressSink(options.redirects, options.response);
  const confirm = new ScriptedConfirm(options.answers ?? [true]);
  const secrets = new MemorySecretStore();
  const made = makeCore({ egress, confirm: options.confirm ?? confirm, secrets });
  open.push(made);
  return { ...made, egress, confirm, secrets };
}

/** A world whose link answers with the bytes of `rel` (or of the given zip). */
function serving(zip: Uint8Array, options: WorldOptions = {}) {
  return world({ ...options, response: { body: latin1(zip), ...options.response } });
}

/** Nothing was written to the data directory and nothing is installed. */
async function expectUntouched(w: ReturnType<typeof world>): Promise<void> {
  expect(listAll(w.dataDir)).toEqual([]);
  expect(await w.core.listInstalled()).toEqual([]);
}

function diskFiles(dir: string): Record<string, string> {
  return Object.fromEntries(
    listAll(dir)
      .filter((name) => statSync(path.join(dir, name)).isFile())
      .map((name) => [name, readFileSync(path.join(dir, name)).toString("latin1")]),
  );
}

/** Everything an error shows a caller, including the whole `cause` chain. `JSON.stringify` on an Error is `{}`, so a secret sitting only in `cause` would otherwise slip past. */
function serializeError(err: unknown, seen = new WeakSet<object>()): string {
  if (err === null || typeof err !== "object") return JSON.stringify(err) ?? String(err);
  if (seen.has(err)) return "[circular]";
  seen.add(err);
  if (err instanceof Error) {
    const own = Object.fromEntries(Object.getOwnPropertyNames(err).map((key) => [key, (err as never)[key]]));
    return JSON.stringify({
      ...Object.fromEntries(Object.entries(own).map(([key, value]) => [key, serializeError(value, seen)])),
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause: err.cause === undefined ? undefined : serializeError(err.cause, seen),
    });
  }
  return JSON.stringify(err, (_key, value: unknown) => (value instanceof Error ? serializeError(value, seen) : value));
}

/** Every byte value, so a text round trip that is not latin1 would corrupt it. */
const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, i) => i);

describe("shareToFile", () => {
  it("writes the file, returns the same bytes, and equals exportPackage of the installed package", async () => {
    const w = world();
    const manifest = validManifest("extension");
    await w.core.importPackage(
      await manifestZip(manifest, [
        { name: "assets/icon.txt", data: "icon" },
        { name: "data/all-bytes.bin", data: ALL_BYTES },
      ]),
    );
    const out = path.join(w.dataDir, "shared.zip");
    const bytes = await w.core.shareToFile(manifest.id, out);

    expect(Buffer.from(readFileSync(out)).equals(Buffer.from(bytes))).toBe(true);
    const { manifest: back, files } = await w.core.validatePackage(bytes);
    expect(back).toEqual(manifest);
    expect(Object.keys(files).sort()).toEqual(["assets/icon.txt", "data/all-bytes.bin"]);
    expect(Buffer.from(files["data/all-bytes.bin"]!).equals(Buffer.from(ALL_BYTES))).toBe(true);
    expect(Buffer.from(await w.core.exportPackage({ manifest, files }))).toEqual(Buffer.from(bytes));
  });

  it("refuses an id that is not installed: PERMISSION_DENIED / NOT_INSTALLED, no file", async () => {
    const w = world();
    const out = path.join(w.dataDir, "missing.zip");
    const err = await expectPlumsError(w.core.shareToFile("nope", out), "PERMISSION_DENIED");
    expect(err.details).toEqual({ id: "nope", reason: "NOT_INSTALLED" });
    expect(existsSync(out)).toBe(false);
    expect(listAll(w.dataDir).filter((name) => !name.startsWith("plums.db"))).toEqual([]);
  });

  it("refuses an uninstalled package too", async () => {
    const w = world();
    const manifest = validManifest("extension");
    await w.core.importPackage(await manifestZip(manifest));
    await w.core.uninstall(manifest.id);
    const out = path.join(w.dataDir, "gone.zip");
    await expectPlumsError(w.core.shareToFile(manifest.id, out), "PERMISSION_DENIED");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a package that holds a stored secret: IMPORT_INVALID, no file, no secret in the error", async () => {
    const w = world();
    const id = (await w.core.importPackage(fixturePath("secret/package-with-fake-secret-in-settings.zip"))).manifest.id;
    const out = path.join(w.dataDir, "leak.zip");
    await w.core.shareToFile(id, out);
    rmSync(out);

    await w.secrets.set(secretRef(id, "apiKey"), FAKE);
    const err = await expectPlumsError(w.core.shareToFile(id, out), "IMPORT_INVALID");
    expect(existsSync(out)).toBe(false);
    expect(serializeError(err)).not.toContain(FAKE);
  });

  it("shares a package whose secret field holds only a ref", async () => {
    const w = world();
    const id = (await w.core.importPackage(fixturePath("secret/package-with-secretref.zip"))).manifest.id;
    await w.secrets.set(secretRef(id, "apiKey"), FAKE);
    await w.core.setSettings(id, { apiKey: secretRef(id, "apiKey") });
    const bytes = await w.core.shareToFile(id, path.join(w.dataDir, "ok.zip"));
    expect(Buffer.from(bytes).toString("latin1")).not.toContain(FAKE);
    expect(JSON.stringify((await w.core.validatePackage(bytes)).manifest)).not.toContain(FAKE);
  });
});

describe("importFromUrl: a good link", () => {
  it("needs consent before it can be enabled", async () => {
    const w = serving(fixtureBytes("valid/extension-3-levels.zip"));
    await w.core.importFromUrl(PAGE);
    await expectPlumsError(w.core.enable("test.ext.perms"), "CONSENT_REQUIRED");
  });

  it("accepts any 2xx status", async () => {
    for (const status of [200, 201, 204, 299]) {
      await serving(fixtureBytes("valid/character-min.zip"), { response: { status } }).core.importFromUrl(PAGE);
    }
  });

  it("sends exactly one GET of the normalized URL", async () => {
    const w = serving(fixtureBytes("valid/character-min.zip"));
    await w.core.importFromUrl("https://Share.Example:443/p.zip?x=1");
    expect(w.egress.records).toEqual([{ url: "https://share.example/p.zip?x=1", method: "GET" }]);
  });

  it("a host that ends in a dot is TRAILING_DOT before localhost, confirm, and egress", async () => {
    for (const url of ["https://localhost./x?token=sekret#frag", "https://a.localhost./pkg.zip#frag", "https://share.example./p.zip?x=1#frag"]) {
      const w = world({ response: { body: "PK\x03\x04" } });
      const err = await expectPlumsError(w.core.importFromUrl(url), "SHARE_FETCH_FAILED", "/url");
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      expect(err.details).toEqual({ url: parsed.href, reason: "TRAILING_DOT" });
      expect(err.message).toContain("主机名不能以点结尾");
      expect(String((err.details as { url: string }).url)).not.toContain("#frag");
      expect(w.confirm.asked).toEqual([]);
      expect(w.egress.records).toEqual([]);
      await expectUntouched(w);
    }
  });

  it("an id that is already installed is IMPORT_INVALID / ALREADY_INSTALLED and stays enabled", async () => {
    const w = serving(fixtureBytes("valid/extension-3-levels.zip"), { answers: [true, true] });
    await w.core.importFromUrl(PAGE);
    await w.core.grantConsent("test.ext.perms");
    await w.core.enable("test.ext.perms");
    const id = "test.ext.perms";
    await w.secrets.set(secretRef(id, "apiKey"), FAKE);
    await w.secrets.set("other/key", "stay");
    const data = path.join(w.dataDir, "data", id);
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, "settings.json"), '{"note":"keep"}');
    const dir = path.join(w.dataDir, "packages", id);
    const before = diskFiles(dir);
    const dataBefore = diskFiles(data);
    const err = await expectPlumsError(w.core.importFromUrl(PAGE), "IMPORT_INVALID");
    expect(err.details).toEqual({ id, reason: "ALREADY_INSTALLED" });
    expect(await w.core.listInstalled()).toMatchObject([{ id, enabled: true, consented: true }]);
    expect(await w.core.getConsent(id)).not.toBeNull();
    expect(diskFiles(dir)).toEqual(before);
    expect(diskFiles(data)).toEqual(dataBefore);
    expect(await w.secrets.get(secretRef(id, "apiKey"))).toBe(FAKE);
    expect(await w.secrets.get("other/key")).toBe("stay");
    expect(w.egress.records).toHaveLength(2);
  });

  it("after uninstall the same link imports as a fresh package", async () => {
    const w = serving(fixtureBytes("valid/extension-3-levels.zip"), { answers: [true, true] });
    const id = "test.ext.perms";
    await w.core.importFromUrl(PAGE);
    await w.core.grantConsent(id);
    await w.core.enable(id);
    await w.core.uninstall(id);
    expect(await w.core.listInstalled()).toEqual([]);
    await w.core.importFromUrl(PAGE);
    expect(await w.core.listInstalled()).toMatchObject([{ id, enabled: false, consented: false }]);
    expect(await w.core.getConsent(id)).toBeNull();
    await expectPlumsError(w.core.enable(id), "CONSENT_REQUIRED");
  });
});

describe("importFromUrl: confirmation", () => {
  const hosts: [string, string][] = [
    [PAGE, "share.example"],
    ["https://share.example:8443/pkg.zip?token=xxx", "share.example:8443"],
    ["https://share.example:443/pkg.zip", "share.example"],
    ["https://Share.Example/pkg.zip", "share.example"],
    ["https://cdn.share.example/a/b/pkg.zip#frag", "cdn.share.example"],
  ];

  it("asks once, before downloading, with host and reason", async () => {
    for (const [url, host] of hosts) {
      const order: string[] = [];
      const asked: Parameters<Confirm["ask"]>[0][] = [];
      const confirm: Confirm = {
        ask: async (req) => {
          order.push("ask");
          asked.push(req);
          return true;
        },
      };
      class Tracing extends RecordingEgressSink {
        override async send(req: EgressRequest): Promise<EgressResult> {
          order.push("send");
          return super.send(req);
        }
      }
      const egress = new Tracing({}, { body: latin1(fixtureBytes("valid/character-min.zip")) });
      const made = makeCore({ egress, confirm });
      open.push(made);
      await made.core.importFromUrl(url);

      expect(order).toEqual(["ask", "send"]);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ host, reason: REASON });
      const message = asked[0]!.message;
      expect(message).toContain(host);
      for (const hidden of ["://", "pkg.zip", TOKEN, "frag"]) expect(message).not.toContain(hidden);
    }
  });

  const refusals: [string, () => Confirm | undefined, boolean[] | undefined][] = [
    ["answers false", () => undefined, [false]],
    ["has no scripted answer", () => undefined, []],
    ["answers the string true", () => ({ ask: async () => "true" as never }), undefined],
    ["answers 1", () => ({ ask: async () => 1 as never }), undefined],
    ["answers nothing", () => ({ ask: async () => undefined as never }), undefined],
    ["rejects", () => ({ ask: () => Promise.reject(new Error(`boom ${TOKEN}`)) }), undefined],
    ["throws synchronously", () => ({ ask: () => { throw new Error(`boom ${TOKEN}`); } }), undefined],
  ];

  it("anything other than true is CONFIRMATION_DENIED at /url, with no send and no file", async () => {
    for (const [, make, answers] of refusals) {
      const w = serving(fixtureBytes("valid/character-min.zip"), { answers, confirm: make() });
      const err = await expectPlumsError(
        w.core.importFromUrl(`${PAGE}?token=${TOKEN}#frag`),
        "CONFIRMATION_DENIED",
        "/url",
      );
      expect(err.details).toEqual({ url: PAGE });
      expect(String((err.details as { url: string }).url)).not.toContain("#frag");
      expect(serializeError(err)).not.toContain(TOKEN);
      expect(w.egress.records).toEqual([]);
      await expectUntouched(w);
    }
  });
});

describe("importFromUrl: a confirm that lost its ask after createCore", () => {
  it("is CONFIRMATION_DENIED at /url, with no send", async () => {
    const w = serving(fixtureBytes("valid/character-min.zip"));
    (w.confirm as { ask?: unknown }).ask = undefined;
    await expectPlumsError(w.core.importFromUrl(PAGE), "CONFIRMATION_DENIED", "/url");
    expect(w.egress.records).toEqual([]);
    await expectUntouched(w);
  });
});

describe("importFromUrl: SHARE_FETCH_FAILED", () => {
  const goodZip = () => latin1(fixtureBytes("valid/character-min.zip"));
  const secretUrl = (scheme = "https", host = "share.example") => `${scheme}://${host}/pkg.zip?token=${TOKEN}#frag`;

  interface Case {
    reason: string;
    url: string;
    shown: string;
    response?: WorldOptions["response"];
    redirects?: Record<number, string>;
    /** Asked before the download? Rejected links never ask. */
    asked: 0 | 1;
  }
  const cases: Case[] = [
    { reason: "INVALID_URL", url: `not a url?token=${TOKEN}`, shown: "not a url", asked: 0 },
    { reason: "INVALID_URL", url: `//share.example/pkg.zip?token=${TOKEN}`, shown: "//share.example/pkg.zip", asked: 0 },
    { reason: "NOT_HTTPS", url: secretUrl("http"), shown: "http://share.example/pkg.zip", asked: 0 },
    { reason: "NOT_HTTPS", url: secretUrl("ftp"), shown: "ftp://share.example/pkg.zip", asked: 0 },
    { reason: "NOT_HTTPS", url: `http://1.2.3.4/pkg.zip?token=${TOKEN}`, shown: "http://1.2.3.4/pkg.zip", asked: 0 },
    { reason: "NOT_HTTPS", url: `http://localhost/pkg.zip?token=${TOKEN}#frag`, shown: "http://localhost/pkg.zip", asked: 0 },
    { reason: "USERINFO", url: `https://user:${PASSWORD}@localhost/pkg.zip?token=${TOKEN}`, shown: "https://localhost/pkg.zip", asked: 0 },
    { reason: "LOCALHOST", url: `https://localhost/pkg.zip?token=${TOKEN}#frag`, shown: "https://localhost/pkg.zip", asked: 0 },
    { reason: "LOCALHOST", url: `https://LocalHost/pkg.zip?token=${TOKEN}`, shown: "https://localhost/pkg.zip", asked: 0 },
    { reason: "LOCALHOST", url: `https://a.localhost/pkg.zip?token=${TOKEN}#frag`, shown: "https://a.localhost/pkg.zip", asked: 0 },
    { reason: "LOCALHOST", url: `https://a.b.localhost:8443/pkg.zip`, shown: "https://a.b.localhost:8443/pkg.zip", asked: 0 },
    { reason: "TRAILING_DOT", url: `https://localhost./pkg.zip?token=${TOKEN}#frag`, shown: "https://localhost./pkg.zip", asked: 0 },
    { reason: "TRAILING_DOT", url: `https://a.localhost./pkg.zip?token=${TOKEN}#frag`, shown: "https://a.localhost./pkg.zip", asked: 0 },
    { reason: "TRAILING_DOT", url: `https://share.example./pkg.zip?token=${TOKEN}#frag`, shown: "https://share.example./pkg.zip", asked: 0 },
    { reason: "USERINFO", url: `https://user:${PASSWORD}@share.example/pkg.zip?token=${TOKEN}#frag`, shown: PAGE, asked: 0 },
    { reason: "USERINFO", url: `https://${PASSWORD}@share.example/pkg.zip`, shown: PAGE, asked: 0 },
    { reason: "USERINFO", url: `https://user:${PASSWORD}@1.2.3.4/pkg.zip`, shown: "https://1.2.3.4/pkg.zip", asked: 0 },
    { reason: "IP_LITERAL", url: `https://1.2.3.4/pkg.zip?token=${TOKEN}`, shown: "https://1.2.3.4/pkg.zip", asked: 0 },
    { reason: "IP_LITERAL", url: `https://1.2.3.4:8443/pkg.zip`, shown: "https://1.2.3.4:8443/pkg.zip", asked: 0 },
    { reason: "IP_LITERAL", url: `https://[2001:db8::1]/pkg.zip?token=${TOKEN}`, shown: "https://[2001:db8::1]/pkg.zip", asked: 0 },
    { reason: "IP_LITERAL", url: `https://2130706433/pkg.zip`, shown: "https://127.0.0.1/pkg.zip", asked: 0 },
    {
      reason: "NETWORK",
      url: secretUrl(),
      shown: PAGE,
      response: { error: new Error(`offline ${TOKEN} ${PASSWORD}`, { cause: new Error(TOKEN) }) },
      asked: 1,
    },
    ...[199, 300, 301, 404, 500].map((status) => ({
      reason: "HTTP_STATUS",
      url: secretUrl(),
      shown: PAGE,
      response: { status, body: goodZip() },
      asked: 1 as const,
    })),
    { reason: "REDIRECT", url: secretUrl(), shown: PAGE, redirects: { 1: `https://cdn.share.example/pkg.zip?token=${TOKEN}` }, asked: 1 },
    { reason: "REDIRECT", url: secretUrl(), shown: PAGE, redirects: { 1: "/elsewhere" }, asked: 1 },
    { reason: "REDIRECT", url: secretUrl(), shown: PAGE, redirects: { 1: "http://evil.example/x", 2: PAGE }, asked: 1 },
    { reason: "TOO_LARGE", url: secretUrl(), shown: PAGE, response: { body: `PK\x03\x04${"x".repeat(MAX_SHARE_BYTES)}` }, asked: 1 },
    ...[
      ["text", "hello"],
      ["empty", ""],
      ["too short", "PK"],
      ["a zip end record only", "PK\x05\x06" + "\0".repeat(18)],
      ["html", "<html>sign in</html>"],
    ].map(([, body]) => ({
      reason: "NOT_A_ZIP",
      url: secretUrl(),
      shown: PAGE,
      response: { body: body! },
      asked: 1 as const,
    })),
  ];

  it.each(cases)("$reason: $url", async ({ reason, url, shown, response, redirects, asked }) => {
    const w = world({ response: response ?? { body: goodZip() }, redirects });
    const err = await expectPlumsError(w.core.importFromUrl(url), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: shown, reason });
    expect(shown).not.toContain("#frag");
    expect(shown).not.toMatch(/[?#@]/);

    const text = serializeError(err);
    for (const hidden of [TOKEN, PASSWORD, "user:"]) expect(text).not.toContain(hidden);
    expect(w.confirm.asked).toHaveLength(asked);
    expect(w.egress.records).toHaveLength(asked);
    if (asked === 1) expect(w.egress.records).toEqual([{ url, method: "GET" }]);
    await expectUntouched(w);
  });

  it("covers every documented reason", () => {
    const reasons = ["INVALID_URL", "NOT_HTTPS", "USERINFO", "IP_LITERAL", "TRAILING_DOT", "LOCALHOST", "NETWORK", "HTTP_STATUS", "REDIRECT", "TOO_LARGE", "NOT_A_ZIP"];
    expect([...new Set(cases.map((c) => c.reason))].sort()).toEqual([...reasons].sort());
  });

  it("a body of exactly the size cap is not TOO_LARGE: it goes on to the package check", async () => {
    const body = `PK\x03\x04${"x".repeat(MAX_SHARE_BYTES - 4)}`;
    expect(body.length).toBe(MAX_SHARE_BYTES);
    const w = world({ response: { body } });
    const err = await expectPlumsError(w.core.importFromUrl(PAGE), "IMPORT_INVALID");
    expect(err.code).not.toBe("SHARE_FETCH_FAILED");
    await expectUntouched(w);
  });
});

describe("importFromUrl: a zip that fails the package checks keeps its own error", () => {
  const cases: [string, string, string | undefined, string][] = [
    ["invalid/missing-name.zip", "MANIFEST_INVALID", "/name", "missing name"],
    ["invalid/bad-kind.zip", "MANIFEST_INVALID", "/kind", "bad kind"],
    ["invalid/perm-bad-level.zip", "MANIFEST_INVALID", "/permissions/0/level", "bad level"],
    ["invalid/egress-target-with-scheme.zip", "MANIFEST_INVALID", "/permissions/0/target", "egress target with scheme"],
    ["invalid/egress-target-wildcard-tld.zip", "MANIFEST_INVALID", "/permissions/0/target", "wildcard TLD"],
    ["invalid/egress-target-single-label.zip", "MANIFEST_INVALID", "/permissions/0/target", "single-label target"],
    ["invalid/manifest-not-json.zip", "MANIFEST_INVALID", undefined, "manifest not JSON"],
    ["invalid/format-major-2.zip", "FORMAT_UNSUPPORTED", "/formatVersion", "format major 2"],
    ["invalid/no-manifest.zip", "IMPORT_INVALID", undefined, "no manifest"],
    ["invalid/zip-slip.zip", "IMPORT_INVALID", undefined, "zip slip"],
    ["invalid/absolute-path.zip", "IMPORT_INVALID", undefined, "absolute path"],
    ["malicious/zip-bomb-50mb.zip", "IMPORT_INVALID", undefined, "zip bomb"],
  ];

  it.each(cases)("%s -> %s %s (%s)", async (rel, code, at) => {
    const w = serving(fixtureBytes(rel));
    const err = await expectPlumsError(w.core.importFromUrl(`${PAGE}?token=${TOKEN}`), code, at);
    expect(err.code).not.toBe("SHARE_FETCH_FAILED");
    expect(w.confirm.asked).toHaveLength(1);
    expect(w.egress.records).toHaveLength(1);
    await expectUntouched(w);
  });

  it("invalid/not-a-zip.zip is a link failure, not a package failure", async () => {
    const w = serving(fixtureBytes("invalid/not-a-zip.zip"));
    const err = await expectPlumsError(w.core.importFromUrl(PAGE), "SHARE_FETCH_FAILED", "/url");
    expect(err.details).toEqual({ url: PAGE, reason: "NOT_A_ZIP" });
    await expectUntouched(w);
  });

  it("a truncated zip with a zip header is IMPORT_INVALID", async () => {
    const w = serving(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]));
    await expectPlumsError(w.core.importFromUrl(PAGE), "IMPORT_INVALID");
    await expectUntouched(w);
  });
});
