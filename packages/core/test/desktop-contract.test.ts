import { SCHEMA_VERSION } from "../src/install/store.js";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  secretRef,
  type ManifestV2,
  type Core,
} from "../src/index.js";
const dirs: string[] = [];
const cores: Core[] = [];
afterEach(async () => {
  cores.forEach((c) => c.close());
  cores.length = 0;
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(
  confirm = async () => true,
  audit = async (_e: unknown) => {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-desktop-core-"));
  dirs.push(dir);
  await mkdir(path.join(dir, "workspace"));
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink(),
    fs = new RecordingFsSink();
  const core = createCore({
    dataDir: dir,
    secrets,
    egress,
    fs,
    roots: { workspace: path.join(dir, "workspace") },
    confirm: { ask: confirm },
    onAudit: audit,
  });
  cores.push(core);
  return { core, dir, secrets, egress, fs };
}
const manifest = (
  id: string,
  kind: "extension" | "connector" = "extension",
): ManifestV2 => ({
  formatVersion: "2.0",
  kind,
  id,
  name: id,
  version: "1.0.0",
  description: "test",
  dependencies: [],
  permissions: [
    {
      id: "files",
      kind: "fs",
      target: "workspace",
      reason: "workspace",
      operations: ["list", "write"],
    },
    {
      id: "send",
      kind: "egress",
      target: "api.example.com",
      reason: "request",
    },
  ],
  payload: {},
});
async function install(core: Core, m: ManifestV2) {
  await core.importPackage(await core.exportPackage({ manifest: m }));
  await core.grantConsent(m.id);
  await core.enable(m.id);
}
describe("desktop public contracts", () => {
  it.each(["confirmation", "allow"])(
    "awaits the trusted delegation checkpoint after %s and refuses stale edges",
    async (phase) => {
      let active = true;
      const f = await fixture(
        async () => {
          if (phase === "confirmation") active = false;
          return true;
        },
        async (e) => {
          if (phase === "allow" && (e as { phase: string }).phase === "allow") {
            await Promise.resolve();
            active = false;
          }
        },
      );
      await install(f.core, manifest("worker"));
      await install(f.core, manifest("caller"));
      await expect(
        f.core.runDelegatedCapability(
          {
            packageId: "worker",
            permissionId: "files",
            callers: [{ packageId: "caller", permissionId: "files" }],
            request: {
              kind: "fs",
              operation: "write",
              path: "checkpoint.txt",
              data: new Uint8Array([1]),
            },
          },
          async () => {
            await Promise.resolve();
            if (!active)
              throw new (await import("../src/errors.js")).PlumsError({
                code: "PERMISSION_DENIED",
                message: "Concrete edge changed",
              });
          },
        ),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(f.fs.records).toHaveLength(0);
    },
  );
  it("creates a core without a model and describes secrets without values or refs", async () => {
    const { core, secrets } = await fixture();
    const m = manifest("settings");
    m.settingsSchema = {
      type: "object",
      properties: {
        key: {
          type: "string",
          title: "Key",
          description: "Key",
          "x-secret": true,
        },
        label: {
          type: "string",
          title: "Label",
          description: "Label",
          default: "hello",
        },
      },
    };
    await install(core, m);
    await secrets.set(secretRef(m.id, "key"), "private-value");
    await core.setSettings(m.id, { key: secretRef(m.id, "key") });
    expect((await core.getPackage(m.id)).manifest).toEqual(m);
    expect(await core.describeSettings(m.id)).toEqual({
      schema: m.settingsSchema,
      values: { label: "hello" },
      secrets: { key: true },
    });
  });
  it("checks every caller and blocks a changed caller after async audit", async () => {
    let core: Core;
    let change = false;
    const f = await fixture(
      async () => true,
      async (e) => {
        if (change && (e as { phase: string }).phase === "allow")
          await core.disable("caller");
      },
    );
    core = f.core;
    await install(core, manifest("worker"));
    await install(core, manifest("caller"));
    change = true;
    await expect(
      core.runDelegatedCapability({
        packageId: "worker",
        permissionId: "files",
        callers: [{ packageId: "caller", permissionId: "files" }],
        request: { kind: "fs", operation: "list", path: "." },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.fs.records).toHaveLength(0);
  });
  it("does not borrow a callee permission and snapshots headers", async () => {
    const { core, egress } = await fixture();
    await install(core, manifest("worker"));
    const caller = manifest("caller");
    caller.permissions = [];
    await install(core, caller);
    await expect(
      core.runDelegatedCapability({
        packageId: "worker",
        permissionId: "send",
        callers: [{ packageId: "caller", permissionId: "send" }],
        request: {
          kind: "egress",
          url: "https://api.example.com",
          headers: { Accept: "application/json" },
        },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(egress.records).toHaveLength(0);
  });
  it("preserves legacy data across migration 4 to current schema and invalidates removed MCP tools", async () => {
    const { core, dir } = await fixture();
    await install(core, manifest("remote", "connector"));
    const tool = {
      name: "lookup",
      description: "lookup",
      inputSchema: { type: "object" },
    };
    await core.approveMcpToolsV2("remote", "send", [tool]);
    await core.authorizeMcpToolV2("remote", "send", tool);
    await core.checkMcpToolsV2("remote", []);
    await expect(
      core.authorizeMcpToolV2("remote", "send", tool),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    const before = await core.getConsent("remote");
    core.close();
    const db = new Database(path.join(dir, "plums.db"));
    db.exec("DROP TABLE mcp_tools_v2");
    db.pragma("user_version = 4");
    db.close();
    expect(await core.getConsent("remote")).toEqual(before);
    expect((await core.listInstalled())[0]?.enabled).toBe(true);
    core.close();
    const check = new Database(path.join(dir, "plums.db"));
    expect(check.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    check.close();
  });
});
it("snapshots egress headers and MCP schema before an asynchronous confirmation", async () => {
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    ready = new Promise<void>((r) => {
      entered = r;
    });
  const { core, egress } = await fixture(async () => {
    entered();
    await gate;
    return true;
  });
  await install(core, manifest("remote", "connector"));
  const tool = {
    name: "tool",
    description: "safe",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
  };
  await core.approveMcpToolsV2("remote", "send", [tool]);
  const input = {
    packageId: "remote",
    permissionId: "send",
    callers: [],
    request: {
      kind: "egress" as const,
      url: "https://api.example.com",
      headers: { Accept: "application/json" },
      stream: true,
    },
    mcpTool: tool,
  };
  const call = core.runDelegatedCapability(input);
  await ready;
  input.request.headers.Accept = "changed";
  tool.inputSchema.properties.q.type = "number";
  release();
  await call;
  expect(egress.records[0]?.headers).toEqual({ Accept: "application/json" });
  expect(egress.records[0]?.stream).toBe(true);
});
it("requires current MCP approval again after confirmation and blocks every sink", async () => {
  let core: Core;
  const f = await fixture(async () => {
    await core.checkMcpToolsV2("remote", []);
    return true;
  });
  core = f.core;
  await install(core, manifest("remote", "connector"));
  const tool = {
    name: "tool",
    description: "safe",
    inputSchema: { type: "object" },
  };
  await core.approveMcpToolsV2("remote", "send", [tool]);
  await expect(
    core.runDelegatedCapability({
      packageId: "remote",
      permissionId: "send",
      callers: [],
      request: { kind: "egress", url: "https://api.example.com" },
      mcpTool: tool,
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.egress.records).toHaveLength(0);
});
