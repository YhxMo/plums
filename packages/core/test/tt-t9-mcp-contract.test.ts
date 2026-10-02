import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  FakeModelProvider,
  MemorySecretStore,
  mcpToolFingerprint,
  RecordingEgressSink,
  ScriptedConfirm,
  secretRef,
  type Confirm,
  type Core,
  type Manifest,
  type McpTool,
  type PlumsError,
} from "@plums/core";
import { afterEach, describe, expect, it } from "vitest";
import { expectPlumsError, listAll, makeCore, manifestZip } from "./package-helpers.js";

/**
 * Contract tests for T9 (baseline 43d5be88). The kernel never connects to an MCP server:
 * every tool list is data passed in by the test.
 * 基线不同、故意自包含、故意绕过 API。
 * The other test PRs sit on different baselines, so this file keeps its own world() and
 * bypass() and does not import their helpers. Leak checks use the local serializeError,
 * which walks the whole cause chain, including non-enumerable error properties.
 * @plums/core does not export that function.
 *
 * A few states have no public way to build them (enabled with no consent, a consent that
 * no longer matches). Those two rows edit `packages` / `consents` and are marked in the
 * PR as sensitive to the table layout.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "packages");
const fixture = (rel: string) => path.join(FIXTURES, rel);

/** Long enough that a leaked description cannot hide inside a hash or a tool name. */
const LEAK = "plums-mcp-desc-LEAK-9f3a7c1e-DO-NOT-ECHO";

const ID = "test.conn.min";
const MANUAL = "manual:notes";
const PERMS: Manifest["permissions"] = [
  { id: "search", level: "read", target: "notes", reason: "Search notes." },
  { id: "post", level: "write", target: "notes", reason: "Post notes." },
  { id: "sync", level: "egress", target: "api.example.com", reason: "Sync notes." },
];

const tool = (name: string, description = `${LEAK} ${name}`, level?: McpTool["level"]): McpTool =>
  ({ name, description, ...(level ? { level } : {}) });

const SEARCH = tool("search");
const POST = tool("post", `${LEAK} post`, "write");
const SYNC = tool("sync", `${LEAK} sync`, "egress");

interface World {
  core: Core;
  dataDir: string;
  egress: RecordingEgressSink;
  confirm: ScriptedConfirm;
  model: FakeModelProvider;
  secrets: MemorySecretStore;
}

const open: World[] = [];
afterEach(() => {
  for (const w of open.splice(0)) {
    w.core.close();
    rmSync(w.dataDir, { recursive: true, force: true });
  }
});

function world(options: { answers?: boolean[]; confirm?: Confirm } = {}): World {
  const egress = new RecordingEgressSink();
  const confirm = new ScriptedConfirm(options.answers ?? []);
  const model = new FakeModelProvider();
  const secrets = new MemorySecretStore();
  const made = makeCore({ egress, model, confirm: options.confirm ?? confirm, secrets });
  const w = { ...made, egress, confirm, model, secrets };
  open.push(w);
  return w;
}

/** The TT1 connector, with three permissions added. Consented and enabled. Tools are not approved. */
async function ready(options: { answers?: boolean[]; confirm?: Confirm } = {}): Promise<World & { manifest: Manifest }> {
  const w = world(options);
  const base = (await w.core.validatePackage(fixture("valid/connector-min.zip"))).manifest;
  const manifest: Manifest = { ...base, permissions: PERMS };
  await w.core.importPackage(await manifestZip(manifest));
  await w.core.grantConsent(ID);
  await w.core.enable(ID);
  return Object.assign(w, { manifest });
}

/**
 * Deliberately bypasses the API. `enable` refuses a package with no consent, and nothing in the
 * public API can make a stored consent disagree with the manifest.
 */
function bypass(w: World, change: (db: Database.Database) => void): void {
  const db = new Database(path.join(w.dataDir, "plums.db"));
  try {
    change(db);
  } finally {
    db.close();
  }
}

/** Install list, consent, and MCP approvals. A refused call must leave this unchanged. */
async function snap(w: World, ids: string[]) {
  const approvals: Record<string, unknown> = {};
  for (const id of ids) approvals[id] = await w.core.getMcpApprovals(id);
  return {
    installed: await w.core.listInstalled(),
    consent: await w.core.getConsent(ID),
    approvals,
    files: listAll(w.dataDir).filter((name) => !name.startsWith("plums.db")).sort(),
  };
}

/** Everything an error shows a caller, including the whole `cause` chain. `JSON.stringify` on an Error is `{}`, so a secret sitting only in a non-enumerable `cause` would otherwise slip past. */
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

function expectNoLeak(err: PlumsError, asked: readonly { message: string; reason?: string }[] = []): void {
  const text = `${serializeError(err)}\n${JSON.stringify(asked)}`;
  expect(text).not.toContain(LEAK);
}

describe("mcpToolFingerprint", () => {
  /** Missing schema and explicit null are both the JSON null in the hashed triple. */
  const hash = (name: string, description: string, schema: unknown = null) =>
    createHash("sha256").update(JSON.stringify([name, description, schema])).digest("hex");

  it("is SHA-256 of [name, description, inputSchema], and a missing schema hashes as null", () => {
    const once = mcpToolFingerprint(SEARCH);
    expect(once).toBe(hash(SEARCH.name, SEARCH.description, null));
    expect(once).toBe(mcpToolFingerprint({ ...SEARCH, inputSchema: null }));
    expect(once).toBe(mcpToolFingerprint({ name: SEARCH.name, description: SEARCH.description }));
    expect(once).toMatch(/^[0-9a-f]{64}$/);
  });

  const changed: [string, McpTool][] = [
    ["one character in the description", { name: "search", description: `${LEAK} search!` }],
    ["a trailing space", { name: "search", description: `${LEAK} search ` }],
    ["different case in the name", { name: "Search", description: SEARCH.description }],
    ["different case in the description", { name: "search", description: SEARCH.description.replace("LEAK", "leak") }],
    ["a quote inside the description", { name: "search", description: `${LEAK} "quoted"` }],
    ["only the inputSchema", { ...SEARCH, inputSchema: { type: "object" } }],
  ];
  it.each(changed)("changes when %s", (_name, next) => {
    expect(mcpToolFingerprint(next)).not.toBe(mcpToolFingerprint(SEARCH));
  });

  it("sorts object keys and keeps array order, and ignores level", () => {
    const nested = { b: 1, a: { d: true, c: ["x", "y"] } };
    const sorted = { a: { c: ["x", "y"], d: true }, b: 1 };
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: nested })).toBe(hash(SEARCH.name, SEARCH.description, sorted));
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: { a: 1, b: undefined } })).toBe(
      hash(SEARCH.name, SEARCH.description, { a: 1 }),
    );
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: ["x", "y"] })).not.toBe(
      mcpToolFingerprint({ ...SEARCH, inputSchema: ["y", "x"] }),
    );
    const withLevel: McpTool = { ...SEARCH, level: "egress" };
    expect(mcpToolFingerprint(withLevel)).toBe(mcpToolFingerprint(SEARCH));
    expect(mcpToolFingerprint({ name: "ab", description: "c" })).not.toBe(mcpToolFingerprint({ name: "a", description: "bc" }));
  });

  it("keeps a __proto__ key on a null-prototype object in the hash", () => {
    const hidden = Object.create(null) as Record<string, unknown>;
    hidden.type = "object";
    const properties = Object.create(null) as Record<string, unknown>;
    properties.__proto__ = { type: "string" };
    hidden.properties = properties;
    const plain = { type: "object", properties: {} };
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: hidden })).not.toBe(
      mcpToolFingerprint({ ...SEARCH, inputSchema: plain }),
    );
  });

  /** Depth starts at 1 on the root. A value at depth 64 is the last one accepted. */
  const nest = (depth: number): unknown => {
    let node: unknown = "x";
    for (let i = 1; i < depth; i += 1) node = { n: node };
    return node;
  };

  it("accepts a schema of exactly 64 levels and exactly 256 KiB", () => {
    expect(() => mcpToolFingerprint({ ...SEARCH, inputSchema: nest(64) })).not.toThrow();
    const room = 256 * 1024 - Buffer.byteLength(JSON.stringify({ blob: "" }));
    const exact = { blob: "x".repeat(room) };
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(256 * 1024);
    expect(() => mcpToolFingerprint({ ...SEARCH, inputSchema: exact })).not.toThrow();
  });

  it("rejects NaN, Infinity, a non-plain object, 65 levels, or more than 256 KiB", () => {
    class Box {
      n = 1;
    }
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, new Date(), new Map(), new Box(), nest(65), { blob: "x".repeat(256 * 1024) }];
    for (const inputSchema of bad) {
      expect(() => mcpToolFingerprint({ ...SEARCH, inputSchema })).toThrow(TypeError);
    }
  });
});

describe("acceptance 9: a changed tool description must be approved again", () => {
  it("one changed character is CONSENT_REQUIRED / TOOL_CHANGED, and approving the new words allows it", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });

    const changed = { name: "search", description: `${SEARCH.description}.` };
    expect(mcpToolFingerprint(changed)).not.toBe(mcpToolFingerprint(SEARCH));
    expect(await w.core.checkMcpTools(ID, [changed])).toEqual([
      { tool: "search", fingerprint: mcpToolFingerprint(changed), state: "CHANGED" },
    ]);
    expect(await w.core.checkMcpTools(ID, [SEARCH])).toEqual([
      { tool: "search", fingerprint: mcpToolFingerprint(SEARCH), state: "APPROVED" },
    ]);

    const before = await snap(w, [ID]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, changed), "CONSENT_REQUIRED", "/tools/search");
    expect(err.details).toEqual({
      id: ID,
      tool: "search",
      reason: "TOOL_CHANGED",
      approvedFingerprint: mcpToolFingerprint(SEARCH),
      fingerprint: mcpToolFingerprint(changed),
    });
    expectNoLeak(err);
    expect(await snap(w, [ID])).toEqual(before);
    expect([w.egress.records, w.model.calls]).toEqual([[], []]);

    await w.core.approveMcpTools(ID, [changed]);
    expect(await w.core.authorizeMcpTool(ID, changed)).toEqual({ level: "read" });
    const stale = await expectPlumsError(w.core.authorizeMcpTool(ID, SEARCH), "CONSENT_REQUIRED", "/tools/search");
    expect(stale.details).toMatchObject({ reason: "TOOL_CHANGED" });
  });

  it("changing only inputSchema is CONSENT_REQUIRED / TOOL_CHANGED, and the schema text is not in the error", async () => {
    const w = await ready();
    const schema = { type: "object", properties: { q: { type: "string" } } };
    const approved = { ...SEARCH, inputSchema: schema };
    await w.core.approveMcpTools(ID, [approved]);
    expect(await w.core.authorizeMcpTool(ID, approved)).toEqual({ level: "read" });

    const marker = "SCHEMA-LEAK-9f3a7c1e";
    const changed = { ...approved, inputSchema: { ...schema, title: marker } };
    const before = await snap(w, [ID]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, changed), "CONSENT_REQUIRED", "/tools/search");
    expect(err.details).toEqual({
      id: ID,
      tool: "search",
      reason: "TOOL_CHANGED",
      approvedFingerprint: mcpToolFingerprint(approved),
      fingerprint: mcpToolFingerprint(changed),
    });
    expect(JSON.stringify({ message: err.message, path: err.path, details: err.details, cause: err.cause, stack: err.stack })).not.toContain(marker);
    expect(await snap(w, [ID])).toEqual(before);

    await w.core.approveMcpTools(ID, [changed]);
    expect(await w.core.authorizeMcpTool(ID, changed)).toEqual({ level: "read" });
  });
});

describe("authorizeMcpTool error table", () => {
  interface Row {
    situation: string;
    code: string;
    path?: string;
    arrange: (w: World) => Promise<McpTool>;
    details: (tool: McpTool) => unknown;
    /** Which server the call uses. */
    server?: string;
    answers?: boolean[];
  }

  const rows: Row[] = [
    {
      situation: "not installed",
      code: "PERMISSION_DENIED",
      server: "missing.pack",
      arrange: async () => SEARCH,
      details: () => ({ id: "missing.pack", reason: "NOT_INSTALLED" }),
    },
    {
      situation: "installed but not a connector",
      code: "PERMISSION_DENIED",
      server: "test.ext.min",
      arrange: async (w) => {
        await w.core.importPackage(fixture("valid/extension-min.zip"));
        return SEARCH;
      },
      details: () => ({ id: "test.ext.min", reason: "NOT_A_CONNECTOR" }),
    },
    {
      situation: "a character card is not a connector either",
      code: "PERMISSION_DENIED",
      server: "test.char.min",
      arrange: async (w) => {
        await w.core.importPackage(fixture("valid/character-min.zip"));
        return SEARCH;
      },
      details: () => ({ id: "test.char.min", reason: "NOT_A_CONNECTOR" }),
    },
    {
      situation: "not enabled",
      code: "PERMISSION_DENIED",
      arrange: async (w) => {
        await w.core.disable(ID);
        return SEARCH;
      },
      details: () => ({ id: ID, reason: "NOT_ENABLED" }),
    },
    {
      situation: "not enabled wins over a changed description",
      code: "PERMISSION_DENIED",
      arrange: async (w) => {
        await w.core.approveMcpTools(ID, [SEARCH]);
        await w.core.disable(ID);
        return { ...SEARCH, description: `${SEARCH.description}!` };
      },
      details: () => ({ id: ID, reason: "NOT_ENABLED" }),
    },
    {
      situation: "tool name matches no permission",
      code: "PERMISSION_DENIED",
      path: "/permissions",
      arrange: async () => tool("not-a-tool"),
      details: (t) => ({ id: ID, permissionId: t.name, reason: "PERMISSION_NOT_DECLARED" }),
    },
    {
      situation: "no package consent",
      code: "CONSENT_REQUIRED",
      path: "/permissions/0",
      arrange: async (w) => {
        await w.core.disable(ID);
        bypass(w, (db) => {
          db.prepare("DELETE FROM consents WHERE package_id = ?").run(ID);
          db.prepare("UPDATE packages SET enabled = 1 WHERE id = ?").run(ID);
        });
        return SEARCH;
      },
      details: () => ({ id: ID, permissionId: "search", version: "1.0.0", reason: "NO_CONSENT" }),
    },
    {
      situation: "consent does not cover this permission",
      code: "CONSENT_REQUIRED",
      path: "/permissions/0",
      arrange: async (w) => {
        const consent = await w.core.getConsent(ID);
        const permissions = (consent?.permissions ?? []).map((p) => (p.id === "search" ? { ...p, target: "other" } : p));
        bypass(w, (db) => {
          db.prepare("UPDATE consents SET permissions = ? WHERE package_id = ?").run(JSON.stringify(permissions), ID);
        });
        return SEARCH;
      },
      details: () => ({ id: ID, permissionId: "search", version: "1.0.0", reason: "PERMISSION_NOT_CONSENTED" }),
    },
    {
      situation: "never approved",
      code: "CONSENT_REQUIRED",
      path: "/tools/search",
      arrange: async () => SEARCH,
      details: (t) => ({ id: ID, tool: t.name, reason: "TOOL_ADDED", fingerprint: mcpToolFingerprint(t) }),
    },
    {
      situation: "description changed",
      code: "CONSENT_REQUIRED",
      path: "/tools/search",
      arrange: async (w) => {
        await w.core.approveMcpTools(ID, [SEARCH]);
        return { ...SEARCH, description: `${SEARCH.description}!` };
      },
      details: (t) => ({
        id: ID,
        tool: "search",
        reason: "TOOL_CHANGED",
        approvedFingerprint: mcpToolFingerprint(SEARCH),
        fingerprint: mcpToolFingerprint(t),
      }),
    },
    {
      situation: "unverified write was not granted one by one",
      code: "PERMISSION_DENIED",
      path: "/tools/post",
      server: MANUAL,
      arrange: async () => POST,
      details: () => ({ id: MANUAL, tool: "post", reason: "UNVERIFIED_READ_ONLY" }),
    },
    {
      situation: "unverified egress was not granted one by one",
      code: "PERMISSION_DENIED",
      path: "/tools/sync",
      server: MANUAL,
      arrange: async () => SYNC,
      details: () => ({ id: MANUAL, tool: "sync", reason: "UNVERIFIED_READ_ONLY" }),
    },
    {
      situation: "an unverified tool with no level counts as write",
      code: "PERMISSION_DENIED",
      path: "/tools/mystery",
      server: MANUAL,
      arrange: async () => tool("mystery"),
      details: () => ({ id: MANUAL, tool: "mystery", reason: "UNVERIFIED_READ_ONLY" }),
    },
    {
      situation: "unverified call level does not match the granted level",
      code: "PERMISSION_DENIED",
      path: "/tools/post",
      server: MANUAL,
      arrange: async (w) => {
        await w.core.approveMcpTools(MANUAL, [{ ...POST, level: "read" }]);
        return POST;
      },
      details: () => ({ id: MANUAL, tool: "post", reason: "LEVEL_MISMATCH" }),
    },
    {
      situation: "a changed description wins over a raised level",
      code: "CONSENT_REQUIRED",
      path: "/tools/post",
      server: MANUAL,
      arrange: async (w) => {
        await w.core.approveMcpTools(MANUAL, [{ ...POST, level: "read" }]);
        return { ...POST, description: `${POST.description}!` };
      },
      details: (t) => ({
        id: MANUAL,
        tool: "post",
        reason: "TOOL_CHANGED",
        approvedFingerprint: mcpToolFingerprint(POST),
        fingerprint: mcpToolFingerprint(t),
      }),
    },
    {
      situation: "the user refused a write",
      code: "CONFIRMATION_DENIED",
      path: "/tools/post",
      answers: [false],
      arrange: async (w) => {
        await w.core.approveMcpTools(ID, [POST]);
        return POST;
      },
      details: () => ({ id: ID, tool: "post" }),
    },
  ];

  it.each(rows)("$situation -> $code", async (row) => {
    const w = await ready({ answers: row.answers ?? [true] });
    const callTool = await row.arrange(w);
    const server = row.server ?? ID;
    const before = await snap(w, [ID, MANUAL]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(server, callTool), row.code, row.path);
    expect(err.path).toBe(row.path);
    expect(err.details).toEqual(row.details(callTool));
    expectNoLeak(err, w.confirm.asked);
    expect(await snap(w, [ID, MANUAL])).toEqual(before);
    expect([w.egress.records, w.model.calls]).toEqual([[], []]);
  });

  const confirmRefusals: [string, Confirm][] = [
    ["throws", { ask: () => Promise.reject(new Error(LEAK)) }],
    ["throws synchronously", { ask: () => { throw new Error(LEAK); } }],
    ["answers the string true", { ask: async () => "true" as never }],
    ["answers nothing", { ask: async () => undefined as never }],
  ];
  it("anything other than true is CONFIRMATION_DENIED and leaks nothing", async () => {
    for (const [, confirm] of confirmRefusals) {
      const w = await ready({ confirm });
      await w.core.approveMcpTools(ID, [POST]);
      const before = await snap(w, [ID]);
      const err = await expectPlumsError(w.core.authorizeMcpTool(ID, POST), "CONFIRMATION_DENIED", "/tools/post");
      expect(err.details).toEqual({ id: ID, tool: "post" });
      expectNoLeak(err);
      expect(await snap(w, [ID])).toEqual(before);
      expect(w.egress.records).toEqual([]);
    }
  });

  it("checks again after confirm: disabling during the question is NOT_ENABLED", async () => {
    const w = await ready({
      confirm: { ask: async () => { await w.core.disable(ID); return true; } },
    });
    await w.core.approveMcpTools(ID, [POST]);
    const approvals = await w.core.getMcpApprovals(ID);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, POST), "PERMISSION_DENIED");
    expect(err.details).toEqual({ id: ID, reason: "NOT_ENABLED" });
    expect(await w.core.getMcpApprovals(ID)).toEqual(approvals);
  });

  it("checks again after confirm: a description edited during the question is TOOL_CHANGED", async () => {
    const live = { ...POST };
    const w = await ready({
      confirm: { ask: async () => { live.description = `${LEAK} post edited`; return true; } },
    });
    await w.core.approveMcpTools(ID, [POST]);
    const before = await snap(w, [ID]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, live), "CONSENT_REQUIRED", "/tools/post");
    expect(err.details).toMatchObject({ reason: "TOOL_CHANGED", approvedFingerprint: mcpToolFingerprint(POST) });
    expectNoLeak(err);
    expect(await snap(w, [ID])).toEqual(before);
  });

  it("approving a write tool and then calling it as read still asks", async () => {
    const w = await ready({ answers: [true] });
    await w.core.approveMcpTools(ID, [POST]);
    expect(w.confirm.asked).toEqual([]);
    expect(await w.core.authorizeMcpTool(ID, { ...POST, level: "read" })).toEqual({ level: "write" });
    expect(w.confirm.asked).toHaveLength(1);
    expect(w.egress.records).toEqual([]);
  });

  it("a level that changes during confirm is PERMISSION_DENIED / LEVEL_MISMATCH and writes nothing", async () => {
    const w = await ready({
      confirm: {
        ask: async () => {
          bypass(w, (db) => {
            const pkg = db.prepare("SELECT manifest FROM packages WHERE id = ?").get(ID) as { manifest: string };
            const manifest = JSON.parse(pkg.manifest) as Manifest;
            manifest.permissions = manifest.permissions.map((p) => (p.id === "post" ? { ...p, level: "read" } : p));
            db.prepare("UPDATE packages SET manifest = ? WHERE id = ?").run(JSON.stringify(manifest), ID);
            const row = db.prepare("SELECT permissions FROM consents WHERE package_id = ?").get(ID) as { permissions: string };
            const permissions = (JSON.parse(row.permissions) as Manifest["permissions"]).map((p) =>
              p.id === "post" ? { ...p, level: "read" as const } : p,
            );
            db.prepare("UPDATE consents SET permissions = ? WHERE package_id = ?").run(JSON.stringify(permissions), ID);
          });
          return true;
        },
      },
    });
    await w.core.approveMcpTools(ID, [POST]);
    const approvals = await w.core.getMcpApprovals(ID);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, POST), "PERMISSION_DENIED", "/tools/post");
    expect(err.details).toEqual({ id: ID, tool: "post", reason: "LEVEL_MISMATCH" });
    expect(await w.core.getMcpApprovals(ID)).toEqual(approvals);
    expect(w.egress.records).toEqual([]);
  });

  it("a changed inputSchema on a manual service or a write tool needs consent again", async () => {
    const w = await ready();
    const read = { ...SEARCH, level: "read" as const, inputSchema: { type: "object" } };
    await w.core.approveMcpTools(MANUAL, [read]);
    const changedManual = { ...read, inputSchema: { type: "object", properties: { q: { type: "string" } } } };
    const manualErr = await expectPlumsError(
      w.core.authorizeMcpTool(MANUAL, changedManual),
      "CONSENT_REQUIRED",
      "/tools/search",
    );
    expect(manualErr.details).toMatchObject({
      reason: "TOOL_CHANGED",
      approvedFingerprint: mcpToolFingerprint(read),
      fingerprint: mcpToolFingerprint(changedManual),
    });

    await w.core.approveMcpTools(ID, [{ ...POST, inputSchema: { type: "object" } }]);
    const changedWrite = { ...POST, inputSchema: { type: "object", properties: { text: { type: "string" } } } };
    const before = await w.core.getMcpApprovals(ID);
    const writeErr = await expectPlumsError(w.core.authorizeMcpTool(ID, changedWrite), "CONSENT_REQUIRED", "/tools/post");
    expect(writeErr.details).toMatchObject({ reason: "TOOL_CHANGED" });
    expect(await w.core.getMcpApprovals(ID)).toEqual(before);
    expect(await w.core.getMcpApprovals(MANUAL)).toMatchObject({ tools: [{ tool: "search", fingerprint: mcpToolFingerprint(read) }] });
  });

  it("a schema the fingerprint refuses throws TypeError and writes nothing", async () => {
    const w = await ready();
    const before = await snap(w, [ID, MANUAL]);
    let deep: unknown = "x";
    for (let i = 1; i < 65; i += 1) deep = { n: deep };
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, new Date(), new Map(), deep, { blob: "x".repeat(256 * 1024) }];
    for (const inputSchema of bad) {
      await expect(w.core.approveMcpTools(ID, [{ ...SEARCH, inputSchema }])).rejects.toThrow(TypeError);
      await expect(w.core.approveMcpTools(MANUAL, [{ ...SEARCH, level: "read", inputSchema }])).rejects.toThrow(TypeError);
    }
    expect(await snap(w, [ID, MANUAL])).toEqual(before);
  });
});

describe("approvals: unchanged, added, removed, uninstalled", () => {
  it("an approved unchanged tool is authorized at the manifest level, whatever level the host sends", async () => {
    const w = await ready({ answers: [true, true] });
    const result = await w.core.approveMcpTools(ID, [SEARCH, { ...POST, level: "read" }, SYNC]);
    expect(result.skipped).toEqual([]);
    expect(result.approved.map((a) => [a.tool, a.level])).toEqual([
      ["search", "read"],
      ["post", "write"],
      ["sync", "egress"],
    ]);
    expect(await w.core.authorizeMcpTool(ID, { ...POST, level: "read" })).toEqual({ level: "write" });
    expect(await w.core.authorizeMcpTool(ID, SYNC)).toEqual({ level: "egress" });
    expect(w.egress.records).toEqual([]);
    for (const asked of w.confirm.asked) expect(JSON.stringify(asked)).not.toContain(LEAK);
    const state = await w.core.getMcpApprovals(ID);
    expect(state).toMatchObject({ serverId: ID, unverified: false });
    expect(state.tools.map((t) => t.tool)).toEqual(["post", "search", "sync"]);
  });

  it("a new tool and a renamed tool are ADDED; the old name still works", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    const renamed = tool("lookup");
    expect((await w.core.checkMcpTools(ID, [SEARCH, POST, renamed])).map((c) => [c.tool, c.state])).toEqual([
      ["search", "APPROVED"],
      ["post", "ADDED"],
      ["lookup", "ADDED"],
    ]);
    const before = await snap(w, [ID]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, renamed), "PERMISSION_DENIED", "/permissions");
    expect(err.details).toMatchObject({ reason: "PERMISSION_NOT_DECLARED" });
    expect(await snap(w, [ID])).toEqual(before);
    await expectPlumsError(w.core.authorizeMcpTool(ID, POST), "CONSENT_REQUIRED", "/tools/post");
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });
  });

  it("a tool that leaves the list loses its approval, and the same words coming back are TOOL_ADDED", async () => {
    const w = await ready({ answers: [true] });
    await w.core.approveMcpTools(ID, [SEARCH, POST]);
    const consent = await w.core.getConsent(ID);
    expect(await w.core.checkMcpTools(ID, [SEARCH])).toEqual([
      { tool: "search", fingerprint: mcpToolFingerprint(SEARCH), state: "APPROVED" },
    ]);
    expect((await w.core.getMcpApprovals(ID)).tools.map((t) => t.tool)).toEqual(["search"]);
    const dropped = await expectPlumsError(w.core.authorizeMcpTool(ID, POST), "CONSENT_REQUIRED", "/tools/post");
    expect(dropped.details).toEqual({ id: ID, tool: "post", reason: "TOOL_ADDED", fingerprint: mcpToolFingerprint(POST) });
    expect(dropped.details).not.toHaveProperty("approvedFingerprint");
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });

    expect(await w.core.checkMcpTools(ID, [])).toEqual([]);
    expect((await w.core.getMcpApprovals(ID)).tools).toEqual([]);
    expect(await w.core.getConsent(ID)).toEqual(consent);
    const again = await expectPlumsError(w.core.authorizeMcpTool(ID, SEARCH), "CONSENT_REQUIRED", "/tools/search");
    expect(again.details).toEqual({ id: ID, tool: "search", reason: "TOOL_ADDED", fingerprint: mcpToolFingerprint(SEARCH) });
    expect(await w.core.checkMcpTools(ID, [SEARCH])).toEqual([
      { tool: "search", fingerprint: mcpToolFingerprint(SEARCH), state: "ADDED" },
    ]);
  });

  it("an empty list drops this server's tool approvals and leaves package consent and other servers", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    await w.core.approveMcpTools(MANUAL, [{ ...SEARCH, level: "read" }]);
    const consent = await w.core.getConsent(ID);
    expect(await w.core.checkMcpTools(ID, [])).toEqual([]);
    expect((await w.core.getMcpApprovals(ID)).tools).toEqual([]);
    expect(await w.core.getConsent(ID)).toEqual(consent);
    expect(await w.core.listInstalled()).toMatchObject([{ id: ID, enabled: true, consented: true }]);
    expect((await w.core.getMcpApprovals(MANUAL)).tools.map((t) => t.tool)).toEqual(["search"]);
  });

  it("a list check that throws leaves every approval in place", async () => {
    const w = await ready({ answers: [true] });
    await w.core.approveMcpTools(ID, [SEARCH, POST]);
    await w.core.approveMcpTools(MANUAL, [{ ...SEARCH, level: "read" }]);
    const before = await w.core.getMcpApprovals(ID);
    const manual = await w.core.getMcpApprovals(MANUAL);
    await expect(w.core.checkMcpTools(ID, [{ ...SEARCH, inputSchema: Number.NaN }])).rejects.toThrow(TypeError);
    await expect(w.core.checkMcpTools(ID, [SEARCH, SEARCH])).rejects.toThrow(TypeError);
    expect(await w.core.getMcpApprovals(ID)).toEqual(before);
    expect(await w.core.getMcpApprovals(MANUAL)).toEqual(manual);
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });
    expect(await w.core.authorizeMcpTool(ID, POST)).toEqual({ level: "write" });
  });

  it("undefined or null is a TypeError and the approvals stay", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH, POST]);
    const before = await w.core.getMcpApprovals(ID);
    const consent = await w.core.getConsent(ID);
    await expect(w.core.checkMcpTools(ID, undefined as never)).rejects.toThrow(TypeError);
    await expect(w.core.checkMcpTools(ID, undefined as never)).rejects.toThrow("MCP tools must be an array");
    await expect(w.core.checkMcpTools(ID, null as never)).rejects.toThrow(TypeError);
    await expect(w.core.checkMcpTools(ID, null as never)).rejects.toThrow("MCP tools must be an array");
    await expect(w.core.approveMcpTools(ID, undefined as never)).rejects.toThrow(TypeError);
    await expect(w.core.approveMcpTools(ID, undefined as never)).rejects.toThrow("MCP tools must be an array");
    await expect(w.core.approveMcpTools(ID, null as never)).rejects.toThrow(TypeError);
    await expect(w.core.approveMcpTools(ID, null as never)).rejects.toThrow("MCP tools must be an array");
    expect(await w.core.getMcpApprovals(ID)).toEqual(before);
    expect(await w.core.getConsent(ID)).toEqual(consent);
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });
  });

  it("a tool that is not in the manifest is skipped and not stored", async () => {
    const w = await ready();
    const before = await snap(w, [ID]);
    const result = await w.core.approveMcpTools(ID, [SEARCH, tool("not-a-tool")]);
    expect(result.skipped).toEqual([{ tool: "not-a-tool", reason: "NOT_DECLARED" }]);
    expect(result.approved.map((a) => a.tool)).toEqual(["search"]);
    expect((await w.core.getMcpApprovals(ID)).tools.map((t) => t.tool)).toEqual(["search"]);
    expect((await snap(w, [ID])).files).toEqual(before.files);
  });

  it("checkMcpTools writes nothing", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    const before = await snap(w, [ID]);
    await w.core.checkMcpTools(ID, [{ ...SEARCH, description: "other" }, POST]);
    expect(await snap(w, [ID])).toEqual(before);
  });

  it("enable and grantConsent do not record fingerprints", async () => {
    const w = world();
    const base = (await w.core.validatePackage(fixture("valid/connector-min.zip"))).manifest;
    await w.core.importPackage(await manifestZip({ ...base, permissions: PERMS }));
    await w.core.grantConsent(ID);
    await w.core.enable(ID);
    expect((await w.core.getMcpApprovals(ID)).tools).toEqual([]);
  });

  it("an update that does not grow permissions keeps the fingerprints", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    const fingerprint = mcpToolFingerprint(SEARCH);
    await w.core.updatePackage(await manifestZip({ ...w.manifest, version: "1.1.0" }));
    expect(await w.core.listInstalled()).toMatchObject([{ id: ID, version: "1.1.0", enabled: true }]);
    expect((await w.core.getMcpApprovals(ID)).tools.map((t) => t.fingerprint)).toEqual([fingerprint]);
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });
  });

  it("uninstall and a fresh import both clear fingerprints, so the tool needs consent again", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    await w.core.uninstall(ID);
    expect(listAll(w.dataDir).some((name) => name.startsWith(`packages/${ID}`))).toBe(false);
    await expectPlumsError(w.core.getMcpApprovals(ID), "PERMISSION_DENIED");

    await w.core.importPackage(await manifestZip(w.manifest));
    expect((await w.core.getMcpApprovals(ID)).tools).toEqual([]);
    await w.core.grantConsent(ID);
    await w.core.enable(ID);
    const err = await expectPlumsError(w.core.authorizeMcpTool(ID, SEARCH), "CONSENT_REQUIRED", "/tools/search");
    expect(err.details).toMatchObject({ reason: "TOOL_ADDED" });
  });

  it("importing an id that is already installed is refused and keeps fingerprints, data and secrets", async () => {
    const w = await ready();
    await w.core.approveMcpTools(ID, [SEARCH]);
    await w.secrets.set(secretRef(ID, "apiKey"), "stay");
    await w.secrets.set("other/key", "other");
    const data = path.join(w.dataDir, "data", ID);
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, "settings.json"), '{"note":"keep"}');
    const before = await snap(w, [ID]);
    const err = await expectPlumsError(w.core.importPackage(await manifestZip(w.manifest)), "IMPORT_INVALID");
    expect(err.details).toEqual({ id: ID, reason: "ALREADY_INSTALLED" });
    expect(await snap(w, [ID])).toEqual(before);
    expect(readFileSync(path.join(data, "settings.json"), "utf8")).toBe('{"note":"keep"}');
    expect(await w.secrets.get(secretRef(ID, "apiKey"))).toBe("stay");
    expect(await w.secrets.get("other/key")).toBe("other");
    expect(await w.core.authorizeMcpTool(ID, SEARCH)).toEqual({ level: "read" });
  });

  it("uninstalling the connector does not clear a hand-added service", async () => {
    const w = await ready();
    await w.core.approveMcpTools(MANUAL, [{ ...SEARCH, level: "read" }]);
    await w.core.uninstall(ID);
    expect(await w.core.getMcpApprovals(MANUAL)).toMatchObject({ unverified: true });
    expect((await w.core.getMcpApprovals(MANUAL)).tools.map((t) => t.tool)).toEqual(["search"]);
    expect(await w.core.authorizeMcpTool(MANUAL, { ...SEARCH, level: "read" })).toEqual({ level: "read" });
  });

  it("uninstall of the hand-added id clears its fingerprints, which are its consent", async () => {
    const w = await ready();
    const read = { ...SEARCH, level: "read" as const };
    await w.core.approveMcpTools(MANUAL, [read]);
    await w.core.uninstall(MANUAL);
    expect((await w.core.getMcpApprovals(MANUAL)).tools).toEqual([]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(MANUAL, read), "CONSENT_REQUIRED", "/tools/search");
    expect(err.details).toMatchObject({ id: MANUAL, reason: "TOOL_ADDED" });
    expect((await w.core.getMcpApprovals(ID)).tools).toEqual([]);
  });
});

describe("hand-added services", () => {
  it("is unverified, and a read tool works only after it is approved", async () => {
    const w = await ready();
    expect(await w.core.getMcpApprovals(MANUAL)).toEqual({ serverId: MANUAL, unverified: true, tools: [] });
    const read = { ...SEARCH, level: "read" as const };
    const before = await snap(w, [MANUAL]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(MANUAL, read), "CONSENT_REQUIRED", "/tools/search");
    expect(err.details).toEqual({ id: MANUAL, tool: "search", reason: "TOOL_ADDED", fingerprint: mcpToolFingerprint(read) });
    expect(await snap(w, [MANUAL])).toEqual(before);
    await w.core.approveMcpTools(MANUAL, [read]);
    expect(await w.core.authorizeMcpTool(MANUAL, read)).toEqual({ level: "read" });
    expect(w.confirm.asked).toEqual([]);
  });

  it("grants a write only when it is named in allowNonRead, and asks every time", async () => {
    const w = await ready({ answers: [true, false] });
    const skipped = await w.core.approveMcpTools(MANUAL, [POST]);
    expect(skipped).toEqual({ approved: [], skipped: [{ tool: "post", reason: "UNVERIFIED_READ_ONLY" }] });
    expect((await w.core.getMcpApprovals(MANUAL)).tools).toEqual([]);

    const granted = await w.core.approveMcpTools(MANUAL, [POST], ["post"]);
    expect(granted.approved.map((a) => a.level)).toEqual(["write"]);
    expect(await w.core.authorizeMcpTool(MANUAL, POST)).toEqual({ level: "write" });
    expect(JSON.stringify(w.confirm.asked)).not.toContain(LEAK);
    await expectPlumsError(w.core.authorizeMcpTool(MANUAL, POST), "CONFIRMATION_DENIED", "/tools/post");
  });

  const bad: [string, (w: World) => Promise<unknown>][] = [
    ["a manual id that is not a package id", (w) => w.core.getMcpApprovals("manual:Bad Name")],
    ["a manual id with no name", (w) => w.core.getMcpApprovals("manual:")],
    ["a tool name with a slash", (w) => w.core.checkMcpTools(MANUAL, [{ name: "a/b", description: "" }])],
    ["an empty tool name", (w) => w.core.checkMcpTools(MANUAL, [{ name: "", description: "" }])],
    ["a tool name longer than 128 characters", (w) => w.core.checkMcpTools(MANUAL, [{ name: "a".repeat(129), description: "" }])],
    ["a tool name listed twice", (w) => w.core.approveMcpTools(MANUAL, [tool("a"), tool("a")])],
    ["a description that is not text", (w) => w.core.checkMcpTools(MANUAL, [{ name: "a", description: 1 as never }])],
    ["an unknown level", (w) => w.core.checkMcpTools(MANUAL, [{ name: "a", description: "", level: "admin" as never }])],
    ["allowNonRead names a tool that is not in the list", (w) => w.core.approveMcpTools(MANUAL, [SEARCH], ["post"])],
  ];
  it("a 128 character name is accepted and does not need pointer escaping", async () => {
    const w = await ready();
    const name = `n${"a".repeat(127)}`;
    const read = tool(name, `${LEAK} long`, "read");
    expect(await w.core.checkMcpTools(MANUAL, [read])).toEqual([
      { tool: name, fingerprint: mcpToolFingerprint(read), state: "ADDED" },
    ]);
    const err = await expectPlumsError(w.core.authorizeMcpTool(MANUAL, read), "CONSENT_REQUIRED", `/tools/${name}`);
    expect(err.details).toMatchObject({ tool: name, reason: "TOOL_ADDED" });
  });

  it.each(bad)("%s is a TypeError and writes nothing", async (_name, call) => {
    const w = await ready();
    const before = await snap(w, [ID, MANUAL]);
    await expect(call(w)).rejects.toThrow(TypeError);
    expect(await snap(w, [ID, MANUAL])).toEqual(before);
  });
});

describe("read-only methods share the server check", () => {
  const methods = ["checkMcpTools", "approveMcpTools", "getMcpApprovals"] as const;
  it("check, approve and getApprovals on an id that is not installed are PERMISSION_DENIED and write nothing", async () => {
    for (const method of methods) {
      const w = await ready();
      const before = await snap(w, [ID]);
      const err = await expectPlumsError(w.core[method]("missing.pack", []), "PERMISSION_DENIED");
      expect(err.path).toBeUndefined();
      expect(err.details).toEqual({ id: "missing.pack", reason: "NOT_INSTALLED" });
      expect(await snap(w, [ID])).toEqual(before);
    }
  });
});
