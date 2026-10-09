import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  type AuditEvent,
  type ManifestV2,
} from "@plums/core";
import { DesktopHost, type HostOptions } from "../src/host.js";
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

const engine =
  "import{createInterface}from'node:readline';const send=(id,result)=>console.log(JSON.stringify({jsonrpc:'2.0',id,result}));createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);send(m.id,m.method==='initialize'?{protocol:'jsonrpc-jsonl-v1'}:m.method==='pid'?process.pid:m.params);});";
async function component(id: string, local = true, consumer = false) {
  const manifest: ManifestV2 = local
    ? engineManifest()
    : {
        formatVersion: "2.0",
        kind: "extension",
        id,
        name: id,
        version: "1.0.0",
        description: "Synthetic assembly fixture",
        dependencies: [],
        permissions: [],
        payload: {
          plumsDesktop: {
            sdkVersion: "2",
            runtime: "main.js",
            contributes: { tools: [{ name: "echo", title: "Echo" }] },
          },
        },
      };
  manifest.id = manifest.name = id;
  manifest.dependencies = [];
  if (local) manifest.permissions = manifest.permissions.slice(0, 1);
  if (consumer)
    manifest.payload.plumsDesktop.protocols = {
      requires: [
        {
          id: "echo",
          protocol: "org.example.assembly",
          range: "^1.0.0",
          optional: true,
        },
      ],
    };
  const files = local
    ? {
        "engine/main.mjs": Buffer.from(engine),
        "runtime/main.js": Buffer.from(
          "export function activate(s){s.register('commands','run',async v=>{await s.engine.start('local');return s.engine.request('local',v.method,v.input);});}",
        ),
        "ui/index.html": Buffer.from("<p>Fixture</p>"),
      }
    : {
        "main.js": Buffer.from(
          "export function activate(s){s.register('tools','echo',v=>v);}",
        ),
      };
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    ...files,
  });
}

async function fixture(consumer = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-local-assembly-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>(),
    events: Readonly<AuditEvent>[] = [];
  const confirm = { ask: vi.fn(async () => true) };
  const options: HostOptions = {
    dataDir: dir,
    confirm,
    egress: new RecordingEgressSink(),
    secretStore: (id) => {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    audit: async (_id, event) => {
      events.push(event);
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const put = async (bytes: Uint8Array) =>
    host.importLibrary(
      ((await host.preview(bytes)) as { token: string }).token,
    );
  const original = await put(await component("original", true, consumer));
  const caller: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "caller",
    name: "Caller",
    version: "1.0.0",
    description: "",
    dependencies: [{ id: "original", kind: "extension", range: "^1.0.0" }],
    permissions: [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        contributes: { commands: [{ name: "run", title: "Run" }] },
      },
    },
  };
  const delegate = await put(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(caller)),
      "main.js": Buffer.from(
        "export function activate(s){s.register('commands','run',v=>s.invoke('original','commands','run',v));}",
      ),
    }),
  );
  const record = await host.createAgent("Additive assembly", [
    original.digest,
    delegate.digest,
  ]);
  const id = record.instanceId;
  await host.enable(id, "original");
  await host.enable(id, "caller");
  const approve = async (components = ["original"]) => {
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components,
    };
    const plan = await host.tierPlan(id, selection);
    return host.confirmTier(id, plan.fingerprint, selection);
  };
  await approve();
  await host.startEngine(id, "original", "local");
  const call = (method: string, input: unknown = {}, pkg = "original") =>
    host.engineCall(id, pkg, "request", { engineId: "local", method, input });
  const add = async (bytes: Uint8Array) =>
    host.addLibraryComponent(id, (await put(bytes)).digest);
  const journal = path.join(dir, "instances", id, "assembly-transaction.json");
  return {
    host,
    id,
    dir,
    options,
    events,
    confirm,
    put,
    approve,
    call,
    add,
    journal,
  };
}

it.each(["library", "import"])(
  "keeps the current process when %s adds a pending local component",
  async (method) => {
    const f = await fixture(),
      pid = await f.call("pid"),
      grants = (await f.host.tierStatus(f.id)).grants;
    const bytes = await component("added");
    if (method === "library") await f.add(bytes);
    else
      await f.host.importComponent(
        f.id,
        ((await f.host.previewComponent(f.id, bytes)) as { token: string })
          .token,
      );
    expect(await f.host.engineStatus(f.id, "original", "local")).toMatchObject({
      state: "running",
      trusted: true,
    });
    expect(await f.call("pid")).toBe(pid);
    expect((await f.host.tierStatus(f.id)).grants).toEqual(grants);
    expect(
      (await f.host.tierPlan(f.id)).entries.find(
        (e) => e.packageId === "added",
      )!.engines[0]!.state,
    ).toBe("pending");
    await f.host.enable(f.id, "added");
    await expect(f.call("pid", {}, "added")).rejects.toMatchObject({
      code: "LOCAL_CONFIRM_REQUIRED",
    });
    expect(await f.host.engineStatus(f.id, "added", "local")).toMatchObject({
      state: "stopped",
      trusted: false,
    });
    expect(f.confirm.ask).toHaveBeenCalledTimes(1);
    expect(await f.approve(["original", "added"])).toBe(true);
    await f.host.startEngine(f.id, "added", "local");
    expect(await f.call("pid")).toBe(pid);
    expect(await f.call("pid", {}, "added")).not.toBe(pid);
    expect(f.confirm.ask).toHaveBeenCalledTimes(2);
  },
);

it("an ordinary addition creates no local entry or inherited execution", async () => {
  const f = await fixture(),
    pid = await f.call("pid");
  await f.add(await component("ordinary", false));
  await f.host.enable(f.id, "ordinary");
  const plan = await f.host.tierPlan(f.id);
  expect(plan.entries.find((e) => e.packageId === "ordinary")!.engines).toEqual(
    [],
  );
  expect(
    plan.entries.find((e) => e.packageId === "original")!.engines[0]!.state,
  ).toBe("confirmed");
  await expect(
    f.host.startEngine(f.id, "ordinary", "local"),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await f.call("pid")).toBe(pid);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(
    await readFile(path.join(f.dir, "instances", f.id, "record.json"), "utf8"),
  );
  expect(
    saved.components.map((c: { packageId: string }) => c.packageId),
  ).toEqual(["original", "caller", "ordinary"]);
  await expect(readFile(f.journal)).rejects.toMatchObject({ code: "ENOENT" });
});

it("an addition makes a waiting assembly confirmation stale without revoking an existing entry", async () => {
  const f = await fixture(),
    pid = await f.call("pid"),
    before = await f.host.tierStatus(f.id);
  let answer!: (value: boolean) => void;
  f.confirm.ask.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        answer = r;
      }),
  );
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: ["original", "caller"],
  };
  const plan = await f.host.tierPlan(f.id, selection);
  const pending = f.host.confirmTier(f.id, plan.fingerprint, selection);
  const outcome = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => expect(answer).toBeDefined());
  try {
    await f.add(await component("added"));
  } finally {
    answer(true);
  }
  expect(await outcome).toMatchObject({
    error: {
      code: "PERMISSION_DENIED",
      details: { reason: "LOCAL_AUTHORIZATION_CHANGED" },
    },
  });
  expect(await f.host.tierStatus(f.id)).toEqual(before);
  expect(await f.call("pid")).toBe(pid);
  expect(
    (await f.host.tierPlan(f.id)).entries.find((e) => e.packageId === "added")!
      .engines[0]!.state,
  ).toBe("pending");
});

it("an unrelated addition preserves a delegated request already waiting for its allow audit", async () => {
  const f = await fixture(),
    pid = await f.call("pid");
  let release!: () => void;
  const originalAudit = f.options.audit!;
  f.options.audit = async (id, event) => {
    await originalAudit(id, event);
    if (
      event.kind === "engine" &&
      event.phase === "allow" &&
      event.operation === "echo"
    )
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  const pending = f.host.invoke(f.id, "caller", "caller", "commands", "run", {
    method: "echo",
    input: { value: "original" },
  });
  const outcome = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => expect(release).toBeDefined(), { timeout: 5_000 });
  try {
    await f.add(await component("ordinary", false));
  } finally {
    release();
  }
  expect(await outcome).toEqual({ value: { value: "original" } });
  expect(await f.call("pid")).toBe(pid);
  const audit = f.events.filter(
    (e) => e.kind === "engine" && e.operation === "echo",
  );
  expect(audit.map((e) => [e.phase, e.executionState])).toEqual([
    ["allow", "not_started"],
    ["result", "completed"],
  ]);
  expect(audit[0]!.callerIds).toEqual(["caller"]);
});

async function provider() {
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "provider",
    name: "Provider",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        contributes: { tools: [{ name: "echo", title: "Echo" }] },
        protocols: {
          provides: [
            {
              id: "echo",
              protocol: "org.example.assembly",
              version: "1.0.0",
              contribution: { kind: "tools", name: "echo" },
            },
          ],
        },
      },
    },
  };
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "main.js": Buffer.from(
      "export function activate(s){s.register('tools','echo',v=>v);}",
    ),
  });
}

it("existing requests remain available during a journal for only the new consumer's automatic connection", async () => {
  const f = await fixture(),
    pid = await f.call("pid");
  await f.add(await provider());
  let release!: () => void;
  f.options.audit = async (_id, e) => {
    if (e.operation === "protocol.auto-bind")
      await new Promise<void>((r) => {
        release = r;
      });
  };
  const adding = f.add(await component("new-consumer", false, true));
  const outcome = adding.then(
    () => ({ ok: true }),
    (error: unknown) => ({ error }),
  );
  await vi.waitFor(() => expect(release).toBeDefined());
  try {
    expect(JSON.parse(await readFile(f.journal, "utf8")).packageId).toBe(
      "new-consumer",
    );
    expect(await f.call("pid")).toBe(pid);
    const bytes = await readFile(f.journal, "utf8");
    const changed = JSON.parse(bytes);
    changed.next.name = "Untrusted journal";
    await writeFile(f.journal, JSON.stringify(changed));
    await expect(f.call("pid")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await writeFile(f.journal, bytes);
    expect(await f.call("pid")).toBe(pid);
    const otherJournal = path.join(
      path.dirname(f.journal),
      "component-transaction.json",
    );
    await writeFile(otherJournal, "{}");
    await expect(f.call("pid")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await rm(otherJournal);
  } finally {
    release();
  }
  expect(await outcome).toEqual({ ok: true });
  expect(await f.call("pid")).toBe(pid);
  expect(
    (
      (await f.host.protocolPlan(f.id)) as {
        requirements: { consumerId: string; autoBound?: boolean }[];
      }
    ).requirements.find((r) => r.consumerId === "new-consumer"),
  ).toMatchObject({ autoBound: true });
});

it("an unowned assembly journal still rejects requests before dispatch", async () => {
  const f = await fixture(),
    pid = await f.call("pid");
  await writeFile(f.journal, "{}");
  await expect(f.call("pid")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await rm(f.journal);
  expect(await f.call("pid")).toBe(pid);
});

it("a failed additive publication closes the session and retains recovery evidence", async () => {
  const f = await fixture(),
    pid = await f.call("pid");
  await f.add(await provider());
  f.options.audit = async (_id, e) => {
    if (e.operation === "protocol.auto-bind")
      throw Error("Synthetic assembly audit failure");
  };
  await expect(
    f.add(await component("new-consumer", false, true)),
  ).rejects.toThrow("Synthetic assembly audit failure");
  expect(() => process.kill(pid as number, 0)).toThrow();
  expect(JSON.parse(await readFile(f.journal, "utf8"))).toMatchObject({
    packageId: "new-consumer",
    automaticProtocols: true,
  });
  await expect(f.call("pid")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await f.host.close();
  f.options.audit = async () => {};
  const restored = new DesktopHost(f.options);
  hosts.push(restored);
  await restored.initialize();
  expect(
    ((await restored.protocolPlan(f.id)) as { requirements: unknown[] })
      .requirements,
  ).toHaveLength(1);
  await restored.startEngine(f.id, "original", "local");
  expect(
    await restored.engineCall(f.id, "original", "request", {
      engineId: "local",
      method: "pid",
      input: {},
    }),
  ).not.toBe(pid);
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
});

it("a new provider that changes an existing consumer retains the conservative rebuild boundary", async () => {
  const f = await fixture(true),
    pid = await f.call("pid");
  await f.add(await provider());
  expect(() => process.kill(pid as number, 0)).toThrow();
  expect(await f.host.engineStatus(f.id, "original", "local")).toMatchObject({
    state: "stopped",
    trusted: true,
  });
  expect(
    ((await f.host.protocolPlan(f.id)) as { requirements: unknown[] })
      .requirements[0],
  ).toMatchObject({ autoBound: true, consumerId: "original" });
});

it("duplicate and missing-dependency additions do not retire the existing process", async () => {
  const f = await fixture(),
    pid = await f.call("pid");
  await expect(f.add(await component("original"))).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  const manifest = engineManifest();
  manifest.id = "invalid";
  manifest.dependencies = [
    { id: "missing", kind: "extension", range: "^1.0.0" },
  ];
  await expect(
    f.add(
      await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(manifest)),
        "engine/main.mjs": Buffer.from(engine),
        "runtime/main.js": Buffer.from("export function activate(){}"),
        "ui/index.html": Buffer.from("<p>Fixture</p>"),
      }),
    ),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(await f.call("pid")).toBe(pid);
  await expect(readFile(f.journal)).rejects.toMatchObject({ code: "ENOENT" });
});
