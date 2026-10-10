import assert from "node:assert/strict";
import { mkdtemp, rm, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  redact,
  type AuditEvent,
  type ManifestV2,
} from "@plumsjs/core";
import { DesktopHost } from "../src/host.js";
import { resourceFixture } from "./resource-fixture.js";
import { addPolicy, select, grant } from "./policy-fixture.js";
import { fixture as commonFixture } from "./common-fixture.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of hosts.splice(0)) await h.close();
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
    await assert.rejects(lstat(dir), { code: "ENOENT" });
  }
});
const manifest = (id: string): ManifestV2 => ({
  formatVersion: "2.0",
  kind: "extension",
  id,
  name: "Synthetic",
  description: "",
  version: "1.0.0",
  dependencies: [],
  permissions: [],
  payload: {},
});
async function put(
  host: DesktopHost,
  m: ManifestV2,
  code = "export function activate(s){s.register('commands','echo',v=>v)}",
  files: Record<string, Uint8Array> = {},
) {
  return host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(JSON.stringify(m)),
          "main.js": Buffer.from(code),
          ...files,
        }),
      )) as { token: string }
    ).token,
  );
}
async function credential(host: DesktopHost, agent: string, value: string) {
  const m = manifest("audit-credential");
  m.settingsSchema = {
    type: "object",
    properties: {
      token: {
        type: "string",
        title: "Token",
        description: "Synthetic",
        "x-secret": true,
      },
    },
  };
  const item = await put(host, m);
  await host.addLibraryComponent(agent, item.digest);
  await host.setSettings(agent, m.id, {}, { token: value });
}
function check(
  event: Readonly<AuditEvent>,
  phase: AuditEvent["phase"],
  state: AuditEvent["executionState"],
) {
  expect(event.callId).toMatch(/^[a-f0-9-]{36}$/);
  expect(event.timestamp).toMatch(/^20/);
  expect(event.phase).toBe(phase);
  expect(event.executionState).toBe(state);
  expect(Object.isFrozen(event)).toBe(true);
  if (event.callerIds) expect(Object.isFrozen(event.callerIds)).toBe(true);
}
const engine = `import{createInterface}from'node:readline';import{writeFileSync}from'node:fs';let count=0;const pending=new Map();const send=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.method){const id=pending.get(m.id);pending.delete(m.id);if(m.error)console.log(JSON.stringify({jsonrpc:'2.0',id,error:m.error}));else send(id,true);return;}
if(m.method==='initialize'){writeFileSync(m.params.context.dataDir+'/started','Synthetic');send(m.id,{protocol:'jsonrpc-jsonl-v1'});}else if(m.method==='report'){const id='callback-'+(++count);pending.set(id,m.id);console.log(JSON.stringify({jsonrpc:'2.0',id,method:'host.grant',params:m.params}));}else if(m.method==='crash')process.exit(42);else send(m.id,m.params);});`;
async function local(value: string, policy = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-generated-audit-"));
  dirs.push(dir);
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink(),
    fs = new RecordingFsSink(),
    events: Readonly<AuditEvent>[] = [];
  const host = new DesktopHost({
    dataDir: dir,
    nodePath: path.resolve(".build-cache/node-v26.5.1-darwin-arm64/bin/node"),
    secretStore: () => secrets,
    egress,
    fs,
    confirm: { ask: async () => true },
    audit: async (_id, event) => {
      events.push(event);
    },
  });
  hosts.push(host);
  await host.initialize();
  const m = manifest("audit-local");
  m.permissions = [
    { id: "local", kind: "engine", target: "local", reason: "Synthetic" },
  ];
  m.payload = {
    plumsDesktop: {
      sdkVersion: "2",
      runtime: "main.js",
      engines: [
        {
          id: "local",
          title: "Synthetic",
          entry: "engine.mjs",
          runtime: "node",
          platforms: ["darwin-arm64"],
          protocol: "jsonrpc-jsonl-v1",
        },
      ],
      contributes: { commands: [{ name: "echo", title: "Echo" }] },
    },
  };
  const item = await put(host, m, undefined, {
    "engine.mjs": Buffer.from(engine),
  });
  const agent = await host.createAgent("Synthetic", [item.digest]);
  const id = agent.instanceId;
  await host.enable(id, m.id);
  if (policy) {
    await addPolicy(host, id, "allow");
    await select(host, id, "allow");
  }
  await credential(host, id, value);
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: [m.id],
  };
  const plan = await host.tierPlan(id, selection);
  expect(await host.confirmTier(id, plan.fingerprint, selection)).toBe(true);
  events.length = 0;
  return {
    host,
    id,
    pkg: m.id,
    dir,
    secrets,
    egress,
    fs,
    events,
    start: () => host.startEngine(id, m.id, "local"),
    request: (method = "echo", input: unknown = {}) =>
      host.engineCall(id, m.id, "request", {
        engineId: "local",
        method,
        input,
      }),
  };
}
it.each([
  "callId",
  "timestamp",
  "phase",
  "kind",
  "not_started",
  "completed",
  "ENGINE_START",
  "0",
])(
  "retains lifecycle and local request audit controls while redacting business replies (%s)",
  async (value) => {
    const f = await local(value);
    await f.start();
    const start = f.events.find((e) => e.reason === "ENGINE_START")!;
    check(start, "result", "not_started");
    expect(start.kind).toBe("engine");
    expect(start.reason).toBe("ENGINE_START");
    const business = Object.fromEntries([
      [value, value],
      ["nested", { callId: value, phase: value, executionState: value }],
      ["__proto__", { kind: value }],
    ]);
    expect(await f.request("echo", business)).toEqual(
      redact(business, [value]),
    );
    const allowed = f.events.find((e) => e.phase === "allow")!,
      result = f.events.find(
        (e) => e.phase === "result" && e.operation === "echo",
      )!;
    check(allowed, "allow", "not_started");
    check(result, "result", "completed");
    expect(result.callId).toBe(allowed.callId);
    await f.host.stopEngine(f.id, f.pkg, "local");
    check(
      f.events.find((e) => e.reason === "ENGINE_STOP")!,
      "result",
      "completed",
    );
    expect(f.egress.records).toHaveLength(0);
    expect(f.fs.records).toHaveLength(0);
  },
);
it.each(["callId", "phase", "not_started"])(
  "refuses startup when lifecycle audit fails without spawning the entry (%s)",
  async (value) => {
    const f = await local(value);
    f.host.options.audit = async (_id, event) => {
      f.events.push(event);
      if (event.reason === "ENGINE_START") throw Error("Synthetic refusal");
    };
    await expect(f.start()).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        callId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        phase: "audit_result",
        executionState: "not_started",
      },
    });
    check(
      f.events.find((e) => e.reason === "ENGINE_START")!,
      "result",
      "not_started",
    );
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(f.dir, { recursive: true });
    expect(files.some((p) => p.endsWith("/started"))).toBe(false);
    expect(f.fs.records).toHaveLength(0);
    expect(f.egress.records).toHaveLength(0);
  },
);
it.each(["callId", "phase", "completed"])(
  "retains completed local execution when result auditing fails (%s)",
  async (value) => {
    const f = await local(value);
    await f.start();
    f.events.length = 0;
    f.host.options.audit = async (_id, event) => {
      f.events.push(event);
      if (event.phase === "result" && event.operation === "echo")
        throw Error("Synthetic refusal");
    };
    await expect(f.request()).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        callId: expect.stringMatching(/^[a-f0-9-]{36}$/),
        phase: "audit_result",
        executionState: "completed",
      },
    });
    const a = f.events.find((e) => e.phase === "allow")!,
      r = f.events.find((e) => e.phase === "result")!;
    check(r, "result", "completed");
    expect(r.callId).toBe(a.callId);
    f.host.options.audit = async () => {};
  },
);
it("keeps entry-reported audit data untrusted even when it uses control field names", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    f = await local(id);
  await f.start();
  await f.request("report", {
    action: "audit",
    callId: id,
    phase: "allow",
    operation: "read",
    executionState: "not_started",
  });
  const reported = f.events.find((e) => e.operation === "read")!;
  expect(reported.callId).toBe("[REDACTED]");
  expect(reported.phase).toBe("allow");
  expect(Object.isFrozen(reported)).toBe(true);
});
it.each(["assessmentId", "phase", "not_started"])(
  "preserves policy assessment controls at the actual local request source (%s)",
  async (value) => {
    const f = await local(value, true);
    await f.start();
    await f.request();
    const assessments = f.events.filter((e) => e.phase === "policy");
    expect(assessments.length).toBeGreaterThanOrEqual(4);
    for (const e of assessments) {
      check(e, "policy", "not_started");
      expect(e.assessmentId).toMatch(/^[a-f0-9-]{36}$/);
      expect(e.modeGeneration).toEqual(expect.any(Number));
    }
    expect(f.egress.records).toHaveLength(0);
  },
);

async function resources(value: string, policy = false) {
  const secrets = new Map<string, MemorySecretStore>(),
    events: Readonly<AuditEvent>[] = [],
    egress = new RecordingEgressSink();
  const f = await resourceFixture({
    egress,
    secretStore: (id) => {
      if (!secrets.has(id)) secrets.set(id, new MemorySecretStore());
      return secrets.get(id)!;
    },
    audit: async (_id, e) => {
      events.push(e);
    },
  });
  hosts.push(f.host);
  dirs.push(f.dir);
  if (policy) {
    await addPolicy(f.host, f.a, "allow");
    await select(f.host, f.a, "allow");
  }
  await credential(f.host, f.a, value);
  events.length = 0;
  return { ...f, events, secrets, egress };
}
it.each(["callId", "phase", "kind", "resource", "not_started", "completed"])(
  "keeps resource confirmation and operation audit controls (%s)",
  async (value) => {
    const f = await resources(value);
    const business = {
      callId: value,
      phase: value,
      nested: Object.fromEntries([[value, value]]),
    };
    await f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "synthetic",
      expectedRevision: "0",
      value: business,
    });
    const reply = await f.invoke(f.a, {
      op: "read",
      resourceId: f.shared,
      key: "synthetic",
    });
    expect(reply).toMatchObject({ value: redact(business, [value]) });
    const events = f.events.filter(
      (e) => e.kind === "resource" && e.phase !== "task",
    );
    expect(events.length).toBeGreaterThanOrEqual(8);
    for (const e of events) {
      check(e, e.phase, e.phase === "result" ? "completed" : "not_started");
      expect(e.kind).toBe("resource");
      expect(["read", "write"]).toContain(e.operation);
    }
    expect(f.egress.records).toHaveLength(0);
  },
);
it("preserves finite resource and policy lease audit structures, including nested scope controls", async () => {
  const f = await resources("phase", true);
  await f.grant(f.a);
  await grant(f.host, f.a);
  const resource = f.events.find((e) => e.resourceScope)!;
  check(resource, "task", "not_started");
  expect(resource.resourceMode).toBe("task");
  expect(resource.durationMs).toBe(900_000);
  expect(Object.isFrozen(resource.resourceScope)).toBe(true);
  for (const s of resource.resourceScope!) {
    expect(Object.keys(s).sort()).toEqual([
      "componentId",
      "operations",
      "resourceId",
    ]);
    expect(Object.isFrozen(s.operations)).toBe(true);
  }
  const lease = f.events.find((e) => e.reason === "POLICY_SCOPE_GRANTED")!;
  check(lease, "task", "not_started");
  await f.host.revokePolicyScope(f.a);
  check(
    f.events.find((e) => e.reason === "POLICY_SCOPE_REVOKED")!,
    "revoke",
    "not_started",
  );
  await f.host.revokeResourceRange(f.a);
  check(
    f.events.find((e) => e.reason === "RESOURCE_RANGE_REVOKED")!,
    "revoke",
    "not_started",
  );
});
it("rejects a resource audit before any write and keeps committed execution after a result audit failure", async () => {
  const f = await resources("phase");
  f.host.options.audit = async (_id, e) => {
    if (e.phase === "allow") throw Error("Synthetic refusal");
  };
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "denied",
      expectedRevision: "0",
      value: "Synthetic",
    }),
  ).rejects.toBeDefined();
  f.host.options.audit = async () => {};
  expect(
    await f.invoke(f.a, { op: "read", resourceId: f.shared, key: "denied" }),
  ).toEqual({ exists: false, revision: "0" });
  f.host.options.audit = async (_id, e) => {
    if (e.phase === "result") throw Error("Synthetic refusal");
  };
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "committed",
      expectedRevision: "0",
      value: "Synthetic",
    }),
  ).rejects.toMatchObject({ details: { executionState: "completed" } });
  f.host.options.audit = async () => {};
  expect(
    await f.invoke(f.a, { op: "read", resourceId: f.shared, key: "committed" }),
  ).toMatchObject({ value: "Synthetic" });
});
it.each(["callId", "phase", "protocol.auto-bind"])(
  "retains automatic protocol-binding audit controls without granting permissions (%s)",
  async (value) => {
    const f = await resources(value);
    const consumer = manifest("audit-consumer"),
      provider = manifest("audit-provider");
    for (const [m, role] of [
      [consumer, "requires"],
      [provider, "provides"],
    ] as const)
      m.payload = {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          contributes: { commands: [{ name: "echo", title: "Echo" }] },
          protocols: {
            [role]:
              role === "requires"
                ? [
                    {
                      id: "slot",
                      protocol: "org.plums.synthetic-audit",
                      range: "^1.0.0",
                      optional: true,
                    },
                  ]
                : [
                    {
                      id: "slot",
                      protocol: "org.plums.synthetic-audit",
                      version: "1.0.0",
                      contribution: { kind: "commands", name: "echo" },
                    },
                  ],
          },
        },
      };
    const c = await put(f.host, consumer);
    await f.host.addLibraryComponent(f.a, c.digest);
    const p = await put(f.host, provider);
    await f.host.addLibraryComponent(f.a, p.digest);
    const event = f.events.find((e) => e.operation === "protocol.auto-bind")!;
    check(event, "grant", "not_started");
    expect(event.outcome).toBe("allowed");
    expect(event.operation).toBe("protocol.auto-bind");
    await expect(
      f.host.invoke(f.a, consumer.id, consumer.id, "commands", "echo", {}),
    ).rejects.toBeDefined();
    expect(f.egress.records).toHaveLength(0);
  },
);
it("preserves common invocation and cancellation audits from host-generated task identities", async () => {
  const f = await commonFixture();
  hosts.push(f.host);
  dirs.push(f.dir);
  await credential(f.host, f.a.instanceId, "phase");
  const events: Readonly<AuditEvent>[] = [];
  f.options.audit = async (_id, e) => {
    events.push(e);
  };
  await f.host.invoke(
    f.a.instanceId,
    "consumer",
    "consumer",
    "commands",
    "run",
    { callId: "phase" },
  );
  const a = events.find((e) => e.phase === "allow")!,
    r = events.find((e) => e.phase === "result")!;
  check(a, "allow", "not_started");
  check(r, "result", "completed");
  expect(r.callId).toBe(a.callId);
  expect(r.taskId).toBe(a.taskId);
  await f.host.revokeTaskScope(f.a.instanceId);
  const revoked = events.find((e) => e.reason === "TASK_REVOKED")!;
  check(revoked, "task", "not_started");
});

it.each(["callId", "phase", "completed"])(
  "retains SDK response failure audit controls only after matching a real completion receipt (%s)",
  async (value) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "plums-receipt-audit-"));
    dirs.push(dir);
    const secrets = new MemorySecretStore(),
      events: Readonly<AuditEvent>[] = [],
      egress = new RecordingEgressSink({}, { status: 200, body: "{}" });
    const host = new DesktopHost({
      dataDir: dir,
      nodePath: path.resolve(".build-cache/node-v26.5.1-darwin-arm64/bin/node"),
      egress,
      secretStore: () => secrets,
      confirm: { ask: async () => true },
      audit: async (_id, e) => {
        events.push(e);
      },
    });
    hosts.push(host);
    await host.initialize();
    const m = manifest("audit-connector");
    m.kind = "connector";
    m.permissions = [
      {
        id: "api",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Synthetic",
      },
    ];
    m.settingsSchema = {
      type: "object",
      properties: {
        url: {
          type: "string",
          title: "URL",
          description: "Synthetic",
          default: "https://receipt.plums-fixture.test",
        },
        token: {
          type: "string",
          title: "Token",
          description: "Synthetic",
          "x-secret": true,
        },
      },
    };
    m.payload = {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        connections: [
          {
            id: "endpoint",
            permissionId: "api",
            baseURLSetting: "url",
            credentials: [{ setting: "token", header: "X-Synthetic" }],
          },
        ],
        contributes: { commands: [{ name: "run", title: "Run" }] },
      },
    };
    const item = await put(
      host,
      m,
      "export function activate(s){s.register('commands','run',async input=>{if(input.forged)return s.failResponse(input.forged,'RESPONSE_INVALID');const b=await s.connection('endpoint');const r=await s.capability('api',{kind:'service',operation:'request',binding:b.binding,sources:[],input:{path:'/synthetic'}});return s.failResponse(r.callId,'RESPONSE_INVALID');})}",
    );
    const a = await host.createAgent("Synthetic", [item.digest]);
    await host.setSettings(a.instanceId, m.id, {}, { token: value });
    await host.enable(a.instanceId, m.id);
    events.length = 0;
    const invoke = (input: unknown) =>
      host.invoke(a.instanceId, m.id, m.id, "commands", "run", input);
    await expect(
      invoke({ forged: "11111111-1111-4111-8111-111111111111" }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(events).toHaveLength(0);
    await expect(invoke({})).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
    });
    const failed = events.find((e) => e.reason === "RESPONSE_INVALID")!;
    check(failed, "result", "completed");
    expect(failed.kind).toBe("service");
    expect(failed.callId).toBe(events.find((e) => e.phase === "allow")!.callId);
    expect(egress.records).toHaveLength(1);
  },
);

it("keeps the existing secret-containing composition export refusal before auto-binding", async () => {
  const f = await resources("0"),
    item = await put(f.host, manifest("synthetic-added"));
  await expect(
    f.host.addLibraryComponent(f.a, item.digest),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(f.events.some((e) => e.operation === "protocol.auto-bind")).toBe(
    false,
  );
});
it("fails closed on a resource secret read without publishing an audit or writing a record", async () => {
  const f = await resources("synthetic-private-read-error");
  vi.spyOn(f.secrets.get(f.a)!, "get").mockRejectedValue(
    Error("synthetic-private-read-error"),
  );
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "synthetic",
      expectedRevision: "0",
      value: "Synthetic",
    }),
  ).rejects.toSatisfy(
    (e: Error) => !e.message.includes("synthetic-private-read-error"),
  );
  expect(f.events).toHaveLength(0);
  expect(f.egress.records).toHaveLength(0);
});
it("fails closed on lifecycle secret refresh before the native entry starts", async () => {
  const f = await local("synthetic-private-read-error");
  vi.spyOn(f.secrets, "get").mockRejectedValue(
    Error("synthetic-private-read-error"),
  );
  await expect(f.start()).rejects.toSatisfy(
    (e: Error) => !e.message.includes("synthetic-private-read-error"),
  );
  expect(f.events).toHaveLength(0);
  expect(f.fs.records).toHaveLength(0);
  expect(f.egress.records).toHaveLength(0);
});
