import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  createCore,
  type ManifestV2,
  type AuditEvent,
  type Grant,
} from "@plums/core";
import {
  createAgentBundle,
  validateAgentBundle,
  type DesktopContribution,
  type ProtocolBindingIntent,
} from "@plums/sdk";
import { DesktopHost } from "../src/host.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const protocol = "org.example.store";
const fsPermission = {
  id: "data",
  kind: "fs" as const,
  target: "agent-data",
  operations: ["read", "write"] as ("read" | "write")[],
  reason: "Fixture data",
};
const httpsPermission = {
  id: "send",
  kind: "service" as const,
  target: "https",
  operations: ["request"],
  reason: "Fixture request",
};
const engineCode = `import{createInterface}from'node:readline';let next=0;const pending=new Map;const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize'){send({id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}});return;}if(m.method==='$/cancelRequest'){for(const [id,task] of pending)if(task===m.params.id){send({method:'$/cancelRequest',params:{id}});pending.delete(id);}send({id:m.params.id,result:{cancelled:true}});return;}if(pending.has(m.id)){const task=pending.get(m.id);pending.delete(m.id);send({id:task,result:m.error?{refused:m.error.data}:m.result});return;}const id='callback-'+(++next);pending.set(id,m.id);send({id,method:m.method==='status'?'host.protocolStatus':m.method==='legacy'?'host.invoke':m.method==='grant'?'host.grant':'host.invokeProtocol',params:m.params});});`;
async function archive(
  id: string,
  c: DesktopContribution,
  code: string,
  permissions: ManifestV2["permissions"] = [],
  extra: Partial<ManifestV2> = {},
  files: Record<string, Uint8Array> = {},
) {
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id,
    name: id,
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions,
    payload: { plumsDesktop: c },
    ...extra,
  };
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "main.js": Buffer.from(code),
    ...files,
  });
}
const provide = (
  version = "1.0.0",
  features = ["read", "write"],
): DesktopContribution => ({
  sdkVersion: "2",
  runtime: "main.js",
  contributes: { tools: [{ name: "store", title: "Fixture store" }] },
  protocols: {
    provides: [
      {
        id: "store",
        protocol,
        version,
        features,
        contribution: { kind: "tools", name: "store" },
      },
    ],
  },
});
const consumer = (optional = true): DesktopContribution => ({
  sdkVersion: "2",
  runtime: "main.js",
  contributes: {
    commands: [
      { name: "run", title: "Run" },
      { name: "status", title: "Status" },
      { name: "legacy", title: "Legacy" },
      { name: "raw", title: "Raw" },
    ],
  },
  protocols: {
    requires: [
      {
        id: "store",
        protocol,
        range: "^1.0.0",
        features: ["read", "write"],
        optional,
      },
    ],
  },
});
const callerCode = `export function activate(s){s.register('commands','run',v=>s.protocols.invoke('store',v));s.register('commands','status',()=>s.protocols.status('store'));s.register('commands','legacy',v=>s.invoke('a','tools','store',v));s.register('commands','raw',v=>s.protocols.invoke(v.requirementId,v.input));}`;
async function fixture(
  options: {
    required?: boolean;
    noPermission?: boolean;
    https?: boolean;
    engine?: boolean;
    legacy?: boolean;
  } = {},
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-protocol-routing-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>(),
    fs = new RecordingFsSink(),
    egress = new RecordingEgressSink(),
    confirm = { ask: vi.fn(async () => true) },
    audit: AuditEvent[] = [];
  let auditHook: (e: Readonly<AuditEvent>) => Promise<void> = async () => {};
  const hostOptions = {
    dataDir: dir,
    fs,
    egress,
    confirm,
    secretStore: (id: string) => {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    audit: async (_id: string, e: Readonly<AuditEvent>) => {
      audit.push(e);
      await auditHook(e);
    },
    grantConfirm: async (r: any) => ({
      reads: r.reads.map((x: any) => x.id),
      outputs: r.outputs.map((x: any) => x.id),
      durationMs: 900000,
    }),
  };
  const host = new DesktopHost(hostOptions);
  hosts.push(host);
  await host.initialize();
  const p = options.https ? httpsPermission : fsPermission;
  const providerCode = options.https
    ? `export function activate(s){s.register('tools','store',async v=>{const b=await s.connection('api');return s.capability('send',{kind:'service',operation:'request',binding:b.binding,sources:[],input:{path:'/fixture',body:JSON.stringify(v)}});});}`
    : `export function activate(s){s.register('tools','store',async v=>v.operation==='echo'?{provider:'PROVIDER',value:v.value}:s.capability('data',v));}`;
  const bytes: Record<string, Uint8Array> = {};
  for (const [id, version, features] of [
    ["a", "1.0.0", ["read", "write"]],
    ["b", "1.2.0", ["read", "write"]],
    ["v2", "2.0.0", ["read", "write"]],
    ["limited", "1.0.0", ["read"]],
  ] as const) {
    const c = provide(version, [...features]);
    const extra: Partial<ManifestV2> = {};
    if (options.https) {
      extra.kind = "connector";
      extra.settingsSchema = {
        type: "object",
        properties: {
          endpoint: {
            type: "string",
            title: "Endpoint",
            description: "Endpoint",
            default: "https://fixture.example",
          },
          key: {
            type: "string",
            title: "Key",
            description: "Key",
            "x-secret": true,
          },
        },
      };
      c.connections = [
        {
          id: "api",
          permissionId: "send",
          baseURLSetting: "endpoint",
          credentials: [
            { setting: "key", header: "Authorization", prefix: "Bearer " },
          ],
        },
      ];
    }
    bytes[id] = await archive(
      id,
      c,
      providerCode.replace("PROVIDER", id),
      [p],
      extra,
    );
  }
  const c = consumer(!options.required);
  const extra: Partial<ManifestV2> = {
    dependencies: options.legacy
      ? [
          {
            id: "a",
            kind: options.https ? "connector" : "extension",
            range: "^1.0.0",
          },
        ]
      : [],
  };
  const permissions: ManifestV2["permissions"] = options.noPermission
    ? []
    : [p];
  const files: Record<string, Uint8Array> = {};
  if (options.engine) {
    permissions.push({
      id: "engine",
      kind: "engine",
      target: "local",
      reason: "Fixture engine",
    });
    c.engines = [
      {
        id: "local",
        title: "Fixture engine",
        entry: "engine.mjs",
        runtime: "node",
        platforms: [`${process.platform}-${process.arch}`],
        protocol: "jsonrpc-jsonl-v1",
        grantResources: {
          reads: [{ id: "conversation", title: "Conversation" }],
          outputs: [{ id: "reply", title: "Reply" }],
        },
      },
    ];
    files["engine.mjs"] = Buffer.from(engineCode);
  }
  bytes.lesson = await archive(
    "lesson",
    c,
    callerCode,
    permissions,
    extra,
    files,
  );
  const digests: string[] = [];
  for (const b of Object.values(bytes)) {
    const preview = (await host.preview(b)) as { token: string };
    digests.push((await host.importLibrary(preview.token)).digest);
  }
  const plan = await host.planAssembly(digests),
    choice = plan.protocols
      .find((s) => s.consumerId === "lesson")!
      .candidates.find((c) => c.intent.providerId === "a")!.intent;
  const record = await host.createAgent(
      "Fixture",
      digests,
      undefined,
      undefined,
      options.required ? [choice] : [],
    ),
    id = record.instanceId;
  const bind = async (provider = "a", agent = id) => {
    const plan = await host.protocolPlan(agent);
    const s = plan.requirements.find((s) => s.consumerId === "lesson")!;
    const choice = s.candidates.find(
      (c) => c.intent.providerId === provider,
    )!.intent;
    await host.setProtocolBinding(
      agent,
      plan.fingerprint,
      "lesson",
      "store",
      choice,
    );
    return choice;
  };
  if (options.https)
    for (const id2 of [id])
      for (const pkg of ["a", "b", "v2", "limited"])
        await host.setSettings(
          id2,
          pkg,
          { endpoint: "https://fixture.example" },
          { key: "fake-protocol-key" },
        );
  for (const pkg of ["a", "b", "v2", "limited", "lesson"])
    await host.enable(id, pkg);
  const invoke = (name: string, input: unknown = {}) =>
    host.invoke(id, "lesson", "lesson", "commands", name, input);
  const echo = { operation: "echo", value: "fixture" };
  return {
    host,
    id,
    dir,
    stores,
    fs,
    egress,
    confirm,
    audit,
    bind,
    invoke,
    echo,
    bytes,
    digests,
    choice,
    hostOptions,
    setAudit: (fn: typeof auditHook) => (auditHook = fn),
  };
}

it("discovers only the current Agent, explains incompatible candidates and never auto-selects", async () => {
  const f = await fixture();
  const plan = await f.host.protocolPlan(f.id),
    s = plan.requirements[0]!;
  expect(s.state).toBe("choose");
  expect(s.candidates.filter((c) => c.compatibility.compatible)).toHaveLength(
    2,
  );
  expect(
    s.candidates.find((c) => c.intent.providerId === "v2")?.compatibility,
  ).toEqual({ compatible: false, reason: "VERSION_MISMATCH" });
  expect(
    s.candidates.find((c) => c.intent.providerId === "limited")?.compatibility,
  ).toEqual({
    compatible: false,
    reason: "FEATURES_MISSING",
    missingFeatures: ["write"],
  });
  expect(await f.invoke("status")).toMatchObject({
    state: "unbound",
    optional: true,
  });
  await expect(f.invoke("run", f.echo)).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    details: { reason: "PROTOCOL_UNBOUND" },
  });
  await expect(f.invoke("legacy", f.echo)).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  const only = await f.host.createAgent("Consumer only", [f.digests.at(-1)!]);
  expect(
    (await f.host.protocolPlan(only.instanceId)).requirements[0]?.state,
  ).toBe("missing");
  await expect(
    f.host.setProtocolBinding(
      only.instanceId,
      plan.fingerprint,
      "lesson",
      "store",
      f.choice,
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
it("fixes the user's choice across host restart and serializes no authorization in the portable ZIP", async () => {
  const f = await fixture();
  await f.bind("b");
  expect(await f.invoke("run", f.echo)).toEqual({
    provider: "b",
    value: "fixture",
  });
  const saved = JSON.parse(
    await readFile(path.join(f.dir, "instances", f.id, "record.json"), "utf8"),
  );
  expect(saved.protocolBindings[0]).toMatchObject({
    agentId: f.id,
    providerId: "b",
    providerInstalledAt: expect.any(String),
    providerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await f.host.close();
  const restored = new DesktopHost(f.hostOptions);
  hosts.push(restored);
  await restored.initialize();
  expect(
    await restored.invokeProtocol(f.id, "lesson", "store", f.echo),
  ).toEqual({ provider: "b", value: "fixture" });
  const bytes = await restored.exportAgent(f.id),
    bundle = await validateAgentBundle(bytes),
    portable = bundle.agent.protocolBindings![0]!;
  expect(Object.keys(portable).sort()).toEqual(
    [
      "consumerId",
      "consumerDigest",
      "requirementId",
      "providerId",
      "providerDigest",
      "provideId",
      "protocolVersion",
      "contribution",
    ].sort(),
  );
  expect(JSON.stringify(bundle.agent)).not.toContain(f.id);
  const imported = await restored.install(
    ((await restored.preview(bytes)) as { token: string }).token,
  );
  expect(imported.protocolBindings![0]).toMatchObject({
    agentId: imported.instanceId,
    providerId: "b",
  });
  await expect(
    restored.invokeProtocol(imported.instanceId, "lesson", "store", f.echo),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await restored.enableAgent(
    imported.instanceId,
    (await restored.agentEnablePlan(imported.instanceId)).fingerprint,
  );
  expect(
    await restored.invokeProtocol(
      imported.instanceId,
      "lesson",
      "store",
      f.echo,
    ),
  ).toEqual({ provider: "b", value: "fixture" });
});
it("requires explicit compatible choices at creation and enable, with providers enabled first", async () => {
  const f = await fixture({ required: true });
  await expect(f.host.createAgent("Missing", f.digests)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    details: { reason: "PROTOCOL_BINDING_REQUIRED" },
  });
  await f.host.setProtocolBinding(
    f.id,
    (await f.host.protocolPlan(f.id)).fingerprint,
    "lesson",
    "store",
  );
  await f.host.disable(f.id, "lesson");
  await expect(f.host.enable(f.id, "lesson")).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  const plan = await f.host.agentEnablePlan(f.id);
  expect(plan.missingProtocols).toHaveLength(1);
  await expect(
    f.host.enableAgent(f.id, plan.fingerprint),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await f.bind();
  await f.host.disable(f.id, "a");
  await expect(f.host.enable(f.id, "lesson")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    details: { reason: "PROTOCOL_PROVIDER_DISABLED" },
  });
  await f.host.enableAgent(
    f.id,
    (await f.host.agentEnablePlan(f.id)).fingerprint,
  );
  expect(await f.invoke("run", f.echo)).toMatchObject({ provider: "a" });
});
it("keeps the same choice on configuration, key, directory and composition rebuild; updates require reselection", async () => {
  const f = await fixture();
  await f.bind();
  await f.host.editAgent(f.id, "Renamed");
  expect(await f.invoke("run", f.echo)).toMatchObject({ provider: "a" });
  const root = path.join(f.dir, "..", path.basename(f.dir) + "-root");
  dirs.push(root);
  await mkdir(root);
  await f.host.bindRoot(f.id, "work", root);
  expect(await f.invoke("run", f.echo)).toMatchObject({ provider: "a" });
  await f.host.unbindRoot(f.id, "work");
  await f.host.disable(f.id, "a");
  expect(await f.invoke("status")).toMatchObject({ state: "disabled" });
  await expect(f.invoke("run", f.echo)).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await f.host.enable(f.id, "a");
  const upgraded = await archive(
    "a",
    provide(),
    `export function activate(s){s.register('tools','store',()=>({provider:'upgraded'}));}`,
    [fsPermission],
    { version: "1.1.0" },
  );
  await f.host.updatePackage(
    f.id,
    ((await f.host.previewComponent(f.id, upgraded)) as { token: string })
      .token,
    "a",
    true,
  );
  expect(await f.invoke("status")).toMatchObject({ state: "stale" });
  await expect(f.invoke("run", f.echo)).rejects.toMatchObject({
    details: { reason: "PROTOCOL_BINDING_STALE" },
  });
  await f.bind();
  expect(await f.invoke("run", f.echo)).toMatchObject({ provider: "upgraded" });
  await f.host.uninstallPackage(f.id, "a");
  expect(await f.invoke("status")).toMatchObject({ state: "stale" });
  await f.host.addLibraryComponent(f.id, f.choice.providerDigest);
  await f.host.enable(f.id, "a");
  expect(await f.invoke("status")).toMatchObject({ state: "stale" });
});
it.each([false, true])(
  "enforces permission intersection on %s legacy edge and keeps contents out of audit",
  async (legacy) => {
    const f = await fixture({ legacy, noPermission: true });
    if (!legacy) await f.bind();
    await expect(
      f.invoke(legacy ? "legacy" : "run", {
        kind: "fs",
        operation: "write",
        path: "record.txt",
        data: [1, 2, 3],
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.fs.records).toHaveLength(0);
  },
);
it.each([false, true])(
  "rechecks %s legacy edge after confirmation and asynchronous allow audit",
  async (legacy) => {
    const f = await fixture({ legacy });
    if (!legacy) await f.bind();
    const request = {
      kind: "fs",
      operation: "write",
      path: "record.txt",
      data: [1, 2, 3],
    };
    f.confirm.ask.mockResolvedValueOnce(false);
    await expect(
      f.invoke(legacy ? "legacy" : "run", request),
    ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
    expect(f.fs.records).toHaveLength(0);
    f.setAudit(async (e) => {
      if (e.phase === "allow" && e.kind === "fs")
        await f.host.disable(f.id, "a");
    });
    await expect(
      f.invoke(legacy ? "legacy" : "run", request),
    ).rejects.toBeDefined();
    expect(f.fs.records).toHaveLength(0);
    const audit = JSON.stringify(f.audit);
    expect(audit).not.toContain("record.txt");
    expect(audit).not.toContain("1,2,3");
  },
);
it("checks task expiration and revocation on bound routes without dropping read confirmation", async () => {
  const f = await fixture();
  await f.bind();
  const request = {
    kind: "fs",
    operation: "write",
    path: "record.txt",
    data: [1],
  };
  const plan = await f.host.taskScopePlan(f.id);
  await f.host.grantTaskScope(
    f.id,
    plan.fingerprint,
    900000,
    plan.entries
      .filter((p: any) => ["lesson", "a"].includes(p.packageId))
      .flatMap((p: any) =>
        p.permissions.map((permission: any) => ({
          packageId: p.packageId,
          permissionId: permission.id,
          operation: "write",
        })),
      ),
  );
  expect(await f.invoke("run", request)).toMatchObject({ completed: true });
  expect(f.confirm.ask).toHaveBeenCalledTimes(0);
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 900001);
  f.confirm.ask.mockResolvedValueOnce(false);
  await expect(f.invoke("run", request)).rejects.toMatchObject({
    code: "CONFIRMATION_DENIED",
  });
  clock.mockRestore();
  await f.host.revokeTaskScope(f.id);
  f.confirm.ask.mockResolvedValueOnce(false);
  await expect(f.invoke("run", request)).rejects.toMatchObject({
    code: "CONFIRMATION_DENIED",
  });
  expect(f.fs.records).toHaveLength(1);
  await writeFile(
    path.join(f.dir, "instances", f.id, "agent-data", "record.txt"),
    "fixture",
  );
  f.confirm.ask.mockResolvedValueOnce(false);
  await expect(
    f.invoke("run", { kind: "fs", operation: "read", path: "record.txt" }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
});
it("prevents a copied local binding from authorizing another Agent and rejects undeclared requirement ids", async () => {
  const f = await fixture();
  await f.bind();
  const other = await f.host.createAgent("Other", f.digests);
  const a = JSON.parse(
      await readFile(
        path.join(f.dir, "instances", f.id, "record.json"),
        "utf8",
      ),
    ),
    file = path.join(f.dir, "instances", other.instanceId, "record.json"),
    b = JSON.parse(await readFile(file, "utf8"));
  b.protocolBindings = a.protocolBindings;
  await writeFile(file, JSON.stringify(b));
  for (const pkg of ["a", "lesson"]) await f.host.enable(other.instanceId, pkg);
  expect(
    await f.host.protocolStatus(other.instanceId, "lesson", "store"),
  ).toMatchObject({ state: "stale" });
  await expect(
    f.host.invokeProtocol(other.instanceId, "lesson", "store", f.echo),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    f.invoke("raw", { requirementId: "forged", input: f.echo }),
  ).rejects.toMatchObject({
    details: { reason: "PROTOCOL_REQUIREMENT_NOT_DECLARED" },
  });
});
it("runs a protocol connector through controlled HTTPS and rebuilds after settings/key changes", async () => {
  const f = await fixture({ https: true });
  await f.bind();
  await f.host.enable(f.id, "lesson");
  expect(await f.invoke("run", { text: "private fixture body" })).toMatchObject(
    { kind: "service" },
  );
  expect(f.egress.records).toHaveLength(1);
  expect(f.egress.records[0]?.headers?.Authorization).toBe(
    "Bearer fake-protocol-key",
  );
  await f.host.setSettings(
    f.id,
    "a",
    { endpoint: "https://changed.example" },
    { key: "fake-replaced-key" },
  );
  await f.host.enable(f.id, "a");
  await f.host.enable(f.id, "lesson");
  expect(await f.invoke("run", {})).toMatchObject({ kind: "service" });
  expect(f.egress.records[1]?.url).toBe("https://changed.example/fixture");
  expect(JSON.stringify(f.audit)).not.toMatch(
    /private fixture body|fake-protocol-key|fake-replaced-key/,
  );
});
it("supports real engine protocol callbacks and finite Grant authority, with no implicit legacy edge", async () => {
  const f = await fixture({ https: true, engine: true });
  await f.bind();
  await f.host.enable(f.id, "lesson");
  {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["lesson"],
    };
    const plan = await f.host.tierPlan(f.id, selection);
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
  }
  await f.host.startEngine(f.id, "lesson", "local");
  const call = (method: string, input: unknown) =>
    f.host.engineCall(f.id, "lesson", "request", {
      engineId: "local",
      method,
      input,
    });
  expect(await call("status", { requirementId: "store" })).toMatchObject({
    state: "available",
    providerId: "a",
  });
  expect(
    await call("legacy", {
      packageId: "a",
      kind: "tools",
      name: "store",
      input: {},
    }),
  ).toMatchObject({ refused: { code: "PERMISSION_DENIED" } });
  for (const requirementPath of [
    [],
    ["missing"],
    ["store", "store"],
    Array(16).fill("store"),
    [123],
  ]) {
    expect(
      await call("grant", {
        action: "request",
        requirementPath,
        connectionId: "api",
        reads: ["conversation"],
        outputs: ["reply"],
      }),
    ).toMatchObject({ refused: { code: "PERMISSION_DENIED" } });
  }
  expect(
    await call("grant", {
      action: "request",
      requirementPath: ["store"],
      requirementId: "store",
      connectionId: "api",
      reads: [],
      outputs: [],
    }),
  ).toMatchObject({ refused: { code: "PERMISSION_DENIED" } });
  const pathGrant = (await call("grant", {
    action: "request",
    requirementPath: ["store"],
    connectionId: "api",
    reads: ["conversation"],
    outputs: ["reply"],
  })) as Grant;
  expect(pathGrant.scope.services.map((s) => s.packageId).sort()).toEqual([
    "a",
    "lesson",
  ]);
  await call("grant", { action: "revoke", grantId: pathGrant.id });
  const grant = (await call("grant", {
    action: "request",
    requirementId: "store",
    connectionId: "api",
    reads: ["conversation"],
    outputs: ["reply"],
  })) as Grant;
  expect(grant).toHaveProperty("id");
  const before = f.confirm.ask.mock.calls.length;
  const input = {
    requirementId: "store",
    input: { text: "engine body" },
    grantId: grant.id,
    grantScope: { reads: ["conversation"], outputs: ["reply"] },
  };
  expect(await call("work", input)).toMatchObject({ kind: "service" });
  expect(f.confirm.ask).toHaveBeenCalledTimes(before);
  await f.host.revokeTaskScope(f.id);
  expect(await call("work", input)).toMatchObject({ kind: "service" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(grant.expiresAt + 1);
  expect(await call("work", input)).toMatchObject({
    refused: { code: "PERMISSION_DENIED" },
  });
  clock.mockRestore();
  await call("grant", { action: "revoke", grantId: grant.id });
  expect(await call("work", input)).toMatchObject({
    refused: { code: "PERMISSION_DENIED" },
  });
  expect(f.egress.records).toHaveLength(2);
  expect(JSON.stringify(f.audit)).not.toMatch(/engine body|fake-protocol-key/);
  const secondGrant = (await call("grant", {
    action: "request",
    requirementId: "store",
    connectionId: "api",
    reads: ["conversation"],
    outputs: ["reply"],
  })) as Grant;
  await f.bind();
  {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["lesson"],
    };
    const plan = await f.host.tierPlan(f.id, selection);
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
  }
  await f.host.startEngine(f.id, "lesson", "local");
  expect(
    await call("work", { ...input, grantId: secondGrant.id }),
  ).toMatchObject({ refused: { code: "PERMISSION_DENIED" } });
  await f.host.revokeEngine(f.id, "lesson", "local");
  await expect(call("work", input)).rejects.toMatchObject({
    code: "LOCAL_CONFIRM_REQUIRED",
  });
});
it("cancels an outstanding engine protocol callback before its capability reaches the sink", async () => {
  const f = await fixture({ engine: true });
  await f.bind();
  {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["lesson"],
    };
    const plan = await f.host.tierPlan(f.id, selection);
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
  }
  await f.host.startEngine(f.id, "lesson", "local");
  let release!: (v: boolean) => void;
  let ready!: () => void;
  const confirmationReady = new Promise<void>((r) => (ready = r));
  f.confirm.ask.mockImplementation(
    async () =>
      new Promise<boolean>((r) => {
        release = r;
        ready();
      }),
  );
  const work = f.host.engineCall(f.id, "lesson", "request", {
    engineId: "local",
    method: "work",
    requestId: "cancel-fixture",
    input: {
      requirementId: "store",
      input: { kind: "fs", operation: "write", path: "record.txt", data: [1] },
    },
  });
  await confirmationReady;
  expect(release).toBeTypeOf("function");
  await f.host.engineCall(f.id, "lesson", "cancel", {
    engineId: "local",
    requestId: "cancel-fixture",
  });
  expect(await work).toEqual({ cancelled: true });
  release(true);
  await vi.waitFor(() =>
    expect(f.audit.some((e) => e.phase === "denied")).toBe(true),
  );
  expect(f.fs.records).toHaveLength(0);
});

it("preserves every principal across mixed protocol and concrete dependency edges and rejects cycles", async () => {
  const f = await fixture({ noPermission: true });
  const middle = consumer();
  middle.protocols!.provides = [
    {
      id: "store",
      protocol,
      version: "1.0.0",
      features: ["read", "write"],
      contribution: { kind: "commands", name: "run" },
    },
  ];
  const bytes = await archive(
    "middle",
    middle,
    `export function activate(s){s.register('commands','run',v=>s.invoke('a','tools','store',v));}`,
    [fsPermission],
    { dependencies: [{ id: "a", kind: "extension", range: "^1.0.0" }] },
  );
  await f.host.addLibraryComponent(
    f.id,
    (
      await f.host.importLibrary(
        ((await f.host.preview(bytes)) as { token: string }).token,
      )
    ).digest,
  );
  await f.host.enable(f.id, "middle");
  const p = await f.host.protocolPlan(f.id),
    s = p.requirements.find((s) => s.consumerId === "lesson")!,
    choice = s.candidates.find((c) => c.intent.providerId === "middle")!.intent;
  await f.host.setProtocolBinding(
    f.id,
    p.fingerprint,
    "lesson",
    "store",
    choice,
  );
  await expect(
    f.invoke("run", {
      kind: "fs",
      operation: "write",
      path: "record.txt",
      data: [1],
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(f.fs.records).toHaveLength(0);
  // A required concrete edge middle -> a plus a protocol edge a -> middle cannot be published.
  const a = provide();
  a.protocols!.requires = [
    { id: "back", protocol, range: "^1.0.0", optional: true },
  ];
  const upgrade = await archive(
    "a",
    a,
    `export function activate(s){s.register('tools','store',v=>s.protocols.invoke('back',v));}`,
    [fsPermission],
    { version: "1.1.0" },
  );
  await f.host.updatePackage(
    f.id,
    ((await f.host.previewComponent(f.id, upgrade)) as { token: string }).token,
    "a",
    true,
  );
  const cyclePlan = await f.host.protocolPlan(f.id),
    back = cyclePlan.requirements.find((s) => s.consumerId === "a")!;
  await expect(
    f.host.setProtocolBinding(
      f.id,
      cyclePlan.fingerprint,
      "a",
      "back",
      back.candidates.find((c) => c.intent.providerId === "middle")!.intent,
    ),
  ).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    details: { reason: "PROTOCOL_CYCLE" },
  });
  expect(
    (await f.host.protocolPlan(f.id)).requirements.find(
      (s) => s.consumerId === "a",
    )!.selected,
  ).toBeUndefined();
});

it("rejects engine callbacks with missing caller permissions before any execution", async () => {
  const f = await fixture({ engine: true, noPermission: true });
  await f.bind();
  {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["lesson"],
    };
    const plan = await f.host.tierPlan(f.id, selection);
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
  }
  await f.host.startEngine(f.id, "lesson", "local");
  const work = () =>
    f.host.engineCall(f.id, "lesson", "request", {
      engineId: "local",
      method: "work",
      input: {
        requirementId: "store",
        input: {
          kind: "fs",
          operation: "write",
          path: "record.txt",
          data: [1],
        },
      },
    });
  expect(await work()).toMatchObject({
    refused: { code: "PERMISSION_DENIED", executionState: "not_started" },
  });
  expect(f.fs.records).toHaveLength(0);
});

it("copies invocation input before the first wait and catches external disable/enable changes during confirmation", async () => {
  const f = await fixture();
  await f.bind();
  const input = { ...f.echo },
    work = f.invoke("run", input);
  input.value = "changed after dispatch";
  expect(await work).toEqual({ provider: "a", value: "fixture" });
  const other = createCore({
    dataDir: path.join(f.dir, "instances", f.id, "core"),
    secrets: f.stores.get(f.id)!,
    egress: f.egress,
  });
  try {
    f.confirm.ask.mockImplementation(async () => {
      await other.disable("a");
      await other.enable("a");
      return true;
    });
    await expect(
      f.invoke("run", {
        kind: "fs",
        operation: "write",
        path: "record.txt",
        data: [1],
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.fs.records).toHaveLength(0);
  } finally {
    other.close();
  }
});

it.each(["run", "legacy"])(
  "preserves the authorization denial on the %s edge when confirmation crosses watchdog checks",
  async (name) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const f = await fixture({ legacy: true });
    await f.bind();
    const other = createCore({
      dataDir: path.join(f.dir, "instances", f.id, "core"),
      secrets: f.stores.get(f.id)!,
      egress: f.egress,
    });
    let entered!: () => void, answer!: (allow: boolean) => void;
    const confirming = new Promise<void>((resolve) => (entered = resolve));
    const response = new Promise<boolean>((resolve) => (answer = resolve));
    try {
      f.confirm.ask.mockImplementation(async () => {
        await other.disable("a");
        await other.enable("a");
        entered();
        return response;
      });
      const work = f
        .invoke(name, {
          kind: "fs",
          operation: "write",
          path: "record.txt",
          data: [1],
        })
        .catch((error: unknown) => error);
      await confirming;
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.fs.records).toHaveLength(0);
      answer(true);
      expect(await work).toMatchObject({ code: "PERMISSION_DENIED" });
      const requested = f.audit.find((e) => e.phase === "confirmation");
      expect(requested?.callId).toEqual(expect.any(String));
      expect(f.audit.find((e) => e.phase === "denied")).toMatchObject({
        callId: requested!.callId,
        code: "PERMISSION_DENIED",
        executionState: "not_started",
      });
      expect(f.fs.records).toHaveLength(0);
    } finally {
      answer(true);
      other.close();
    }
  },
);

it.each(["unknown", "completed"] as const)(
  "preserves %s capability failure metadata across watchdog checks after sink dispatch",
  async (state) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const f = await fixture();
    await f.bind();
    const other = createCore({
      dataDir: path.join(f.dir, "instances", f.id, "core"),
      secrets: f.stores.get(f.id)!,
      egress: f.egress,
    });
    let entered!: () => void, release!: () => void;
    const dispatched = new Promise<void>((resolve) => (entered = resolve));
    const response = new Promise<void>((resolve) => (release = resolve));
    const write = f.fs.write.bind(f.fs);
    vi.spyOn(f.fs, "write").mockImplementation(async (request) => {
      await write(request);
      if (state === "unknown") {
        entered();
        await response;
        throw Error("private sink failure");
      }
    });
    if (state === "completed")
      f.setAudit(async (event) => {
        if (event.phase === "result") {
          entered();
          await response;
          throw Error("private audit failure");
        }
      });
    try {
      const work = f
        .invoke("run", {
          kind: "fs",
          operation: "write",
          path: "record.txt",
          data: [1],
        })
        .catch((error: unknown) => error);
      await dispatched;
      await other.disable("a");
      await other.enable("a");
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.fs.records).toHaveLength(1);
      release();
      const error = await work;
      const allowed = f.audit.find((e) => e.phase === "allow");
      expect(allowed?.callId).toEqual(expect.any(String));
      expect(error).toMatchObject({
        code: "CAPABILITY_FAILED",
        details: {
          callId: allowed!.callId,
          phase: state === "unknown" ? "sink" : "audit_result",
          executionState: state,
        },
      });
      expect(f.audit.find((e) => e.phase === "result")).toMatchObject({
        callId: allowed!.callId,
        executionState: state,
      });
      expect(JSON.stringify(error)).not.toContain("private");
      expect(f.fs.records).toHaveLength(1);
    } finally {
      release();
      other.close();
    }
  },
);

it("requires the provider's confirmed local execution item on a delegated engine edge", async () => {
  const f = await fixture();
  const c = provide();
  c.engines = [
    {
      id: "local",
      title: "Provider engine",
      entry: "engine.mjs",
      runtime: "node",
      platforms: [`${process.platform}-${process.arch}`],
      protocol: "jsonrpc-jsonl-v1",
    },
  ];
  const update = await archive(
    "a",
    c,
    `export function activate(s){s.register('tools','store',()=>s.engine.start('local'));}`,
    [
      fsPermission,
      {
        id: "engine",
        kind: "engine",
        target: "local",
        reason: "Fixture engine",
      },
    ],
    { version: "1.1.0" },
    { "engine.mjs": Buffer.from(engineCode) },
  );
  await f.host.updatePackage(
    f.id,
    ((await f.host.previewComponent(f.id, update)) as { token: string }).token,
    "a",
    true,
  );
  await f.bind();
  await expect(f.invoke("run", f.echo)).rejects.toMatchObject({
    code: "TIER_REQUIRED",
  });
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect(await f.host.engineStatus(f.id, "a", "local")).toMatchObject({
    state: "stopped",
    trusted: false,
  });
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: ["a"],
  };
  const plan = await f.host.tierPlan(f.id, selection);
  await f.host.confirmTier(f.id, plan.fingerprint, selection);
  f.confirm.ask.mockClear();
  expect(await f.invoke("run", f.echo)).toMatchObject({
    state: "running",
    trusted: true,
  });
  expect(f.confirm.ask).not.toHaveBeenCalled();
});

it("preserves engine confirmation denial and stops stale callbacks during asynchronous allow audit", async () => {
  const f = await fixture({ engine: true });
  await f.bind();
  {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["lesson"],
    };
    const plan = await f.host.tierPlan(f.id, selection);
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
  }
  await f.host.startEngine(f.id, "lesson", "local");
  const call = () =>
    f.host.engineCall(f.id, "lesson", "request", {
      engineId: "local",
      method: "work",
      input: {
        requirementId: "store",
        input: {
          kind: "fs",
          operation: "write",
          path: "record.txt",
          data: [1],
        },
      },
    });
  f.confirm.ask.mockResolvedValueOnce(false);
  expect(await call()).toMatchObject({
    refused: { code: "CONFIRMATION_DENIED", executionState: "not_started" },
  });
  f.setAudit(async (e) => {
    if (e.phase === "allow" && e.kind === "fs") await f.host.disable(f.id, "a");
  });
  await expect(call()).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
  expect(f.fs.records).toHaveLength(0);
});

it("revokes existing finite Grants when a new component automatically connects", async () => {
  const f = await fixture({ https: true, engine: true });
  await f.bind();
  await f.host.enable(f.id, "lesson");
  {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: ["lesson"],
    };
    const plan = await f.host.tierPlan(f.id, selection);
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
  }
  await f.host.startEngine(f.id, "lesson", "local");
  const grant = await f.host.engineCall(f.id, "lesson", "request", {
    engineId: "local",
    method: "grant",
    input: {
      action: "request",
      requirementId: "store",
      connectionId: "api",
      reads: ["conversation"],
      outputs: ["reply"],
    },
  });
  expect(grant).toHaveProperty("id");
  const c = consumer();
  c.protocols!.requires![0]!.range = "^1.2.0";
  const bytes = await archive("new-consumer", c, callerCode);
  await f.host.addLibraryComponent(
    f.id,
    (
      await f.host.importLibrary(
        ((await f.host.preview(bytes)) as { token: string }).token,
      )
    ).digest,
  );
  expect(
    (await f.host.protocolPlan(f.id)).requirements.find(
      (s) => s.consumerId === "new-consumer",
    ),
  ).toMatchObject({ autoBound: true, selected: { providerId: "b" } });
  const core = createCore({
    dataDir: path.join(f.dir, "instances", f.id, "core"),
    secrets: f.stores.get(f.id)!,
    egress: f.egress,
  });
  try {
    expect(await core.listGrants()).toEqual([
      expect.objectContaining({
        id: (grant as Grant).id,
        revokedAt: expect.any(String),
      }),
    ]);
    expect(
      await core.checkGrant((grant as Grant).id, "lesson", {
        reads: [],
        outputs: [],
      }),
    ).toBeUndefined();
  } finally {
    core.close();
  }
});
