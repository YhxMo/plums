import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  type ManifestV2,
} from "@plums/core";
import { httpsService } from "../src/connection-service.js";
import { DesktopHost } from "../src/host.js";
const dirs: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-generic-"));
  dirs.push(dir);
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink();
  const host = new DesktopHost({
    dataDir: dir,
    secretStore: () => secrets,
    egress,
    confirm: { ask: async () => true },
  });
  hosts.push(host);
  await host.initialize();
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "connector",
    id: "weather",
    name: "Generic service",
    description: "",
    version: "1.0.0",
    dependencies: [],
    permissions: [
      {
        id: "other",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Separate permission",
      },
      {
        id: "api",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Retrieve public test information",
      },
    ],
    settingsSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          title: "URL",
          description: "Public base URL",
          default: "https://public-api.example/base",
        },
        selection: {
          type: "string",
          title: "Profile",
          description: "Credential profile",
          enum: ["fifth-test-protocol", "sixth-test-protocol"],
          default: "fifth-test-protocol",
        },
        token: {
          type: "string",
          title: "Token",
          description: "Test token",
          "x-secret": true,
        },
      },
    },
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        connections: [
          {
            id: "data",
            permissionId: "api",
            baseURLSetting: "url",
            selectorSetting: "selection",
            credentialProfiles: {
              "fifth-test-protocol": [
                { setting: "token", header: "X-Test-Token" },
              ],
              "sixth-test-protocol": [
                { setting: "token", header: "Authorization", prefix: "Test " },
              ],
            },
          },
        ],
        contributes: {
          connectors: [
            { name: "fetch", title: "Fetch" },
            { name: "fail", title: "Fail" },
            { name: "describe", title: "Describe" },
          ],
        },
      },
    },
  };
  const code = `export function activate(sdk) {
    sdk.register('connectors','describe',()=>sdk.connection('data'));
    sdk.register('connectors','fetch',async input=>{const b=await sdk.connection('data');const r=await sdk.capability(input.permissionId ?? 'api',{kind:'service',operation:'request',binding:b.binding,sources:[],input:{path:input.path ?? '/forecast?city=test',headers:input.headers ?? {},body:'fifth protocol data'}});if(input.fail)await sdk.failResponse(r.callId,input.fail);return r;});
    sdk.register('connectors','fail',input=>sdk.failResponse(input.callId,input.reason));
  }`;
  const builder = createCore({
    dataDir: path.join(dir, "builder"),
    secrets,
    egress,
  });
  const bytes = await builder.exportPackage({
    manifest,
    files: { "main.js": Buffer.from(code) },
  });
  builder.close();
  const p = (await host.preview(bytes)) as { token: string };
  const item = await host.importLibrary(p.token);
  const record = await host.createAgent("Generic service", [item.digest]);
  const id = record.instanceId;
  const save = (
    values: Record<string, unknown> = {},
    key = "private-fixture-key",
  ) =>
    host.setSettings(
      id,
      "weather",
      {
        url: "https://public-api.example/base",
        selection: "fifth-test-protocol",
        ...values,
      },
      { token: key },
    );
  await save();
  await host.enable(id, "weather");
  const invoke = (name: string, input: unknown = {}) =>
    host.invoke(id, "weather", "weather", "connectors", name, input);
  return { host, id, egress, invoke, save, dir, secrets };
}
it("runs a non-model protocol entirely in the external runner and binds credentials from saved configuration", async () => {
  const f = await fixture();
  const d = (await f.invoke("describe")) as Record<string, unknown>;
  expect(d).toMatchObject({
    origin: "https://public-api.example",
    basePath: "/base",
    ready: true,
  });
  expect(JSON.stringify(d)).not.toContain("private-fixture");
  await f.invoke("fetch", {
    headers: { "x-test-token": "forged-input-token" },
    url: "https://other.example",
    selection: "sixth-test-protocol",
  });
  expect(f.egress.records[0]).toMatchObject({
    url: "https://public-api.example/forecast?city=test",
    headers: { "X-Test-Token": "private-fixture-key" },
    body: "fifth protocol data",
  });
  expect(f.egress.records[0]?.headers?.["x-test-token"]).toBeUndefined();
  await f.save({ selection: "sixth-test-protocol" });
  await f.host.enable(f.id, "weather");
  await f.invoke("fetch");
  expect(f.egress.records[1]?.headers).toMatchObject({
    Authorization: "Test private-fixture-key",
  });
});
it("enables a connection with a one-character credential without using redacted settings as configuration", async () => {
  const f = await fixture();
  await f.save({}, "a");
  await f.host.setSettings(
    f.id,
    "weather",
    {
      url: "https://public-api.example/base",
      selection: "fifth-test-protocol",
    },
    {},
  );
  await f.host.enable(f.id, "weather");
  await f.invoke("fetch");
  expect(f.egress.records).toHaveLength(1);
  expect(f.egress.records[0]?.url).toBe(
    "https://public-api.example/forecast?city=test",
  );
  expect(f.egress.records[0]?.headers?.["X-Test-Token"]).toBe("a");
});
it.each(["//other.example/steal", "/\\other.example/steal", "/path#fragment"])(
  "never sends a request crossing the approved origin (%s)",
  async (requestPath) => {
    const f = await fixture();
    await expect(
      f.invoke("fetch", { path: requestPath }),
    ).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
    expect(f.egress.records).toHaveLength(0);
  },
);
it("changes the fingerprint and revokes existing approval for key-only changes", async () => {
  const f = await fixture();
  const before = (await f.invoke("describe")) as { fingerprint: string };
  await f.save({}, "replacement-fixture-key");
  const after = (await f.invoke("describe")) as { fingerprint: string };
  expect(after.fingerprint).not.toBe(before.fingerprint);
  await expect(f.invoke("fetch")).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
  });
  expect(f.egress.records).toHaveLength(0);
});
it("retains authentic completed execution receipts and refuses forged or later-invocation receipts", async () => {
  const f = await fixture();
  vi.spyOn(f.egress, "send").mockResolvedValue({
    status: 502,
    body: "private response text",
  });
  await expect(
    f.invoke("fetch", { fail: "HTTP_REJECTED" }),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      executionState: "completed",
      httpStatus: 502,
      reason: "HTTP_REJECTED",
      callId: expect.any(String),
    },
  });
  await expect(
    f.invoke("fail", {
      callId: "forged",
      reason: "RESPONSE_INVALID",
      executionState: "not_started",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  const r = (await f.invoke("fetch")) as { callId: string };
  await expect(
    f.invoke("fail", { callId: r.callId, reason: "RESPONSE_INVALID" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  const audit = JSON.stringify(await f.host.audit(f.id));
  expect(audit).toContain("HTTP_REJECTED");
  expect(audit).not.toContain("private response text");
  expect(audit).not.toContain("private-fixture-key");
});
it("cancels requests when configuration changes during asynchronous allow audit", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((r) => (entered = r));
  f.host.options.audit = async (_id, event) => {
    if (event.phase === "allow") {
      entered();
      await new Promise<void>((r) => (release = r));
    }
  };
  const call = f.invoke("fetch");
  const rejected = expect(call).rejects.toBeDefined();
  await blocked;
  await f.save({ url: "https://another-public.example" });
  release();
  await rejected;
  expect(f.egress.records).toHaveLength(0);
});

it("binds a connection to its declared permission even when another generic grant exists", async () => {
  const f = await fixture();
  await expect(
    f.invoke("fetch", { permissionId: "other" }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  const core = createCore({
    dataDir: path.join(f.dir, "instances", f.id, "core"),
    instanceId: f.id,
    secrets: f.secrets,
    egress: f.egress,
    services: { https: httpsService(() => core, f.egress) },
    onAudit: async () => {},
  });
  try {
    await core.grantBackgroundConsent({
      extensionId: "weather",
      permissionId: "other",
      operation: "request",
      binding: "weather/data",
      sources: [],
    });
    await expect(
      f.invoke("fetch", { permissionId: "other" }),
    ).rejects.toBeDefined();
    expect(f.egress.records).toHaveLength(0);
  } finally {
    core.close();
  }
});

it("preserves legal HTTP tokens and own special keys while overriding declared credentials", async () => {
  const f = await fixture();
  const punctuation = [
    "!",
    "#",
    "$",
    "%",
    "&",
    String.fromCharCode(39),
    "*",
    "+",
    "-",
    ".",
    "^",
    "_",
    String.fromCharCode(96),
    "|",
    "~",
  ];
  const names = [
    ...punctuation.map((point) => "X-" + point + "-Token"),
    "0",
    "__proto__",
    "constructor",
    "toString",
    "prototype",
    "valueOf",
  ];
  const send = vi.spyOn(f.egress, "send");
  for (const name of names) {
    await f.invoke("fetch", {
      headers: Object.fromEntries([
        [name, "own-field-value"],
        ["x-test-token", "forged-header-key"],
      ]),
    });
    const actual = send.mock.calls.at(-1)![0].headers!;
    expect(Object.hasOwn(actual, name)).toBe(true);
    expect(actual[name]).toBe("own-field-value");
    expect(Object.getPrototypeOf(actual)).toBeNull();
    expect(actual["X-Test-Token"]).toBe("private-fixture-key");
    expect(Object.hasOwn(actual, "x-test-token")).toBe(false);
    expect(send.mock.calls.at(-1)![0].url).toBe(
      "https://public-api.example/forecast?city=test",
    );
  }
  expect(f.egress.records).toHaveLength(names.length);
  const audit = JSON.stringify(await f.host.audit(f.id));
  expect(audit).not.toContain("own-field-value");
  expect(audit).not.toContain("private-fixture-key");
  expect(audit).not.toContain("forged-header-key");
});

it.each([
  "",
  "with space",
  "Colon:Name",
  "Bad\rName",
  "Bad\nName",
  "Bad\0Name",
  "host",
  "Content-Length",
  "connection",
  "TRANSFER-ENCODING",
  "Proxy-Authorization",
  "proxy-connection",
])(
  "rejects invalid or protected header names before the transport (%s)",
  async (name) => {
    const f = await fixture();
    await expect(
      f.invoke("fetch", { headers: Object.fromEntries([[name, "value"]]) }),
    ).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { reason: "REQUEST_INVALID", executionState: "not_started" },
    });
    expect(f.egress.records).toHaveLength(0);
  },
);

it.each(["bad\rvalue", "bad\nvalue", "bad\0value", 3, null])(
  "rejects invalid header values before the transport (%s)",
  async (value) => {
    const f = await fixture();
    await expect(
      f.invoke("fetch", { headers: { "X-Test": value } }),
    ).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { reason: "REQUEST_INVALID", executionState: "not_started" },
    });
    expect(f.egress.records).toHaveLength(0);
  },
);
