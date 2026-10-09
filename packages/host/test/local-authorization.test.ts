import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  type AuditEvent,
} from "@plums/core";
import { DesktopHost, type HostOptions, type Session } from "../src/host.js";
import { EngineCoordinator } from "../src/engine-coordinator.js";
import { ProjectSandbox } from "../src/project-sandbox.js";
import {
  MACHINE_AUTHORIZATION_COPY,
  type TierSelection,
} from "../src/local-authorization.js";
import { engineManifest } from "./platform-fixtures.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const simple =
  "import{createInterface}from'node:readline';let context;const send=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method==='initialize'){context=m.params.context;send(m.id,{protocol:'jsonrpc-jsonl-v1'});}else if(m.method==='context')send(m.id,context);else if(m.method==='pid')send(m.id,process.pid);else if(m.method==='crash')process.exit(1);else send(m.id,m.params);});";
async function component(id: string, tier?: "project", version = "1.0.0") {
  const manifest = engineManifest();
  manifest.id = id;
  manifest.name = id;
  manifest.version = version;
  manifest.dependencies = [];
  manifest.permissions = manifest.permissions.slice(0, 1);
  if (tier)
    Object.assign(manifest.permissions[0]!, {
      tier,
      network: { hosts: ["fixture.test"] },
    });
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "engine/main.mjs": Buffer.from(simple),
    "runtime/main.js": Buffer.from(
      "export function activate(s){s.register('commands','start',()=>s.engine.start('local'));}",
    ),
    "ui/index.html": Buffer.from("<p>fixture</p>"),
  });
}
async function fixture(tier?: "project") {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "plums-local-authorization-"),
  );
  dirs.push(base);
  const dir = path.join(base, "platform"),
    project = path.join(base, "project"),
    extra = path.join(base, "extra");
  await Promise.all([mkdir(project), mkdir(extra)]);
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
    audit: async (_id, e) => {
      audit.push(e);
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const put = async (bytes: Uint8Array) =>
    host.importLibrary(
      ((await host.preview(bytes)) as { token: string }).token,
    );
  const first = await put(await component("first", tier)),
    second = await put(await component("second", tier));
  const record = await host.createAgent("Tier fixture", [
    first.digest,
    second.digest,
  ]);
  const id = record.instanceId;
  await host.enable(id, "first");
  await host.enable(id, "second");
  if (tier) {
    await host.bindRoot(id, "work", project);
    await host.bindRoot(id, "extra", extra);
  }
  confirm.ask.mockClear();
  const selection: TierSelection = {
    ceiling: tier ?? "machine",
    projects: tier ? ["work"] : [],
    readOnly: [],
    components: ["first", "second"],
    ...(tier
      ? { hosts: { first: { local: ["fixture.test"] }, second: { local: [] } } }
      : {}),
  };
  const approve = async (selected = selection) => {
    const plan = await host.tierPlan(id, selected);
    return host.confirmTier(id, plan.fingerprint, selected);
  };
  return {
    host,
    id,
    dir,
    project,
    extra,
    base,
    options,
    audit,
    confirm,
    selection,
    approve,
    put,
  };
}
it("one trusted summary authorizes two machine processes without per-engine prompts", async () => {
  const f = await fixture();
  expect(await f.host.tierStatus(f.id)).toMatchObject({
    tier: { ceiling: "sandbox" },
    grants: [],
  });
  expect(await f.approve()).toBe(true);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  expect(f.confirm.ask.mock.calls[0]![0].message).toContain(
    MACHINE_AUTHORIZATION_COPY,
  );
  expect(f.confirm.ask.mock.calls[0]![0].message).toContain("first");
  expect(f.confirm.ask.mock.calls[0]![0].message).toContain("second");
  await Promise.all([
    f.host.startEngine(f.id, "first", "local"),
    f.host.startEngine(f.id, "second", "local"),
  ]);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  const e = f.audit.find((e) => e.reason === "LOCAL_AUTHORIZATION_CONFIRMED")!;
  expect(e.localScope).toMatchObject({
    componentIds: ["first", "second"],
    hostCount: 0,
  });
  expect(Object.isFrozen(e)).toBe(true);
  expect(Object.isFrozen(e.localScope)).toBe(true);
  expect(JSON.stringify(e)).not.toContain(f.base);
});
it("a project admission cleanup failure does not leave existing machine entries running", async () => {
  const f = await fixture();
  await f.approve();
  await Promise.all([
    f.host.startEngine(f.id, "first", "local"),
    f.host.startEngine(f.id, "second", "local"),
  ]);
  const pids = (await Promise.all(
    ["first", "second"].map((pkg) =>
      f.host.engineCall(f.id, pkg, "request", {
        engineId: "local",
        method: "pid",
        input: null,
      }),
    ),
  )) as number[];
  vi.spyOn(ProjectSandbox.prototype, "close").mockRejectedValueOnce(
    new Error("fixture admission cleanup failure"),
  );
  const internals = f.host as unknown as {
    engines: EngineCoordinator;
    sessions: Map<string, Session>;
  };
  await expect(
    internals.engines.stopAgent(internals.sessions.get(f.id)!),
  ).rejects.toThrow("fixture admission cleanup failure");
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
});
it("ordinary components and unknown 1.x engine fields never inherit local execution", async () => {
  const f = await fixture();
  const memory = await f.put(
    await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify({
          formatVersion: "1.0",
          kind: "extension",
          id: "memory",
          name: "Memory fixture",
          version: "1.0.0",
          description: "",
          dependencies: [],
          permissions: [
            {
              id: "read",
              level: "read",
              target: "notes",
              reason: "Synthetic legacy read",
              kind: "engine",
              tier: "machine",
              operations: "unknown-field",
            },
          ],
          payload: {},
        }),
      ),
    }),
  );
  await f.host.addLibraryComponent(f.id, memory.digest);
  await f.approve({
    ...f.selection,
    components: ["first", "second", "memory"],
  });
  expect(
    (await f.host.tierStatus(f.id)).grants.map((g) => g.packageId),
  ).toEqual(["first", "second"]);
  expect(
    (await f.host.tierPlan(f.id)).entries.find((e) => e.packageId === "memory")!
      .engines,
  ).toEqual([]);
});
it.each([false, undefined, "true", 1])(
  "a non-Boolean approval (%s) leaves the Agent unchanged",
  async (answer) => {
    const f = await fixture();
    f.confirm.ask.mockResolvedValue(answer as boolean);
    expect(await f.approve()).toBe(false);
    expect(await f.host.tierStatus(f.id)).toMatchObject({
      tier: { ceiling: "sandbox" },
      grants: [],
    });
  },
);
it("confirmation exceptions and timeout cannot commit", async () => {
  const f = await fixture();
  f.confirm.ask.mockRejectedValueOnce(new Error("synthetic failure"));
  expect(await f.approve()).toBe(false);
  const plan = await f.host.tierPlan(f.id, f.selection);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  try {
    f.confirm.ask.mockImplementation(() => new Promise(() => {}));
    const pending = f.host.confirmTier(f.id, plan.fingerprint, f.selection);
    await vi.waitFor(() => expect(f.confirm.ask).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe(false);
  } finally {
    vi.useRealTimers();
  }
  expect((await f.host.tierStatus(f.id)).grants).toEqual([]);
});
it("audit failure cannot persist a ceiling or partial component grants", async () => {
  const f = await fixture();
  f.options.audit = async (_id, e) => {
    if (e.reason === "LOCAL_AUTHORIZATION_CONFIRMED")
      throw new Error("synthetic audit failure");
  };
  await expect(f.approve()).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "local_authorization_audit" },
  });
  expect(await f.host.tierStatus(f.id)).toMatchObject({
    tier: { ceiling: "sandbox" },
    grants: [],
  });
});
it("rechecks cross-connection revocation during grant audit", async () => {
  const f = await fixture();
  f.options.audit = async (_id, e) => {
    if (e.reason !== "LOCAL_AUTHORIZATION_CONFIRMED") return;
    const core = createCore({
      dataDir: path.join(f.dir, "instances", f.id, "core"),
      instanceId: f.id,
      secrets: new MemorySecretStore(),
      egress: new RecordingEgressSink(),
      onAudit: () => {},
    });
    try {
      await core.revokeEngineTrust("first", "local");
    } finally {
      core.close();
    }
  };
  await expect(f.approve()).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect((await f.host.tierStatus(f.id)).grants).toEqual([]);
});
it("revocation stays available during a pending confirmation and makes its answer stale", async () => {
  const f = await fixture();
  let answer!: (v: boolean) => void;
  f.confirm.ask.mockImplementation(
    () =>
      new Promise((r) => {
        answer = r;
      }),
  );
  const pending = f.approve();
  await vi.waitFor(() => expect(f.confirm.ask).toHaveBeenCalledTimes(1));
  await f.host.revokeLocal(f.id);
  answer(true);
  await expect(pending).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect((await f.host.tierStatus(f.id)).grants).toEqual([]);
});
it("copies selection before the first wait and checks directory identity after audit", async () => {
  const f = await fixture("project");
  const selection = structuredClone(f.selection);
  const plan = await f.host.tierPlan(f.id, selection);
  const pending = f.host.confirmTier(f.id, plan.fingerprint, selection);
  selection.ceiling = "machine";
  selection.projects = ["extra"];
  expect(await pending).toBe(true);
  expect((await f.host.tierStatus(f.id)).tier).toMatchObject({
    ceiling: "project",
    projects: [{ root: "work" }],
  });
  f.options.audit = async (_id, e) => {
    if (e.reason === "LOCAL_AUTHORIZATION_CONFIRMED") {
      await rename(f.project, f.project + "-old");
      await mkdir(f.project);
    }
  };
  await expect(f.approve()).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect((await f.host.tierStatus(f.id)).grants).toEqual([]);
});
it("stores only selected hosts and keeps project execution closed until the OS sandbox exists", async () => {
  const f = await fixture("project");
  await f.approve();
  expect((await f.host.tierStatus(f.id)).grants.map((g) => g.hosts)).toEqual([
    ["fixture.test"],
    [],
  ]);
  await expect(
    f.host.startEngine(f.id, "first", "local"),
  ).rejects.toMatchObject({ code: "TIER_UNAVAILABLE" });
  const expanded = structuredClone(f.selection);
  expanded.hosts!.first!.local = ["undeclared.test"];
  await expect(f.host.tierPlan(f.id, expanded)).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it.each(["unbind", "rebind", "identity"])(
  "%s invalidates only project execution entries",
  async (kind) => {
    const f = await fixture("project");
    await f.approve();
    if (kind === "unbind") await f.host.unbindRoot(f.id, "work");
    else if (kind === "rebind") await f.host.bindRoot(f.id, "work", f.extra);
    else {
      await rename(f.project, f.project + "-old");
      await mkdir(f.project);
    }
    const state = await f.host.tierStatus(f.id);
    expect(state.tier.projects).toEqual([]);
    expect(state.grants).toEqual([]);
    expect(
      f.audit.filter((e) => e.reason === "LOCAL_DIRECTORY_INVALIDATED"),
    ).toHaveLength(1);
    expect(JSON.stringify(f.audit)).not.toContain(f.base);
  },
);
it("selective revoke stops one process and leaves the other running", async () => {
  const f = await fixture();
  await f.approve();
  await Promise.all([
    f.host.startEngine(f.id, "first", "local"),
    f.host.startEngine(f.id, "second", "local"),
  ]);
  await f.host.revokeLocal(f.id, "first");
  expect(await f.host.engineStatus(f.id, "first", "local")).toMatchObject({
    state: "stopped",
    trusted: false,
  });
  expect(await f.host.engineStatus(f.id, "second", "local")).toMatchObject({
    state: "running",
    trusted: true,
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it("blocks new requests while lowering audits, then stops both affected processes", async () => {
  const f = await fixture();
  await f.approve();
  await Promise.all([
    f.host.startEngine(f.id, "first", "local"),
    f.host.startEngine(f.id, "second", "local"),
  ]);
  let release!: () => void,
    entered = false;
  f.options.audit = async (_id, e) => {
    if (e.reason === "LOCAL_TIER_LOWERED") {
      entered = true;
      await new Promise<void>((r) => {
        release = r;
      });
    }
  };
  const lowering = f.host.lowerTier(f.id, "sandbox");
  await vi.waitFor(() => expect(entered).toBe(true));
  await expect(
    f.host.engineCall(f.id, "first", "request", {
      engineId: "local",
      method: "echo",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  release();
  await lowering;
  expect(await f.host.engineStatus(f.id, "first", "local")).toMatchObject({
    state: "stopped",
    trusted: false,
  });
  expect(await f.host.engineStatus(f.id, "second", "local")).toMatchObject({
    state: "stopped",
    trusted: false,
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it("removing one directory needs no confirmation and retains a smaller project scope", async () => {
  const f = await fixture("project");
  await f.approve({ ...f.selection, projects: ["work", "extra"] });
  await f.host.removeTierDirectory(f.id, "extra");
  const state = await f.host.tierStatus(f.id);
  expect(state.tier.projects.map((p) => p.root)).toEqual(["work"]);
  expect(state.grants).toHaveLength(2);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it("lowering persists even if process cleanup fails and never asks again", async () => {
  const f = await fixture();
  await f.approve();
  const stop = vi
    .spyOn(EngineCoordinator.prototype, "stopPackages")
    .mockRejectedValueOnce(new Error("synthetic cleanup failure"));
  await expect(f.host.lowerTier(f.id, "sandbox")).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "local_authorization_cleanup" },
  });
  expect(stop).toHaveBeenCalled();
  expect(await f.host.tierStatus(f.id)).toMatchObject({
    tier: { ceiling: "sandbox", components: [] },
    grants: [],
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it("failed cleanup during a confirmed change can remove authority but cannot add it", async () => {
  const f = await fixture();
  await f.approve({ ...f.selection, components: ["first"] });
  vi.spyOn(EngineCoordinator.prototype, "stopPackages").mockRejectedValueOnce(
    new Error("synthetic cleanup failure"),
  );
  await expect(
    f.approve({ ...f.selection, components: ["second"] }),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "local_authorization_cleanup" },
  });
  expect((await f.host.tierStatus(f.id)).grants).toEqual([]);
});
it("unchanged upgrades and restart retain approval; a new Agent and ZIP import start at sandbox", async () => {
  const f = await fixture();
  await f.approve();
  const preview = (await f.host.previewComponent(
    f.id,
    await component("first", undefined, "1.1.0"),
  )) as { token: string };
  await f.host.updatePackage(f.id, preview.token, "first", true);
  await f.host.stopSession(f.id);
  expect(
    (await f.host.tierPlan(f.id, f.selection)).entries[0]!.engines[0]!.state,
  ).toBe("confirmed");
  const bytes = await f.host.exportAgent(f.id);
  const zipPreview = (await f.host.preview(bytes)) as { token: string };
  const imported = await f.host.install(zipPreview.token);
  expect(await f.host.tierStatus(imported.instanceId)).toMatchObject({
    tier: { ceiling: "sandbox" },
    grants: [],
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});

it("launch and request require the component's current grant and a sufficient ceiling, without asking", async () => {
  const f = await fixture();
  for (const operation of ["start", "request"]) {
    await expect(
      f.host.engineCall(f.id, "first", operation, {
        engineId: "local",
        method: "echo",
        input: {},
      }),
    ).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  }
  expect(f.confirm.ask).not.toHaveBeenCalled();
  await f.approve({ ...f.selection, components: [] });
  await expect(
    f.host.startEngine(f.id, "first", "local"),
  ).rejects.toMatchObject({ code: "LOCAL_CONFIRM_REQUIRED" });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  await f.approve();
  await f.host.startEngine(f.id, "first", "local");
  await f.host.lowerTier(f.id, "project");
  await expect(
    f.host.engineCall(f.id, "first", "request", {
      engineId: "local",
      method: "echo",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  expect(f.confirm.ask).toHaveBeenCalledTimes(2);
});
it("each Agent service keeps separate entry processes, context, crash recovery and request audit", async () => {
  const f = await fixture();
  await f.approve();
  await Promise.all(
    ["first", "second"].map((pkg) => f.host.startEngine(f.id, pkg, "local")),
  );
  const request = (pkg: string, method: string, input: unknown = {}) =>
    f.host.engineCall(f.id, pkg, "request", {
      engineId: "local",
      method,
      input,
    });
  const pids = await Promise.all([
    request("first", "pid"),
    request("second", "pid"),
  ]);
  expect(pids[0]).not.toBe(pids[1]);
  expect(await request("first", "context")).toMatchObject({
    agentId: f.id,
    componentId: "first",
    tier: "machine",
    projects: [],
  });
  await expect(request("first", "crash")).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      executionState: "unknown",
      phase: "engine",
      reason: "ENGINE_EXITED",
    },
  });
  await vi.waitFor(async () =>
    expect(await f.host.engineStatus(f.id, "first", "local")).toMatchObject({
      state: "crashed",
      trusted: true,
    }),
  );
  expect(
    await request("second", "echo", { text: "private-local-text" }),
  ).toEqual({ text: "private-local-text" });
  await f.host.startEngine(f.id, "first", "local");
  expect(await request("first", "echo", {})).toEqual({});
  const pair = f.audit.filter(
    (e) => e.extensionId === "second" && e.operation === "echo",
  );
  expect(pair.map((e) => [e.phase, e.executionState])).toEqual([
    ["allow", "not_started"],
    ["result", "completed"],
  ]);
  expect(pair[0]!.callId).toBe(pair[1]!.callId);
  expect(pair[0]).toMatchObject({ tier: "machine", callerIds: [] });
  expect(Object.isFrozen(pair[0])).toBe(true);
  expect(Object.isFrozen(pair[0]!.callerIds)).toBe(true);
  expect(JSON.stringify(f.audit)).not.toContain("private-local-text");
  expect(f.audit.some((e) => e.reason === "ENGINE_CRASH")).toBe(true);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});
it("request input is copied before the first wait and audit failure never dispatches or leaks its cause", async () => {
  const f = await fixture();
  await f.approve();
  await f.host.startEngine(f.id, "first", "local");
  let release!: () => void;
  const previous = f.options.audit!;
  f.options.audit = async (id, event) => {
    await previous(id, event);
    if (event.phase === "allow" && event.kind === "engine")
      await new Promise<void>((r) => {
        release = r;
      });
  };
  const input = { value: "original" };
  const pending = f.host.engineCall(f.id, "first", "request", {
    engineId: "local",
    method: "echo",
    input,
  });
  await vi.waitFor(() => expect(release).toBeDefined());
  input.value = "mutated";
  release();
  expect(await pending).toEqual({ value: "original" });
  f.options.audit = async (_id, event) => {
    if (event.phase === "allow") throw Error("private-audit-cause");
  };
  const rejected = await f.host
    .engineCall(f.id, "first", "request", {
      engineId: "local",
      method: "crash",
      input: {},
    })
    .catch((e) => e);
  expect(rejected).toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { phase: "audit_allow", executionState: "not_started" },
  });
  expect(String(rejected)).not.toContain("private-audit-cause");
  expect(await f.host.engineStatus(f.id, "first", "local")).toMatchObject({
    state: "running",
  });
  f.options.audit = previous;
});
it("revocation and reconfirmation during allow audit cannot revive an old request", async () => {
  const f = await fixture();
  await f.approve();
  await f.host.startEngine(f.id, "first", "local");
  let release!: () => void;
  const previous = f.options.audit!;
  f.options.audit = async (id, event) => {
    await previous(id, event);
    if (event.phase === "allow" && event.operation === "crash")
      await new Promise<void>((r) => {
        release = r;
      });
  };
  const pending = f.host.engineCall(f.id, "first", "request", {
    engineId: "local",
    method: "crash",
    input: {},
  });
  const rejection = expect(pending).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    details: { executionState: "not_started" },
  });
  await vi.waitFor(() => expect(release).toBeDefined());
  await f.host.revokeLocal(f.id, "first");
  await f.approve();
  await f.host.startEngine(f.id, "first", "local");
  release();
  await rejection;
  expect(await f.host.engineStatus(f.id, "first", "local")).toMatchObject({
    state: "running",
  });
});
it("a new component's confirmation preserves another component's existing process authorization", async () => {
  const f = await fixture();
  await f.approve({ ...f.selection, components: ["first"] });
  await f.host.startEngine(f.id, "first", "local");
  const request = (method: string) =>
    f.host.engineCall(f.id, "first", "request", {
      engineId: "local",
      method,
      input: {},
    });
  const pid = await request("pid");
  const grant = (await f.host.tierStatus(f.id)).grants.find(
    (g) => g.packageId === "first",
  )!;
  await f.approve();
  expect(
    (await f.host.tierStatus(f.id)).grants.find((g) => g.packageId === "first"),
  ).toEqual(grant);
  expect(await request("pid")).toBe(pid);
  await f.host.startEngine(f.id, "second", "local");
  await f.host.revokeEngine(f.id, "second", "local");
  expect(await request("pid")).toBe(pid);
  await expect(
    f.host.startEngine(f.id, "second", "local"),
  ).rejects.toMatchObject({ code: "LOCAL_CONFIRM_REQUIRED" });
});
it("result audit failure reports completed execution without exposing output or retrying", async () => {
  const f = await fixture();
  await f.approve();
  await f.host.startEngine(f.id, "first", "local");
  const previous = f.options.audit!;
  f.options.audit = async (_id, event) => {
    if (event.phase === "result" && event.operation === "echo")
      throw Error("raw-output-secret");
  };
  const error = await f.host
    .engineCall(f.id, "first", "request", {
      engineId: "local",
      method: "echo",
      input: { text: "private-output" },
    })
    .catch((e) => e);
  expect(error).toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { executionState: "completed", phase: "audit_result" },
  });
  expect(String(error)).not.toMatch(/raw-output-secret|private-output/);
  f.options.audit = previous;
});
it("unserializable request input is refused before dispatch with a safe execution state", async () => {
  const f = await fixture();
  await f.approve();
  await f.host.startEngine(f.id, "first", "local");
  const circular: any = { private: "body-private" };
  circular.self = circular;
  for (const input of [circular, { value: 1n }]) {
    const error = await f.host
      .engineCall(f.id, "first", "request", {
        engineId: "local",
        method: "crash",
        input,
      })
      .catch((e) => e);
    expect(error).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        executionState: "not_started",
        phase: "engine",
        reason: "ENGINE_MESSAGE_INVALID",
      },
    });
    expect(String(error)).not.toContain("body-private");
  }
  expect(await f.host.engineStatus(f.id, "first", "local")).toMatchObject({
    state: "running",
  });
});
