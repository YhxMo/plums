import assert from "node:assert/strict";
import { mkdtemp, rm, lstat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  REDACTED,
  secretRef,
  type SecretStore,
} from "@plumsjs/core";
import { DesktopHost } from "../src/host.js";
import { FoundationRegistry } from "../src/foundation-factory.js";
const hosts: DesktopHost[] = [],
  directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) await host.close();
  for (const dir of directories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
    await assert.rejects(lstat(dir), { code: "ENOENT" });
  }
});
async function fixture(store?: SecretStore, local = false) {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "plums-host-installed-snapshot-"),
  );
  directories.push(dir);
  const secrets = new MemorySecretStore(),
    egress = new RecordingEgressSink();
  const options = {
    dataDir: dir,
    secretStore: () => store ?? secrets,
    egress,
    confirm: { ask: async () => true },
    audit: async () => {},
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const packageId = "fixture.installed-snapshot";
  const item = await host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(
            JSON.stringify({
              formatVersion: "2.0",
              kind: "extension",
              id: packageId,
              name: "Synthetic installed snapshot",
              version: "1.0.0",
              description: "",
              dependencies: [],
              permissions: local
                ? [
                    {
                      id: "local",
                      kind: "engine",
                      target: "local",
                      reason: "Synthetic local process",
                    },
                  ]
                : [],
              settingsSchema: {
                type: "object",
                properties: {
                  token: {
                    type: "string",
                    "x-secret": true,
                    title: "Token",
                    description: "Synthetic",
                  },
                },
              },
              payload: {
                plumsDesktop: {
                  sdkVersion: "2",
                  runtime: "main.js",
                  frontend: "index.html",
                  ...(local
                    ? {
                        engines: [
                          {
                            id: "local",
                            title: "Synthetic",
                            entry: "engine.mjs",
                            runtime: "node",
                            platforms: [process.platform + "-" + process.arch],
                            protocol: "jsonrpc-jsonl-v1",
                          },
                        ],
                      }
                    : {}),
                  foundation: {
                    requirementVersion: "1.0",
                    protocolRange: "^1.0.0",
                    sdk: { id: "org.plums.sdk", version: "2.0.0" },
                    features: local
                      ? ["sdk.register", "sdk.engine"]
                      : ["sdk.register"],
                  },
                  contributes: {
                    commands: [
                      {
                        name: "echo",
                        title: "Echo",
                        inputSchema: {},
                        outputSchema: {},
                      },
                    ],
                  },
                },
              },
            }),
          ),
          "main.js": Buffer.from(
            "// SYNTHETIC_SOURCE_TEXT\nexport function activate(s){s.register('commands','echo',async v=>v);}",
          ),
          "index.html": Buffer.from(
            "<!doctype html><title>Synthetic frontend</title>",
          ),
          ...(local
            ? {
                "engine.mjs": Buffer.from(`// SYNTHETIC_LOCAL_SOURCE
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.id===undefined)return;
const result=m.method==='initialize'?{protocol:'jsonrpc-jsonl-v1'}:m.method==='pid'?process.pid:m.params;
console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`),
              }
            : {}),
        }),
      )) as { token: string }
    ).token,
  );
  assert.ok("manifest" in item);
  const seed = await host.createAgent("Selection seed");
  const future = JSON.parse(
    '{"id":"id","__proto__":{"selection":{"id":"id"}}}',
  );
  const agent = await host.createAgent(
    "Snapshot fixture",
    [item.digest],
    undefined,
    packageId,
    [],
    {
      selection: { ...seed.foundation!.selection, future },
    },
  );
  const id = agent.instanceId;
  const set = (value: string) =>
    host.setSettings(id, packageId, {}, { token: value });
  return {
    host,
    dir,
    secrets,
    egress,
    agent,
    id,
    packageId,
    item,
    future,
    set,
    options,
  };
}

it.each(["id", "foundation", "SYNTHETIC_SOURCE_TEXT"])(
  "keeps installed compatibility reports and trusted resources foundation usable with credential %s",
  async (value) => {
    const f = await fixture(),
      before = await f.host.foundationPlan(f.id);
    await f.set(value);
    const plan = await f.host.foundationPlan(f.id);
    expect(plan.compatible).toBe(true);
    expect(plan.reports).toEqual(before.reports);
    expect(plan.fingerprint).toBe(before.fingerprint);
    const status = await f.host.foundationStatus(f.id);
    const resources = (await f.host.resources(f.id)) as {
      record: { foundation: unknown };
    };
    expect(resources.record.foundation).toEqual(status);
    expect(status.selection.id).toBe(f.agent.foundation!.selection.id);
    if (value === "id")
      expect(status.selection.future).toEqual(
        JSON.parse(
          '{"[REDACTED]":"[REDACTED]","__proto__":{"selection":{"[REDACTED]":"[REDACTED]"}}}',
        ),
      );
    expect(f.future).toEqual(
      JSON.parse('{"id":"id","__proto__":{"selection":{"id":"id"}}}'),
    );
    await expect(f.host.exportAgent(f.id)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
    const core = createCore({
      dataDir: path.join(f.dir, "instances", f.id, "core"),
      instanceId: f.id,
      secrets: f.secrets,
      egress: f.egress,
    });
    try {
      await expect(core.getPackageContents(f.packageId)).rejects.toMatchObject({
        code: "IMPORT_INVALID",
      });
    } finally {
      core.close();
    }
    expect(f.egress.records).toEqual([]);
  },
);

it.each(["id", "SYNTHETIC_SOURCE_TEXT"])(
  "runs a real worker and loads pinned frontend files despite credential collision %s",
  async (value) => {
    const f = await fixture();
    await f.set(value);
    await f.host.enable(f.id, f.packageId);
    expect((await f.host.frontend(f.id))?.packageId).toBe(f.packageId);
    const result = await f.host.invoke(
      f.id,
      f.packageId,
      f.packageId,
      "commands",
      "echo",
      { [value]: value, nested: { selection: { id: value } } },
    );
    expect(JSON.stringify(result).replaceAll(REDACTED, "")).not.toContain(
      value,
    );
    expect(JSON.stringify(result)).toContain(REDACTED);
    expect(f.egress.records).toEqual([]);
  },
);

it("refreshes the trusted resource projection after restart without rewriting persisted selections", async () => {
  const f = await fixture();
  await f.set("id");
  const before = await f.host.resources(f.id);
  await f.host.close();
  await f.host.initialize();
  expect(await f.host.resources(f.id)).toEqual(before);
  expect(
    (await f.host.listAgents()).find((a) => a.instanceId === f.id)!.foundation,
  ).toEqual(f.agent.foundation);
  await f.set("SYNTHETIC_REPLACEMENT_VALUE");
  expect((await f.host.foundationPlan(f.id)).current.selection.future).toEqual(
    f.future,
  );
});

it.each(["main.js", "extra.js"])(
  "rejects changed installed content at %s before planning, frontend delivery or worker execution",
  async (file) => {
    const f = await fixture();
    await f.host.enable(f.id, f.packageId);
    await f.set("id");
    await writeFile(
      path.join(
        f.dir,
        "instances",
        f.id,
        "core",
        "packages",
        f.packageId,
        file,
      ),
      "modified synthetic bytes",
    );
    for (const read of [
      () => f.host.foundationPlan(f.id),
      () => f.host.frontend(f.id),
      () =>
        f.host.invoke(f.id, f.packageId, f.packageId, "commands", "echo", {}),
    ])
      await expect(read()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.egress.records).toEqual([]);
  },
);

it("hides secret lookup failures from installed plans and resource projections", async () => {
  const backing = new MemorySecretStore();
  let fail = false;
  const marker = "SYNTHETIC_LOOKUP_FAILURE";
  const f = await fixture({
    get: async (ref) => {
      if (fail) throw new Error(marker);
      return backing.get(ref);
    },
    set: (ref, value) => backing.set(ref, value),
    delete: (ref) => backing.delete(ref),
  });
  await backing.set(secretRef(f.packageId, "token"), marker);
  fail = true;
  for (const read of [
    () => f.host.foundationPlan(f.id),
    () => f.host.resources(f.id),
  ]) {
    const error = await read().catch((error) => error);
    expect(error).toMatchObject({ code: "SECRET_NOT_FOUND" });
    expect(String(error)).not.toContain(marker);
    expect(JSON.stringify(error)).not.toContain(marker);
  }
});

it("fails secret enumeration before creating a worker or delivering frontend bytes", async () => {
  const backing = new MemorySecretStore();
  let fail = false;
  const f = await fixture({
    get: async (ref) => {
      if (fail) throw new Error("SYNTHETIC_LOOKUP_FAILURE");
      return backing.get(ref);
    },
    set: (ref, value) => backing.set(ref, value),
    delete: (ref) => backing.delete(ref),
  });
  await f.host.enable(f.id, f.packageId);
  await backing.set(secretRef(f.packageId, "token"), "id");
  const create = vi.spyOn(FoundationRegistry.prototype, "create");
  fail = true;
  await expect(
    f.host.invoke(f.id, f.packageId, f.packageId, "commands", "echo", {}),
  ).rejects.toMatchObject({ code: "SECRET_NOT_FOUND" });
  await expect(f.host.frontend(f.id)).rejects.toMatchObject({
    code: "SECRET_NOT_FOUND",
  });
  expect(create).not.toHaveBeenCalled();
  expect(f.egress.records).toEqual([]);
});

it.each(["id", "SYNTHETIC_LOCAL_SOURCE"])(
  "starts a verified local snapshot with colliding credential %s and cleans its real PID",
  async (value) => {
    const f = await fixture(undefined, true);
    await f.host.enable(f.id, f.packageId);
    const selection = {
      ceiling: "machine" as const,
      projects: [],
      readOnly: [],
      components: [f.packageId],
    };
    const plan = (await f.host.tierPlan(f.id, selection)) as {
      fingerprint: string;
    };
    await f.host.confirmTier(f.id, plan.fingerprint, selection);
    await f.set(value);
    await f.host.engineCall(f.id, f.packageId, "start", { engineId: "local" });
    const pid = (await f.host.engineCall(f.id, f.packageId, "request", {
      engineId: "local",
      method: "pid",
      input: {},
    })) as number;
    expect(Number.isSafeInteger(pid)).toBe(true);
    expect(pid).toBeGreaterThan(0);
    const reply = await f.host.engineCall(f.id, f.packageId, "request", {
      engineId: "local",
      method: "echo",
      input: { [value]: value },
    });
    expect(JSON.stringify(reply).replaceAll(REDACTED, "")).not.toContain(value);
    expect(JSON.stringify(reply)).toContain(REDACTED);
    await f.host.close();
    expect(() => process.kill(pid, 0)).toThrow(
      expect.objectContaining({ code: "ESRCH" }),
    );
    expect(f.egress.records).toEqual([]);
  },
);

it("rejects a tampered local entry before native launch despite a short credential", async () => {
  const f = await fixture(undefined, true);
  await f.host.enable(f.id, f.packageId);
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: [f.packageId],
  };
  const plan = (await f.host.tierPlan(f.id, selection)) as {
    fingerprint: string;
  };
  await f.host.confirmTier(f.id, plan.fingerprint, selection);
  await f.set("id");
  await writeFile(
    path.join(
      f.dir,
      "instances",
      f.id,
      "core",
      "packages",
      f.packageId,
      "engine.mjs",
    ),
    "modified synthetic entry",
  );
  await expect(
    f.host.engineCall(f.id, f.packageId, "start", { engineId: "local" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await f.host.engineStatus(f.id, f.packageId, "local")).toMatchObject({
    state: "stopped",
  });
  expect(f.egress.records).toEqual([]);
});
