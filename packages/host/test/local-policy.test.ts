import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  type AuditEvent,
} from "@plums/core";
import { DesktopHost, type HostOptions } from "../src/host.js";
import { engineManifest } from "./platform-fixtures.js";
import { addPolicy, select } from "./policy-fixture.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const engine = `import{createInterface}from'node:readline';import{writeFile}from'node:fs/promises';
createInterface({input:process.stdin}).on('line',async line=>{const m=JSON.parse(line);if(!m.method)return;
let result;if(m.method==='initialize'){await writeFile(m.params.context.dataDir+'/pid',String(process.pid));result={protocol:'jsonrpc-jsonl-v1'};}
else if(m.method==='write'){await writeFile(m.params.path,m.params.content);result='written';}
else if(m.method==='pid')result=process.pid;else result=m.params;
console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`;
async function fixture(body = "return decision('allow');", approved = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-local-policy-"));
  dirs.push(dir);
  const confirm = { ask: vi.fn(async () => true) },
    audit: Readonly<AuditEvent>[] = [];
  const stores = new Map<string, MemorySecretStore>();
  const options: HostOptions = {
    dataDir: dir,
    confirm,
    egress: new RecordingEgressSink(),
    secretStore: (id) => {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    audit: async (_id, event) => {
      audit.push(event);
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const manifest = engineManifest();
  manifest.settingsSchema = {
    type: "object",
    properties: {
      key: {
        type: "string",
        title: "Fixture key",
        description: "Fixture only",
        "x-secret": true,
      },
    },
  };
  manifest.dependencies = [];
  manifest.permissions = manifest.permissions.slice(0, 1);
  const bytes = await createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "engine/main.mjs": Buffer.from(engine),
    "runtime/main.js": Buffer.from(
      "export function activate(s){s.register('commands','start',()=>s.engine.start('local'));}",
    ),
    "ui/index.html": Buffer.from("<p>test</p>"),
  });
  const artifact = await host.importLibrary(
    ((await host.preview(bytes)) as { token: string }).token,
  );
  const record = await host.createAgent("Local policy", [artifact.digest]);
  const id = record.instanceId;
  await host.enable(id, manifest.id);
  await host.setSettings(id, manifest.id, {}, { key: "private-request-body" });
  await addPolicy(host, id, "test", body);
  await addPolicy(host, id, "replacement", "return decision('allow');");
  await select(host, id, "test");
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: [manifest.id],
  };
  const approve = async () => {
    const plan = await host.tierPlan(id, selection);
    return host.confirmTier(id, plan.fingerprint, selection);
  };
  if (approved) await approve();
  confirm.ask.mockClear();
  const start = () => host.startEngine(id, manifest.id, "local");
  const request = (
    method = "ping",
    input: unknown = { text: "private-request-body" },
  ) =>
    host.engineCall(id, manifest.id, "request", {
      engineId: "local",
      method,
      input,
    });
  return {
    host,
    id,
    pkg: manifest.id,
    dir,
    options,
    audit,
    confirm,
    approve,
    start,
    request,
  };
}
it.each(["allow", "confirm"])(
  "local %s uses the confirmed component authorization without a temporary lease or a new question",
  async (decision) => {
    const f = await fixture(
      `if(c.category!=='local'||c.target!=='local'||c.intent.kind!=='local'||Object.keys(c.intent).length!==3||c.actors.length!==1||c.maximum.selection.length!==1||c.maximum.selection[0].componentId!=='engine-demo')throw Error('wrong local context');return decision('${decision}');`,
    );
    expect((await f.host.policyStatus(f.id)).active).toBe(null);
    await f.start();
    expect(await f.request()).toEqual({ text: "[REDACTED]" });
    expect(f.confirm.ask).not.toHaveBeenCalled();
    const allow = f.audit.find(
      (e) => e.phase === "allow" && e.operation === "ping",
    )!;
    expect(
      f.audit.filter((e) => e.phase === "policy" && e.callId === allow.callId),
    ).toHaveLength(2);
    expect(
      f.audit.find((e) => e.phase === "result" && e.callId === allow.callId),
    ).toMatchObject({ outcome: "completed", executionState: "completed" });
    expect(f.audit.some((e) => e.phase === "confirmation")).toBe(false);
    for (const e of f.audit.filter((e) => e.phase === "policy")) {
      expect(Object.isFrozen(e)).toBe(true);
      expect(Object.isFrozen(e.callerIds)).toBe(true);
    }
    expect(JSON.stringify(f.audit)).not.toContain("private-request-body");
    expect(JSON.stringify(f.audit)).not.toContain(f.dir);
    await f.host.close();
    const restart = new DesktopHost(f.options);
    hosts.push(restart);
    await restart.initialize();
    expect((await restart.policyStatus(f.id)).active).toBe(null);
    await restart.startEngine(f.id, f.pkg, "local");
    expect(
      await restart.engineCall(f.id, f.pkg, "request", {
        engineId: "local",
        method: "ping",
        input: null,
      }),
    ).toBe(null);
    expect(f.confirm.ask).not.toHaveBeenCalled();
  },
);
it("policy deny prevents startup before any process is created", async () => {
  const f = await fixture("return decision('deny');");
  await expect(f.start()).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED", executionState: "not_started" },
  });
  expect(await f.host.engineStatus(f.id, f.pkg, "local")).toMatchObject({
    state: "stopped",
    trusted: true,
  });
  expect(f.audit.some((e) => e.reason === "ENGINE_START")).toBe(false);
  expect(f.confirm.ask).not.toHaveBeenCalled();
});
it("each request is assessed again, and deny prevents its actual file write", async () => {
  const f = await fixture(
    "return decision(c.operation==='write'?'deny':'allow');",
  );
  await f.start();
  const pid = await f.request("pid", null);
  const file = path.join(f.dir, "not-written.txt");
  await expect(
    f.request("write", { path: file, content: "private-output" }),
  ).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED", executionState: "not_started" },
  });
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.request("pid", null)).toBe(pid);
  expect(
    f.audit.some((e) => e.phase === "allow" && e.operation === "write"),
  ).toBe(false);
  expect(
    f.audit.some(
      (e) =>
        e.phase === "policy" &&
        e.operation === "write" &&
        e.outcome === "denied",
    ),
  ).toBe(true);
  expect(f.confirm.ask).not.toHaveBeenCalled();
});
it.each([
  "return {...decision('allow'),operationFingerprint:'0'.repeat(64)};",
  "return {...decision('allow'),extra:true};",
  "throw Error('private-policy-failure');",
  "return {decision:'allow'};",
  "await s.engine.start('local');return decision('allow');",
])(
  "invalid, failed or recursive local strategy fails closed: %s",
  async (body) => {
    const f = await fixture(
      `if(c.operation==='start')return decision('allow');${body}`,
    );
    await f.start();
    await expect(f.request()).rejects.toMatchObject({
      details: { reason: "POLICY_UNAVAILABLE", executionState: "not_started" },
    });
    expect(
      f.audit.some((e) => e.phase === "allow" && e.operation === "ping"),
    ).toBe(false);
    expect(JSON.stringify(f.audit)).not.toContain("private-policy-failure");
    expect(f.confirm.ask).not.toHaveBeenCalled();
  },
);
it("local policy allow cannot replace a missing component authorization or Agent ceiling", async () => {
  const f = await fixture(undefined, false);
  await expect(f.start()).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  await f.approve();
  await f.host.revokeLocal(f.id, f.pkg);
  await expect(f.start()).rejects.toMatchObject({
    code: "LOCAL_CONFIRM_REQUIRED",
  });
  expect(f.audit.some((e) => e.phase === "policy")).toBe(false);
});
it.each(["revoke", "replace", "audit-failure"])(
  "waiting local policy audit cannot survive %s",
  async (change) => {
    const f = await fixture();
    await f.start();
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((r) => (entered = r)),
      resumed = new Promise<void>((r) => (release = r));
    f.options.audit = async (_id, e) => {
      if (
        e.phase === "policy" &&
        e.operation === "write" &&
        e.outcome === "allowed"
      ) {
        entered();
        await resumed;
        if (change === "audit-failure") throw Error("private-audit-failure");
      }
    };
    const file = path.join(f.dir, "not-written.txt");
    const call = f.request("write", { path: file, content: "secret-output" });
    void call.catch(() => {});
    await waiting;
    if (change === "revoke") {
      await f.host.revokeLocal(f.id, f.pkg);
      await f.approve();
    }
    if (change === "replace") await select(f.host, f.id, "replacement");
    release();
    const error = await call.catch((error) => error);
    expect(error).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { executionState: "not_started" },
    });
    expect(JSON.stringify(error)).not.toContain("private-audit-failure");
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(f.confirm.ask).toHaveBeenCalledTimes(change === "revoke" ? 1 : 0);
  },
);
it("the production ten-second local strategy timeout has no human fallback or request dispatch", async () => {
  const f = await fixture(
    "if(c.operation==='start')return decision('allow');await new Promise(()=>{});return decision('allow');",
  );
  await f.start();
  await expect(f.request()).rejects.toMatchObject({
    details: { reason: "POLICY_UNAVAILABLE", executionState: "not_started" },
  });
  expect(
    f.audit.some((e) => e.phase === "allow" && e.operation === "ping"),
  ).toBe(false);
  expect(f.confirm.ask).not.toHaveBeenCalled();
}, 16000);

it("the SDK start route also evaluates local policy without signing a temporary scope", async () => {
  const f = await fixture("return decision('confirm');");
  await f.host.invoke(f.id, f.pkg, f.pkg, "commands", "start", {});
  expect(await f.host.engineStatus(f.id, f.pkg, "local")).toMatchObject({
    state: "running",
    trusted: true,
  });
  expect(
    f.audit.some((e) => e.phase === "policy" && e.operation === "start"),
  ).toBe(true);
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect((await f.host.policyStatus(f.id)).active).toBe(null);
});

it("late startup cancellation waits for the actual process before removing its lifecycle hooks", async () => {
  const f = await fixture();
  const coordinator = (f.host as any).engines;
  const session = await (f.host as any).session(f.id);
  const controller = new AbortController();
  const startup = coordinator.start(session, f.pkg, "local", {
    signal: controller.signal,
    callers: [],
    ancestry: [f.pkg],
    assertActive: async () => {
      const status = await coordinator.status(session, f.pkg, "local");
      if (status.state === "running") {
        controller.abort();
        throw Error("fixture caller cancelled after handshake");
      }
    },
  });
  await expect(startup).rejects.toBeDefined();
  const data = path.join(f.dir, "instances", f.id, "engine-data");
  const [entry] = await readdir(data);
  const pid = Number(await readFile(path.join(data, entry!, "pid"), "utf8"));
  expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
  expect(await f.host.engineStatus(f.id, f.pkg, "local")).toMatchObject({
    state: "stopped",
  });
  await f.start();
  expect(await f.request("pid", null)).not.toBe(pid);
});

it("cancellation after the final async guard prevents the actual engine write", async () => {
  const f = await fixture();
  await f.start();
  const coordinator = (f.host as any).engines;
  const session = await (f.host as any).session(f.id);
  const manager = coordinator.service(session).manager;
  const request = manager.request.bind(manager);
  const controller = new AbortController();
  vi.spyOn(manager, "request").mockImplementation(async (...args: any[]) => {
    const [key, hooks, method, input, id] = args;
    return request(
      key,
      {
        ...hooks,
        active: async () => {
          await hooks.active();
          controller.abort();
        },
      },
      method,
      input,
      id,
    );
  });
  const file = path.join(f.dir, "last-guard-write.txt");
  await expect(
    coordinator.request(
      session,
      f.pkg,
      "local",
      "write",
      {
        path: file,
        content: "unwritten-body",
      },
      undefined,
      {
        callers: [],
        ancestry: [f.pkg],
        signal: controller.signal,
      },
    ),
  ).rejects.toMatchObject({ details: { executionState: "not_started" } });
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
});
