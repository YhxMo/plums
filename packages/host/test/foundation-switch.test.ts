import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  chmod,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import {
  MemorySecretStore,
  createArchive,
  createCore,
  RecordingEgressSink,
} from "@plumsjs/core";
import { DesktopHost } from "../src/host.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-switch-"));
  dirs.push(dir);
  const secrets = new Map<string, MemorySecretStore>();
  const options = {
    dataDir: dir,
    nodePath: path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node"),
    confirm: { ask: vi.fn(async () => true) },
    secretStore: (id: string) => {
      if (!secrets.has(id)) secrets.set(id, new MemorySecretStore());
      return secrets.get(id)!;
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const bytes = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify({
        formatVersion: "2.0",
        kind: "extension",
        id: "org.example.independent",
        name: "Independent",
        version: "1.0.0",
        description: "Internal fixture",
        dependencies: [],
        permissions: [],
        payload: {
          plumsFoundation: {
            declarationVersion: "1.0",
            id: "org.example.independent",
            foundationVersion: "1.0",
            entry: "provider.mjs",
            execution: "controlled-node",
            platforms: ["darwin-arm64"],
            features: ["session.invoke", "session.callback", "session.cancel"],
            hostFeatures: [],
            sdks: [
              {
                id: "org.plums.sdk",
                range: "2.0.0",
                features: [
                  "sdk.register",
                  "sdk.settings",
                  "sdk.context",
                  "sdk.capability",
                ],
              },
            ],
          },
        },
      }),
    ),
    "provider.mjs": await readFile(
      "packages/host/test/fixtures/independent-foundation.mjs",
    ),
  });
  const preview = (await host.preview(bytes)) as { token: string };
  await host.importLibrary(preview.token);
  const selection = (await host.listFoundations())[0]!.selection;
  return { host, options, selection };
}
it("pins new Agents and preserves the selection across a change of application default", async () => {
  const f = await setup();
  const a = await f.host.createAgent("A");
  expect(a).toHaveProperty("foundation.selection.digest");
  await f.host.close();
  const next = new DesktopHost({ ...f.options, foundation: f.selection });
  hosts.push(next);
  await next.initialize();
  expect((await next.listAgents())[0]!.foundation).toEqual(a.foundation);
  const b = await next.createAgent("B");
  expect(b.foundation!.selection).toEqual(f.selection);
});
it("switches one Agent with a stale-plan guard and protects pinned artifacts after restart", async () => {
  const f = await setup();
  const a = await f.host.createAgent("A"),
    b = await f.host.createAgent("B");
  const plan = await f.host.foundationPlan(a.instanceId, f.selection);
  await f.host.switchFoundation(a.instanceId, plan.fingerprint, f.selection);
  expect(
    (await f.host.listAgents()).find((p) => p.instanceId === a.instanceId)!
      .foundation!.selection,
  ).toEqual(f.selection);
  expect(
    (await f.host.listAgents()).find((p) => p.instanceId === b.instanceId)!
      .foundation,
  ).toEqual(b.foundation);
  await expect(
    f.host.switchFoundation(
      a.instanceId,
      plan.fingerprint,
      b.foundation!.selection,
    ),
  ).rejects.toMatchObject({
    details: { reason: "FOUNDATION_SELECTION_CHANGED" },
  });
  await f.host.close();
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  await expect(next.removeLibrary(f.selection.digest)).rejects.toBeDefined();
});

async function component(
  host: DesktopHost,
  id = "consumer",
  extra: Record<string, unknown> = {},
  feature = "sdk.settings",
) {
  const declaration = {
    sdkVersion: "2",
    runtime: "main.js",
    foundation: {
      requirementVersion: "1.0",
      protocolRange: "^1.0.0",
      sdk: { id: "org.plums.sdk", version: "2.0.0" },
      features: [
        ...new Set(["sdk.register", "sdk.settings", "sdk.context", feature]),
      ],
    },
    contributes: { commands: [{ name: "check", title: "Check" }] },
  };
  const bytes = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify({
        formatVersion: "2.0",
        kind: "extension",
        id,
        name: id,
        version: "1.0.0",
        description: "Internal platform fixture",
        dependencies: [],
        permissions: [],
        settingsSchema: {
          type: "object",
          properties: {
            label: {
              type: "string",
              title: "Label",
              description: "Fixture label",
            },
            key: {
              type: "string",
              title: "Key",
              description: "Fixture credential",
              "x-secret": true,
            },
          },
        },
        payload: { plumsDesktop: declaration },
        ...extra,
      }),
    ),
    "main.js": Buffer.from(
      "export function activate(s){s.register('commands','check',async()=>({settings:await s.settings(),context:await s.context()}));}",
    ),
  });
  const preview = (await host.preview(bytes)) as { token: string };
  return host.importLibrary(preview.token);
}
it("preserves component configuration, secret references and consent while rebuilding fresh instances", async () => {
  const f = await setup(),
    item = await component(f.host),
    a = await f.host.createAgent("A", [item.digest]),
    b = await f.host.createAgent("B", [item.digest]);
  await f.host.setSettings(
    a.instanceId,
    "consumer",
    { label: "saved" },
    { key: "synthetic-secret" },
  );
  await f.host.enable(a.instanceId, "consumer");
  await f.host.enable(b.instanceId, "consumer");
  const invoke = (id: string) =>
    f.host.invoke(id, "consumer", "consumer", "commands", "check", {});
  const first = await invoke(a.instanceId),
    other = await invoke(b.instanceId),
    before = (await f.host.resources(a.instanceId)) as any;
  const core = createCore({
    dataDir: path.join(f.options.dataDir, "instances", a.instanceId, "core"),
    secrets: f.options.secretStore(a.instanceId),
    egress: new RecordingEgressSink(),
  });
  const refs = await core.getSecretReferences("consumer"),
    consent = await core.getConsent("consumer");
  const plan = await f.host.foundationPlan(a.instanceId, f.selection);
  expect(plan.compatible).toBe(true);
  await f.host.switchFoundation(a.instanceId, plan.fingerprint, f.selection);
  const selected = await invoke(a.instanceId);
  expect(selected).toMatchObject({
    settings: { label: "saved" },
    context: { agentId: a.instanceId, componentId: "consumer" },
  });
  expect(((await f.host.resources(a.instanceId)) as any).packages).toEqual(
    before.packages,
  );
  expect(await core.getSecretReferences("consumer")).toEqual(refs);
  expect(await core.getConsent("consumer")).toEqual(consent);
  expect(await f.options.secretStore(a.instanceId).get(refs[0]!)).toBe(
    "synthetic-secret",
  );
  core.close();
  const changed = await f.host.foundationStatus(a.instanceId);
  expect(changed.installationId).not.toBe(a.foundation!.installationId);
  const back = await f.host.foundationPlan(
    a.instanceId,
    a.foundation!.selection,
  );
  await f.host.switchFoundation(
    a.instanceId,
    back.fingerprint,
    a.foundation!.selection,
  );
  expect(await invoke(a.instanceId)).toMatchObject({
    settings: (first as any).settings,
  });
  expect(await invoke(b.instanceId)).toMatchObject({
    settings: (other as any).settings,
  });
  await f.host.setFoundationEnabled(a.instanceId, false);
  await expect(invoke(a.instanceId)).rejects.toMatchObject({
    details: { reason: "FOUNDATION_DISABLED" },
  });
  expect(await invoke(b.instanceId)).toBeDefined();
  await f.host.setFoundationEnabled(a.instanceId, true);
  expect(await invoke(a.instanceId)).toBeDefined();
});
it("checks disabled runnable components and Agent requirements before a switch or new composition", async () => {
  const f = await setup(),
    item = await component(f.host, "consumer", {}, "sdk.resources"),
    a = await f.host.createAgent("A", [item.digest]);
  const plan = await f.host.foundationPlan(a.instanceId, f.selection);
  expect(plan.compatible).toBe(false);
  await expect(
    f.host.switchFoundation(a.instanceId, plan.fingerprint, f.selection),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_INCOMPATIBLE" } });
  expect(await f.host.foundationStatus(a.instanceId)).toEqual(a.foundation);
  const empty = await f.host.createAgent(
    "Empty",
    [],
    undefined,
    undefined,
    [],
    {
      requirement: {
        requirementVersion: "1.0",
        protocolRange: "^1.0.0",
        sdk: { id: "org.plums.sdk", version: "2.0.0" },
        features: ["sdk.resources"],
      },
      selection: a.foundation!.selection,
    },
  );
  expect(
    (await f.host.foundationPlan(empty.instanceId, f.selection)).compatible,
  ).toBe(false);
  const third = await f.host.createAgent(
    "Third",
    [],
    undefined,
    undefined,
    [],
    {
      requirement: {
        requirementVersion: "1.0",
        protocolRange: "^1.0.0",
        sdk: { id: "org.plums.sdk", version: "2.0.0" },
        features: [],
      },
      selection: f.selection,
    },
  );
  await expect(
    f.host.addLibraryComponent(third.instanceId, item.digest),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_INCOMPATIBLE" } });
});
it.each([
  "prepare",
  "stop",
  "before-commit",
  "after-commit",
  "ready",
  "activate",
  "after-activate",
] as const)(
  "reports and recovers an injected %s failure without business dispatch",
  async (phase) => {
    const f = await setup();
    await f.host.close();
    let fault: string | undefined;
    const h = new DesktopHost({
      ...f.options,
      foundationSwitchFault: (p) => {
        if (p === fault) throw Error("private path and secret");
      },
    });
    hosts.push(h);
    await h.initialize();
    const item = await component(h),
      a = await h.createAgent("A", [item.digest]);
    await h.enable(a.instanceId, "consumer");
    const plan = await h.foundationPlan(a.instanceId, f.selection);
    fault = phase;
    const error = await h
      .switchFoundation(a.instanceId, plan.fingerprint, f.selection)
      .catch((e) => e);
    expect(error).toMatchObject({
      details: {
        reason: "FOUNDATION_SWITCH_FAILED",
        selectionCommitted: ["activate", "after-activate"].includes(phase),
        executionState: "not_started",
      },
    });
    expect(JSON.stringify(error)).not.toContain("private path");
    const current = await h.foundationStatus(a.instanceId);
    expect(current.selection).toEqual(
      ["activate", "after-activate"].includes(phase)
        ? f.selection
        : a.foundation!.selection,
    );
    fault = undefined;
    await h.close();
    const next = new DesktopHost(f.options);
    hosts.push(next);
    await next.initialize();
    expect(await next.foundationStatus(a.instanceId)).toEqual(current);
  },
);

it.each([
  "prepare",
  "stop",
  "before-commit",
  "after-commit",
  "ready",
  "activate",
  "after-activate",
] as const)("recovers an actual process interruption at %s", async (phase) => {
  const f = await setup(),
    item = await component(f.host),
    a = await f.host.createAgent("A", [item.digest]);
  await f.host.enable(a.instanceId, "consumer");
  await f.host.close();
  const p = fork(
    path.resolve("packages/host/test/foundation-switch-child.mjs"),
    [
      JSON.stringify({
        dataDir: f.options.dataDir,
        id: a.instanceId,
        selection: f.selection,
        phase,
      }),
    ],
    {
      execPath: f.options.nodePath,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const messages: any[] = [];
  p.on("message", (m) => messages.push(m));
  const [code] = await once(p, "exit");
  expect(code).toBe(71);
  expect(messages[0]).toMatchObject({ fault: phase });
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  const selected = await next.foundationStatus(a.instanceId);
  expect(selected.selection).toEqual(
    ["activate", "after-activate"].includes(phase)
      ? f.selection
      : a.foundation!.selection,
  );
  for (const pid of messages[0].pids)
    expect(() => process.kill(pid, 0)).toThrow();
  const { DatabaseSync } = await import("node:sqlite"),
    db = new DatabaseSync(path.join(f.options.dataDir, "foundation-state.db"));
  expect(
    db.prepare("SELECT id FROM snapshots WHERE scope=?").all(a.instanceId),
  ).toEqual([]);
  db.close();
  expect(
    await next.invoke(
      a.instanceId,
      "consumer",
      "consumer",
      "commands",
      "check",
      {},
    ),
  ).toMatchObject({ context: { agentId: a.instanceId } });
});
it("allows shared host readers while rejecting a switch owned by another live process", async () => {
  const f = await setup(),
    a = await f.host.createAgent("A"),
    b = await f.host.createAgent("B");
  const p = fork(
    path.resolve("packages/host/test/foundation-switch-child.mjs"),
    [
      JSON.stringify({
        dataDir: f.options.dataDir,
        id: a.instanceId,
        phase: "hold",
      }),
    ],
    {
      execPath: f.options.nodePath,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  try {
    expect((await once(p, "message"))[0]).toMatchObject({ ready: true });
    const plan = await f.host.foundationPlan(a.instanceId, f.selection);
    await expect(
      f.host.switchFoundation(a.instanceId, plan.fingerprint, f.selection),
    ).rejects.toMatchObject({ details: { reason: "FOUNDATION_BUSY" } });
    await expect(f.host.removeAgent(a.instanceId)).rejects.toMatchObject({
      details: { reason: "FOUNDATION_BUSY" },
    });
    const bp = await f.host.foundationPlan(b.instanceId, f.selection);
    await f.host.switchFoundation(b.instanceId, bp.fingerprint, f.selection);
    expect(await f.host.foundationStatus(a.instanceId)).toEqual(a.foundation);
  } finally {
    const exit = once(p, "exit");
    p.send({ close: true });
    await exit;
  }
});
it("allows one winner for concurrent stale plans without mixing selection identities", async () => {
  const f = await setup(),
    a = await f.host.createAgent("A"),
    plan = await f.host.foundationPlan(a.instanceId, f.selection);
  const outcomes = await Promise.allSettled([
    f.host.switchFoundation(a.instanceId, plan.fingerprint, f.selection),
    f.host.switchFoundation(a.instanceId, plan.fingerprint, f.selection),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find((o) => o.status === "rejected")).toMatchObject({
    reason: { details: { reason: "FOUNDATION_SELECTION_CHANGED" } },
  });
});
it("rejects a different declared data format with an adapter requirement and keeps the original data", async () => {
  const f = await setup(),
    a = await f.host.createAgent("A");
  const bytes = await f.host.exportLibrary(f.selection.digest);
  const { readArchive } = await import("@plumsjs/core");
  const files = await readArchive(bytes),
    m = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
  m.payload.plumsFoundation.dataFormats = ["org.example.other/1"];
  files["manifest.json"] = Buffer.from(JSON.stringify(m));
  const p = (await f.host.preview(await createArchive(files))) as {
    token: string;
  };
  const item = await f.host.importLibrary(p.token),
    selection = { ...f.selection, digest: item.digest };
  const plan = await f.host.foundationPlan(a.instanceId, selection);
  expect(plan).toMatchObject({
    compatible: false,
    failure: { reason: "FOUNDATION_DATA_ADAPTER_REQUIRED" },
  });
  await expect(
    f.host.switchFoundation(a.instanceId, plan.fingerprint, selection),
  ).rejects.toMatchObject({
    details: { reason: "FOUNDATION_DATA_ADAPTER_REQUIRED" },
  });
  expect(await f.host.foundationStatus(a.instanceId)).toEqual(a.foundation);
});

it("can stop and uninstall an Agent with a missing provider without changing its selected pin", async () => {
  const f = await setup(),
    a = await f.host.createAgent("A", [], undefined, undefined, [], {
      requirement: {
        requirementVersion: "1.0",
        protocolRange: "^1.0.0",
        sdk: { id: "org.plums.sdk", version: "2.0.0" },
        features: [],
      },
      selection: f.selection,
    });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    path.join(
      f.options.dataDir,
      "library",
      "objects",
      f.selection.digest + ".zip",
    ),
    "corrupt",
  );
  await f.host.setFoundationEnabled(a.instanceId, false);
  expect(await f.host.foundationStatus(a.instanceId)).toMatchObject({
    enabled: false,
    selection: f.selection,
  });
  await f.host.removeAgent(a.instanceId);
  await f.host.removeLibrary(f.selection.digest);
});

it.each([
  "future-record",
  "future-journal",
  "changed-record",
  "malformed-journal",
])("preserves unrecognized recovery data: %s", async (variant) => {
  const f = await setup(),
    a = await f.host.createAgent("A");
  await f.host.close();
  const child = fork(
    path.resolve("packages/host/test/foundation-switch-child.mjs"),
    [
      JSON.stringify({
        dataDir: f.options.dataDir,
        id: a.instanceId,
        selection: f.selection,
        phase: "after-commit",
      }),
    ],
    {
      execPath: f.options.nodePath,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  expect((await once(child, "exit"))[0]).toBe(71);
  const dir = path.join(f.options.dataDir, "instances", a.instanceId),
    file = path.join(dir, "record.json"),
    journal = path.join(dir, "foundation-transaction.json");
  const record = JSON.parse(await readFile(file, "utf8")),
    transaction = JSON.parse(await readFile(journal, "utf8"));
  if (variant === "future-record") record.recordVersion = 999;
  if (variant === "future-journal") transaction.before.recordVersion = 999;
  if (variant === "changed-record") record.name = "intervening data";
  await writeFile(file, JSON.stringify(record));
  await writeFile(
    journal,
    variant === "malformed-journal" ? "null" : JSON.stringify(transaction),
  );
  const before = await readFile(file),
    beforeJournal = await readFile(journal);
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  await expect(next.foundationStatus(a.instanceId)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect((await next.listAgents())[0]).toHaveProperty("recoveryError");
  expect(await readFile(file)).toEqual(before);
  expect(await readFile(journal)).toEqual(beforeJournal);
});
it.each(["missing", "corrupt"])(
  "blocks an unavailable builtin ZIP (%s) while retaining Agent data",
  async (variant) => {
    const f = await setup(),
      item = await component(f.host),
      a = await f.host.createAgent("A", [item.digest]);
    await f.host.enable(a.instanceId, "consumer");
    const zip = path.join(
      f.options.dataDir,
      "foundations",
      "objects",
      a.foundation!.selection.digest + ".zip",
    );
    if (variant === "missing") await rm(zip);
    else await writeFile(zip, "corrupt");
    await expect(
      f.host.invoke(
        a.instanceId,
        "consumer",
        "consumer",
        "commands",
        "check",
        {},
      ),
    ).rejects.toMatchObject({ details: { reason: "FOUNDATION_UNAVAILABLE" } });
    await f.host.setFoundationEnabled(a.instanceId, false);
    expect(await f.host.foundationStatus(a.instanceId)).toMatchObject({
      enabled: false,
      selection: a.foundation!.selection,
    });
    expect(
      ((await f.host.resources(a.instanceId)) as any).packages,
    ).toHaveLength(1);
  },
);

it("retains actual failed snapshot deletion across a host exit and only recovers after real cleanup", async () => {
  const f = await setup(),
    item = await component(f.host),
    a = await f.host.createAgent("A", [item.digest], undefined, undefined, [], {
      requirement: {
        requirementVersion: "1.0",
        protocolRange: "^1.0.0",
        sdk: { id: "org.plums.sdk", version: "2.0.0" },
        features: [],
      },
      selection: f.selection,
    });
  await f.host.enable(a.instanceId, "consumer");
  const builtin = (await f.host.createAgent("B")).foundation!.selection;
  await f.host.close();
  const child = fork(
    path.resolve("packages/host/test/foundation-switch-child.mjs"),
    [
      JSON.stringify({
        dataDir: f.options.dataDir,
        id: a.instanceId,
        selection: builtin,
        phase: "cleanup-failure",
      }),
    ],
    {
      execPath: f.options.nodePath,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const messages: any[] = [];
  child.on("message", (m) => messages.push(m));
  expect((await once(child, "exit"))[0]).toBe(71);
  expect(messages[0]).toEqual({
    failed: true,
    reason: "FOUNDATION_CLEANUP_FAILED",
    close: "failed",
  });
  const root = path.join(f.options.dataDir, "foundation-snapshots"),
    before = await readdir(root);
  expect(before.length).toBeGreaterThan(0);
  try {
    const blocked = new DesktopHost(f.options);
    hosts.push(blocked);
    await blocked.initialize();
    await expect(blocked.foundationStatus(a.instanceId)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
    expect(await readdir(root)).toEqual(before);
    const { DatabaseSync } = await import("node:sqlite"),
      db = new DatabaseSync(
        path.join(f.options.dataDir, "foundation-state.db"),
      );
    expect(
      db.prepare("SELECT id FROM snapshots WHERE scope=?").all(a.instanceId),
    ).toHaveLength(before.length);
    db.close();
    await blocked.close();
    await chmod(root, 0o700);
    const restored = new DesktopHost(f.options);
    hosts.push(restored);
    await restored.initialize();
    expect(await restored.foundationStatus(a.instanceId)).toEqual(a.foundation);
    expect(await readdir(root)).toEqual([]);
    expect(
      await restored.invoke(
        a.instanceId,
        "consumer",
        "consumer",
        "commands",
        "check",
        {},
      ),
    ).toMatchObject({ context: { agentId: a.instanceId } });
  } finally {
    await chmod(root, 0o700);
  }
});

it("migrates only records without a foundation pin to the current trusted default", async () => {
  const f = await setup(),
    a = await f.host.createAgent("A"),
    b = await f.host.createAgent("B");
  await f.host.close();
  const file = path.join(
      f.options.dataDir,
      "instances",
      a.instanceId,
      "record.json",
    ),
    record = JSON.parse(await readFile(file, "utf8"));
  delete record.foundation;
  await writeFile(file, JSON.stringify(record));
  const next = new DesktopHost({ ...f.options, foundation: f.selection });
  hosts.push(next);
  await next.initialize();
  expect((await next.foundationStatus(a.instanceId)).selection).toEqual(
    f.selection,
  );
  expect(await next.foundationStatus(b.instanceId)).toEqual(b.foundation);
});
it("preserves unknown future foundation bindings and blocks their Agent", async () => {
  const f = await setup(),
    a = await f.host.createAgent("A");
  await f.host.close();
  const file = path.join(
      f.options.dataDir,
      "instances",
      a.instanceId,
      "record.json",
    ),
    record = JSON.parse(await readFile(file, "utf8"));
  record.foundation.bindingVersion = 999;
  await writeFile(file, JSON.stringify(record));
  const before = await readFile(file);
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  await expect(next.foundationStatus(a.instanceId)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(await readFile(file)).toEqual(before);
});
