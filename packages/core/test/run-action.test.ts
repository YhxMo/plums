import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createCore,
  FakeModelProvider,
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  type Confirm,
  type Core,
  type EgressRequest,
  type EgressSink,
  type Manifest,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import { expectPlumsError, manifestZip, validManifest } from "./package-helpers.js";

const openCores: Core[] = [];
afterEach(() => {
  for (const core of openCores.splice(0)) core.close();
});

const SEND: EgressRequest = { url: "https://stats.example/upload", method: "POST", body: "{}" };

function manifest(id: string, permissions?: Manifest["permissions"]): Manifest {
  return {
    ...validManifest("extension"),
    id,
    dependencies: [],
    permissions: permissions ?? [
      { id: "read-notes", level: "read", target: "notes", reason: "Show your notes." },
      { id: "save-note", level: "write", target: "notes", reason: "Save a note." },
      { id: "send-stats", level: "egress", target: "stats.example", reason: "Upload usage." },
      { id: "api", level: "egress", target: "api.example.com", reason: "Call the API." },
      { id: "wild", level: "egress", target: "*.example.com", reason: "Call any example.com host." },
      { id: "port", level: "egress", target: "api.example.com:8443", reason: "Call the API on 8443." },
    ],
  };
}

/** Core with "ext-a" (3 permissions) installed, consented and enabled. Other ids are not installed. */
async function world(
  overrides: { confirm?: Confirm; egress?: EgressSink; answers?: boolean[]; redirects?: Record<number, string> } = {},
) {
  const egress = new RecordingEgressSink(overrides.redirects);
  const confirm = new ScriptedConfirm(overrides.answers ?? []);
  const core = createCore({
    dataDir: mkdtempSync(path.join(tmpdir(), "plums-t5-")),
    model: new FakeModelProvider(),
    egress: overrides.egress ?? egress,
    confirm: overrides.confirm ?? confirm,
    secrets: new MemorySecretStore(),
  });
  openCores.push(core);
  await core.importPackage(await manifestZip(manifest("ext-a")));
  await core.grantConsent("ext-a");
  await core.enable("ext-a");
  return { core, egress, confirm };
}

/** enable() refuses a package without consent, so some states can only be made in the database. */
function sql(core: Core, statement: string, ...params: unknown[]): void {
  const db = new Database(path.join(core.dataDir, "plums.db"));
  try {
    db.prepare(statement).run(...params);
  } finally {
    db.close();
  }
}

function editConsent(core: Core, change: (p: { id: string }) => object): Promise<void> {
  return core.getConsent("ext-a").then((consent) => {
    const edited = (consent?.permissions ?? []).map((p) => ({ ...p, ...change(p) }));
    sql(core, "UPDATE consents SET permissions = ? WHERE package_id = ?", JSON.stringify(edited), "ext-a");
  });
}

describe("allowed", () => {
  const rows = [
    { permissionId: "read-notes", level: "read", asked: 0, request: undefined },
    { permissionId: "save-note", level: "write", asked: 1, request: undefined },
    { permissionId: "send-stats", level: "egress", asked: 1, request: SEND },
  ] as const;

  it.each(rows)("$level: asks $asked time(s)", async ({ permissionId, level, asked, request }) => {
    const { core, egress, confirm } = await world({ answers: [true] });
    const result = await core.runAction({ extensionId: "ext-a", permissionId, request });
    expect(result).toEqual(level === "egress" ? { level, egress: { status: 200, body: "" } } : { level });
    expect(confirm.asked).toHaveLength(asked);
    expect(egress.records).toEqual(
      level === "egress" ? [{ ...SEND, url: new URL(SEND.url).href }] : [],
    );
  });

  it("a confirmation covers one call only", async () => {
    const { core, egress } = await world({ answers: [true] });
    const input = { extensionId: "ext-a", permissionId: "send-stats", request: SEND };
    await core.runAction(input);
    await expectPlumsError(core.runAction(input), "CONFIRMATION_DENIED");
    expect(egress.records).toHaveLength(1);
  });
});

describe("denied: nothing reaches the egress sink", () => {
  const egressInput = { extensionId: "ext-a", permissionId: "send-stats", request: SEND };
  const writeInput = { extensionId: "ext-a", permissionId: "save-note" };

  interface Row {
    name: string;
    input: { extensionId: string; permissionId: string; request?: EgressRequest };
    code: string;
    path?: string;
    details: object;
    asked: number;
    prepare?: (core: Core) => Promise<void> | void;
    /** Replaces the scripted confirm. `asked` is then not checked. */
    confirm?: (getCore: () => Core) => Confirm;
    answers?: boolean[];
  }
  const consent = (reason: string): Partial<Row> => ({
    code: "CONSENT_REQUIRED",
    path: "/permissions/2",
    details: { id: "ext-a", permissionId: "send-stats", version: "1.2.3", reason },
  });
  const declined = (permissionId: string, at: number) => ({
    code: "CONFIRMATION_DENIED",
    path: `/permissions/${at}`,
    details: { id: "ext-a", permissionId },
    asked: 1,
  });
  const custom = (confirm: Row["confirm"], prepare?: Row["prepare"]) => ({
    ...declined("send-stats", 2),
    confirm,
    prepare,
  });

  const rows: Row[] = [
    {
      name: "not installed",
      input: { ...egressInput, extensionId: "ghost" },
      code: "PERMISSION_DENIED",
      details: { id: "ghost", reason: "NOT_INSTALLED" },
      asked: 0,
      answers: [true],
    },
    {
      name: "not enabled",
      input: egressInput,
      prepare: (core) => void core.disable("ext-a"),
      code: "PERMISSION_DENIED",
      details: { id: "ext-a", reason: "NOT_ENABLED" },
      asked: 0,
      answers: [true],
    },
    {
      name: "permission not declared",
      input: { ...egressInput, permissionId: "send-everything" },
      code: "PERMISSION_DENIED",
      path: "/permissions",
      details: { id: "ext-a", permissionId: "send-everything", reason: "PERMISSION_NOT_DECLARED" },
      asked: 0,
      answers: [true],
    },
    {
      name: "permission only another extension declares",
      input: { ...egressInput, extensionId: "ext-b" },
      prepare: async (core) => {
        await core.importPackage(
          await manifestZip(manifest("ext-b", [{ id: "x", level: "read", target: "t", reason: "r" }])),
        );
        await core.grantConsent("ext-b");
        await core.enable("ext-b");
      },
      code: "PERMISSION_DENIED",
      path: "/permissions",
      details: { id: "ext-b", permissionId: "send-stats", reason: "PERMISSION_NOT_DECLARED" },
      asked: 0,
      answers: [true],
    },
    {
      name: "no consent record",
      input: egressInput,
      prepare: (core) => sql(core, "DELETE FROM consents WHERE package_id = ?", "ext-a"),
      ...consent("NO_CONSENT"),
      asked: 0,
      answers: [true],
    } as Row,
    {
      name: "consent does not list the permission",
      input: egressInput,
      prepare: (core) =>
        editConsent(core, (p) => (p.id === "send-stats" ? { id: "renamed" } : {})),
      ...consent("PERMISSION_NOT_CONSENTED"),
      asked: 0,
      answers: [true],
    } as Row,
    {
      name: "consent has another level",
      input: egressInput,
      prepare: (core) => editConsent(core, (p) => (p.id === "send-stats" ? { level: "read" } : {})),
      ...consent("PERMISSION_NOT_CONSENTED"),
      asked: 0,
      answers: [true],
    } as Row,
    {
      name: "consent has another target",
      input: egressInput,
      prepare: (core) =>
        editConsent(core, (p) => (p.id === "send-stats" ? { target: "https://elsewhere.example" } : {})),
      ...consent("PERMISSION_NOT_CONSENTED"),
      asked: 0,
      answers: [true],
    } as Row,
    {
      name: "no consent is reported before a url outside the target",
      input: { ...egressInput, request: { url: "https://evil.com" } },
      prepare: (core) => sql(core, "DELETE FROM consents WHERE package_id = ?", "ext-a"),
      ...consent("NO_CONSENT"),
      asked: 0,
      answers: [true],
    } as Row,
    { name: "egress declined", input: egressInput, answers: [false], ...declined("send-stats", 2) },
    { name: "egress, no preset answer", input: egressInput, ...declined("send-stats", 2) },
    { name: "write declined", input: writeInput, answers: [false], ...declined("save-note", 1) },
    { name: "write, no preset answer", input: writeInput, ...declined("save-note", 1) },
    { name: "answer is not literally true", input: egressInput, ...custom(() => ({ ask: async () => "yes" as never })) },
    {
      name: "confirm throws",
      input: egressInput,
      ...custom(() => ({
        ask: async () => {
          throw new Error("dialog crashed");
        },
      })),
    },
    (() => {
      const confirm: Confirm = { ask: async () => true };
      return {
        name: "confirm has no ask handler",
        input: egressInput,
        ...custom(
          () => confirm,
          () => void delete (confirm as { ask?: unknown }).ask,
        ),
      };
    })(),
    {
      name: "disabled while the user is answering",
      input: egressInput,
      confirm: (getCore) => ({
        ask: async () => {
          await getCore().disable("ext-a");
          return true;
        },
      }),
      code: "PERMISSION_DENIED",
      details: { id: "ext-a", reason: "NOT_ENABLED" },
      asked: 1,
    },
    {
      name: "target changed while the user is answering",
      input: { extensionId: "ext-a", permissionId: "api", request: { url: "https://api.example.com/x" } },
      confirm: (getCore) => ({
        ask: async () => {
          const from = '"target":"api.example.com","reason":"Call the API."';
          const to = '"target":"other.example.com","reason":"Call the API."';
          sql(getCore(), "UPDATE packages SET manifest = replace(manifest, ?, ?)", from, to);
          sql(getCore(), "UPDATE consents SET permissions = replace(permissions, ?, ?)", from, to);
          return true;
        },
      }),
      code: "PERMISSION_DENIED",
      path: "/request/url",
      details: { id: "ext-a", permissionId: "api", reason: "URL_NOT_ALLOWED" },
      asked: 1,
    },
    {
      name: "egress changed to write while the user is answering",
      input: { extensionId: "ext-a", permissionId: "api", request: { url: "https://api.example.com/x" } },
      confirm: (getCore) => ({
        ask: async () => {
          const from = '"id":"api","level":"egress"';
          const to = '"id":"api","level":"write"';
          sql(getCore(), "UPDATE packages SET manifest = replace(manifest, ?, ?)", from, to);
          sql(getCore(), "UPDATE consents SET permissions = replace(permissions, ?, ?)", from, to);
          return true;
        },
      }),
      code: "PERMISSION_DENIED",
      path: "/request/url",
      details: { id: "ext-a", permissionId: "api", reason: "URL_NOT_ALLOWED" },
      asked: 1,
    },
  ];

  it.each(rows)("$name", async (row) => {
    let core!: Core;
    const made = await world({
      ...(row.confirm ? { confirm: row.confirm(() => core) } : {}),
      answers: row.answers ?? [],
    });
    core = made.core;
    await row.prepare?.(core);
    const err = await expectPlumsError(core.runAction(row.input), row.code, row.path);
    expect(err.path).toBe(row.path);
    expect(err.details).toEqual(row.details);
    if (!row.confirm) expect(made.confirm.asked).toHaveLength(row.asked);
    expect(made.egress.records).toEqual([]);
  });

  it("the caller cannot lower the level of an egress permission", async () => {
    const { core, egress, confirm } = await world();
    await expectPlumsError(core.runAction({ ...egressInput, level: "read" } as never), "CONFIRMATION_DENIED");
    expect(confirm.asked).toHaveLength(1);
    expect(egress.records).toEqual([]);
  });

  it("an egress call without a request is rejected before the user is asked", async () => {
    const { core, egress, confirm } = await world({ answers: [true] });
    await expect(core.runAction({ extensionId: "ext-a", permissionId: "send-stats" })).rejects.toThrow(
      /request is required/,
    );
    expect(confirm.asked).toEqual([]);
    expect(egress.records).toEqual([]);
  });
});

it("an error thrown by the egress sink is not swallowed", async () => {
  const egress: EgressSink = {
    send: async () => {
      throw new Error("upstream said no");
    },
  };
  const { core } = await world({ egress, answers: [true] });
  await expect(
    core.runAction({ extensionId: "ext-a", permissionId: "send-stats", request: SEND }),
  ).rejects.toThrow("upstream said no");
});

describe("egress url must match the permission target", () => {
  const ok = (permissionId: string, url: string, host: string) => ({ permissionId, url, host });
  const allowedRows = [
    ok("api", "https://api.example.com/x", "api.example.com"),
    ok("api", "https://API.Example.COM:443/x?q=1#frag", "api.example.com"),
    ok("port", "https://api.example.com:8443/x", "api.example.com:8443"),
    ok("wild", "https://a.b.example.com", "a.b.example.com"),
  ];

  it.each(allowedRows)("allowed: $permissionId $url", async ({ permissionId, url, host }) => {
    const { core, egress, confirm } = await world({ answers: [true] });
    const request = { url };
    await core.runAction({ extensionId: "ext-a", permissionId, request });
    expect(confirm.asked).toHaveLength(1);
    expect(confirm.asked[0]).toMatchObject({ host });
    expect(confirm.asked[0]?.reason).toEqual(expect.any(String));
    expect(egress.records).toEqual([{ ...request, url: new URL(url).href }]);
  });

  const deniedRows: [string, string][] = [
    ["api", "https://evil.com"],
    ["api", "https://api.example.com.evil.com"],
    ["api", "https://evil.com/api.example.com"],
    ["api", "https://sub.api.example.com"],
    ["api", "http://api.example.com"],
    ["api", "https://api.example.com:8443"],
    ["api", "https://1.2.3.4"],
    ["api", "https://localhost"],
    ["api", "https://LOCALHOST"],
    ["api", "https://localhost./x"],
    ["api", "https://a.localhost./x"],
    ["api", "https://api.example.com./p.zip"],
    ["api", "https://foo.localhost"],
    ["api", "https://a.b.localhost/x"],
    ["wild", "https://a.example.com./x"],
    ["api", "https://user@api.example.com"],
    ["api", "https://user:pw@api.example.com"],
    ["api", "api.example.com"],
    ["api", "not a url"],
    ["port", "https://api.example.com"],
    ["port", "https://api.example.com:9"],
    ["wild", "https://example.com"],
    ["wild", "https://a.example.com:8443"],
    ["wild", "https://notexample.com"],
    ["wild", "https://a.example.com.evil.com"],
    ["wild", "http://a.example.com"],
    ["wild", "https://.example.com/"],
    ["wild", "https://a..example.com/"],
    ["api", "https://.good.com/"],
    ["api", "https://a..good.com"],
  ];

  it.each(deniedRows)("denied: %s %s", async (permissionId, url) => {
    const { core, egress, confirm } = await world({ answers: [true] });
    const err = await expectPlumsError(
      core.runAction({ extensionId: "ext-a", permissionId, request: { url } }),
      "PERMISSION_DENIED",
      "/request/url",
    );
    expect(err.details).toEqual({ id: "ext-a", permissionId, reason: "URL_NOT_ALLOWED" });
    expect(confirm.asked).toEqual([]);
    expect(egress.records).toEqual([]);
  });
});

describe("redirects are not followed", () => {
  it("returns the redirect as it is and records one send", async () => {
    const redirectTo = "https://evil.com/x";
    const { core, egress, confirm } = await world({ answers: [true], redirects: { 1: redirectTo } });
    const request = { url: "https://api.example.com/" };
    const result = await core.runAction({ extensionId: "ext-a", permissionId: "api", request });
    expect(result).toEqual({ level: "egress", egress: { status: 302, body: "", redirectTo } });
    expect(egress.records).toEqual([{ ...request, url: new URL(request.url).href }]);
    expect(confirm.asked).toHaveLength(1);
  });

  it("the caller can run the new url again, and it goes through the full check", async () => {
    const { core, egress, confirm } = await world({ answers: [true, true], redirects: { 1: "https://evil.com/x" } });
    const first = await core.runAction({
      extensionId: "ext-a",
      permissionId: "api",
      request: { url: "https://api.example.com/" },
    });
    await expectPlumsError(
      core.runAction({
        extensionId: "ext-a",
        permissionId: "api",
        request: { url: first.egress?.redirectTo ?? "" },
      }),
      "PERMISSION_DENIED",
      "/request/url",
    );
    expect(egress.records.map((r) => r.url)).toEqual(["https://api.example.com/"]);
    expect(confirm.asked).toHaveLength(1);
  });
});

describe("confirm text", () => {
  const rows: [string, string | undefined, string, string | undefined][] = [
    ["api", "https://api.example.com/x?token=1", "「Demo extension」想把数据发送到 api.example.com。原因:Call the API.。允许吗?", "api.example.com"],
    ["port", "https://api.example.com:8443/x", "「Demo extension」想把数据发送到 api.example.com:8443。原因:Call the API on 8443.。允许吗?", "api.example.com:8443"],
    [
      "wild",
      "https://a.b.example.com/x",
      "「Demo extension」想把数据发送到 a.b.example.com（example.com 这个网站的所有子站）。原因:Call any example.com host.。允许吗?",
      "a.b.example.com",
    ],
    ["save-note", undefined, "「Demo extension」想修改你的数据。原因:Save a note.。允许吗?", undefined],
  ];
  it.each(rows)("%s", async (permissionId, url, message, host) => {
    const { core, confirm } = await world({ answers: [true] });
    await core.runAction({ extensionId: "ext-a", permissionId, ...(url ? { request: { url } } : {}) });
    const asked = confirm.asked[0];
    expect(asked?.message).toBe(message);
    expect(asked?.host).toBe(host);
    expect(asked?.reason).toEqual(expect.any(String));
    for (const word of ["https://", "egress", "target", permissionId === "api" ? "token" : permissionId]) {
      expect(asked?.message).not.toContain(word);
    }
  });
});

it("an egress target in the old style, already stored, is denied before confirm and the sink", async () => {
  const { core, egress, confirm } = await world({ answers: [true] });
  sql(core, `UPDATE packages SET manifest = replace(manifest, '"target":"stats.example"', '"target":"https://stats.example"')`);
  sql(core, `UPDATE consents SET permissions = replace(permissions, '"target":"stats.example"', '"target":"https://stats.example"')`);
  const err = await expectPlumsError(
    core.runAction({ extensionId: "ext-a", permissionId: "send-stats", request: SEND }),
    "PERMISSION_DENIED",
    "/request/url",
  );
  expect(err.details).toMatchObject({ reason: "URL_NOT_ALLOWED" });
  expect(confirm.asked).toEqual([]);
  expect(egress.records).toEqual([]);
});
