import { deflateSync } from "node:zlib";
import { it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  secretRef,
  type ManifestV2,
} from "@plumsjs/core";
import { createAgentBundle, validateAgentBundle } from "@plumsjs/sdk";
import { DesktopHost } from "../src/host.js";
import { pngRole } from "../src/library.js";
const dirs: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((h) => h.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-library-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>();
  const options = {
    dataDir: dir,
    egress: new RecordingEgressSink(),
    fs: new RecordingFsSink(),
    confirm: {
      async ask() {
        return true;
      },
    },
    secretStore: (id: string) => {
      let s = stores.get(id);
      if (!s) {
        s = new MemorySecretStore();
        stores.set(id, s);
      }
      return s;
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  return { dir, host, stores, options };
}
function manifest(
  id: string,
  kind: ManifestV2["kind"] = "character",
  version = "1.0.0",
): ManifestV2 {
  return {
    formatVersion: "2.0",
    id,
    name: id,
    kind,
    version,
    description: "",
    dependencies: [],
    permissions: [],
    payload: { future: { opaque: true } },
  };
}
async function pack(m: ManifestV2, files: Record<string, Uint8Array> = {}) {
  return createArchive({
    "manifest.json": Buffer.from(JSON.stringify(m)),
    ...files,
  });
}
async function importInto(host: DesktopHost, bytes: Uint8Array) {
  const p = (await host.preview(bytes)) as { token: string; type: string };
  expect(p.type).toBe("component");
  return host.importLibrary(p.token);
}
async function extension(
  id = "reader",
  version = "1.0.0",
  dependencies: ManifestV2["dependencies"] = [],
) {
  return pack(
    {
      ...manifest(id, "extension", version),
      dependencies,
      payload: {
        plumsDesktop: {
          sdkVersion: "1",
          runtime: "main.js",
          frontend: "index.html",
          contributes: {
            commands: [
              { name: "read", title: "Read" },
              { name: "list", title: "List" },
            ],
          },
        },
      },
    },
    {
      "index.html": Buffer.from("<h1>Independent</h1>"),
      "main.js": Buffer.from(
        `export function activate(s){s.register('commands','read',i=>s.character(i.id));s.register('commands','list',()=>s.characters());}`,
      ),
    },
  );
}
function png(chunks: [string, Buffer][] = []): Buffer {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const n of body) {
      crc ^= n;
      for (let j = 0; j < 8; j++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    body.copy(b, 4);
    b.writeUInt32BE(~crc >>> 0, b.length - 4);
    return b;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...chunks.map(([key, value]) =>
      chunk("tEXt", Buffer.concat([Buffer.from(key + "\0"), value])),
    ),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
it("imports opaque JSON before any Agent, deduplicates and preserves original bytes", async () => {
  const { host } = await fixture(),
    raw = Buffer.from(
      '{"custom":{"unknown":true},"plumsDesktop":{"userData":true}}',
    );
  const one = await importInto(host, raw),
    two = await importInto(host, raw);
  expect(one.digest).toBe(two.digest);
  expect(await host.listAgents()).toEqual([]);
  expect(await host.listLibrary()).toHaveLength(1);
  const artifact = await host.library.get(one.digest);
  expect(artifact.contents.manifest.permissions).toEqual([]);
  expect(artifact.contents.files["source/card.json"]).toEqual(
    new Uint8Array(raw),
  );
  expect(artifact.contents.manifest.payload).toEqual(
    JSON.parse(raw.toString()),
  );
});
it("extracts ccv3 before chara and rejects corrupt, duplicate, truncated and ordinary PNG", async () => {
  const { host } = await fixture(),
    payload = {
      spec: "chara_card_v3",
      data: { name: "V3", future: { retained: true } },
    };
  const valid = png([
    ["chara", Buffer.from(Buffer.from('{"v":2}').toString("base64"))],
    [
      "ccv3",
      Buffer.from(Buffer.from(JSON.stringify(payload)).toString("base64")),
    ],
  ]);
  const item = await importInto(host, valid);
  expect(
    (await host.library.get(item.digest)).contents.manifest.payload,
  ).toEqual(payload);
  expect(
    (await host.library.get(item.digest)).contents.files["source/card.png"],
  ).toEqual(new Uint8Array(valid));
  expect(() => pngRole(png())).toThrow();
  expect(() => pngRole(valid.subarray(0, -3))).toThrow();
  const damaged = Buffer.from(valid);
  damaged[29] ^= 1;
  expect(() => pngRole(damaged)).toThrow();
  expect(() =>
    pngRole(
      png([
        ["ccv3", Buffer.from("e30=")],
        ["ccv3", Buffer.from("e30=")],
      ]),
    ),
  ).toThrow();
  expect(() =>
    pngRole(
      png([
        ["ccv3", Buffer.from("%%%%")],
        ["chara", Buffer.from("e30=")],
      ]),
    ),
  ).toThrow();
});
it("creates empty and cardless Agents without bundle.zip and exports them", async () => {
  const { host, dir } = await fixture(),
    empty = await host.createAgent("Empty");
  expect(empty.components).toEqual([]);
  expect(await host.frontend(empty.instanceId)).toBeNull();
  const item = await importInto(host, await extension()),
    agent = await host.createAgent(
      "Cardless",
      [item.digest],
      undefined,
      "reader",
    );
  await host.enable(agent.instanceId, "reader");
  expect(
    await host.invoke(
      agent.instanceId,
      "reader",
      "reader",
      "commands",
      "read",
      {},
    ),
  ).toBeNull();
  expect((await host.frontend(agent.instanceId))?.entry).toBe("index.html");
  await expect(
    readFile(path.join(dir, "instances", agent.instanceId, "bundle.zip")),
  ).rejects.toThrow();
  expect(
    (await validateAgentBundle(await host.exportAgent(empty.instanceId)))
      .packages,
  ).toEqual([]);
  const exported = await validateAgentBundle(
    await host.exportAgent(agent.instanceId),
  );
  expect(exported.agent.character).toBeUndefined();
  expect(exported.packages[0]?.contents.manifest.kind).toBe("extension");
});
it("reads only enabled local cards, switches and clears defaults and removes the primary card", async () => {
  const { host } = await fixture(),
    a = await importInto(host, await pack(manifest("one"))),
    b = await importInto(host, await pack(manifest("two"))),
    e = await importInto(host, await extension());
  const agent = await host.createAgent(
      "Multi",
      [a.digest, b.digest, e.digest],
      "one",
    ),
    foreign = await importInto(host, await pack(manifest("foreign")));
  await host.createAgent("Other", [foreign.digest], "foreign");
  await host.enable(agent.instanceId, "reader");
  const invoke = (name: string, input = {}) =>
    host.invoke(agent.instanceId, "reader", "reader", "commands", name, input);
  expect(await invoke("read")).toBeNull();
  await expect(invoke("read", { id: "one" })).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(await invoke("list")).toEqual([]);
  await host.enable(agent.instanceId, "one");
  await host.enable(agent.instanceId, "two");
  expect(await invoke("list")).toHaveLength(2);
  await expect(invoke("read", { id: "foreign" })).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await host.setCharacter(agent.instanceId, "two");
  expect(await invoke("read")).toEqual(manifest("two").payload);
  await host.setCharacter(agent.instanceId);
  expect(await invoke("read")).toBeNull();
  expect(await invoke("read", { id: "one" })).toEqual(manifest("one").payload);
  await host.setCharacter(agent.instanceId, "one");
  await host.uninstallPackage(agent.instanceId, "one");
  expect(await invoke("read")).toBeNull();
  expect((await host.listAgents())[0]?.characterId).toBeUndefined();
});
it("keeps independent instance consent, settings and secrets while pinning versions", async () => {
  const { host, stores } = await fixture();
  const m = {
    ...manifest("settings", "extension"),
    settingsSchema: {
      type: "object" as const,
      properties: {
        label: { type: "string" as const, title: "Label", description: "" },
        key: {
          type: "string" as const,
          title: "Key",
          description: "",
          "x-secret": true,
        },
      },
    },
  };
  const v1 = await importInto(host, await pack(m)),
    a = await host.createAgent("A", [v1.digest]),
    b = await host.createAgent("B", [v1.digest]);
  await host.enable(a.instanceId, "settings");
  await host.setSettings(
    a.instanceId,
    "settings",
    { label: "one" },
    { key: "fake-library-secret" },
  );
  const resources = (await host.resources(b.instanceId)) as any;
  expect(resources.packages[0].enabled).toBe(false);
  expect(resources.packages[0].settings.values).toEqual({});
  expect(resources.packages[0].settings.secrets.key).toBe(false);
  expect(stores.get(a.instanceId)).not.toBe(stores.get(b.instanceId));
  await expect(host.exportLibrary(v1.digest)).resolves.toBeInstanceOf(
    Uint8Array,
  );
  const v2 = await importInto(host, await pack({ ...m, version: "2.0.0" }));
  expect(
    (await host.listAgents()).every(
      (r) => r.components![0]!.digest === v1.digest,
    ),
  ).toBe(true);
  const p = (await host.previewLibraryUpdate(a.instanceId, v2.digest)) as {
    token: string;
  };
  await host.updatePackage(a.instanceId, p.token, "settings");
  expect(
    (await host.listAgents()).find((r) => r.instanceId === a.instanceId)
      ?.components![0]?.digest,
  ).toBe(v2.digest);
  expect(
    (await host.listAgents()).find((r) => r.instanceId === b.instanceId)
      ?.components![0]?.digest,
  ).toBe(v1.digest);
  await expect(host.removeLibrary(v1.digest)).rejects.toThrow();
  await host.removeAgent(b.instanceId);
  await host.removeLibrary(v1.digest);
});
it("stores unmet dependencies but blocks invalid assemblies and leaves the original intact", async () => {
  const { host, dir } = await fixture(),
    dep = await importInto(
      host,
      await extension("needs", "1.0.0", [
        { id: "service", kind: "connector", range: "^1.0.0" },
      ]),
    );
  expect((await host.listLibrary())[0]?.missingDependencies).toHaveLength(1);
  await expect(host.createAgent("Broken", [dep.digest])).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(await host.listAgents()).toEqual([]);
  expect(await readdir(path.join(dir, "instances"))).toEqual([]);
  const empty = await host.createAgent("Keep");
  await expect(
    host.addLibraryComponent(empty.instanceId, dep.digest),
  ).rejects.toThrow();
  expect(((await host.resources(empty.instanceId)) as any).packages).toEqual(
    [],
  );
  const connector = await importInto(
    host,
    await pack(manifest("service", "connector")),
  );
  await host.addLibraryComponent(empty.instanceId, connector.digest);
  await host.addLibraryComponent(empty.instanceId, dep.digest);
  await expect(
    host.uninstallPackage(empty.instanceId, "service"),
  ).rejects.toThrow();
  await expect(
    host.createAgent("Duplicate", [connector.digest, connector.digest]),
  ).rejects.toThrow();
});
it("migrates real installed versions, consent, settings, secrets and unknown bundle fields once", async () => {
  const { host, dir, options, stores } = await fixture(),
    legacy = {
      ...manifest("legacy"),
      settingsSchema: {
        type: "object" as const,
        properties: {
          custom: { type: "string" as const, title: "Custom", description: "" },
          key: {
            type: "string" as const,
            title: "Key",
            description: "",
            "x-secret": true,
          },
        },
      },
    },
    card = await pack(legacy);
  const preview = (await host.preview(
    await createAgentBundle(
      {
        bundleVersion: "1.0",
        id: "old",
        name: "Old",
        version: "1.0.0",
        character: "legacy.zip",
        extensions: [],
        connectors: [],
        unknown: { retained: true },
      },
      { "legacy.zip": card },
      { "notes.txt": Buffer.from("retained") },
    ),
  )) as { token: string };
  const agent = await host.install(preview.token);
  await host.enable(agent.instanceId, "legacy");
  await host.setSettings(
    agent.instanceId,
    "legacy",
    { custom: "before" },
    { key: "fake-migration-key" },
  );
  const agentDir = path.join(dir, "instances", agent.instanceId),
    exported = await host.exportAgent(agent.instanceId);
  host.close();
  await writeFile(path.join(agentDir, "bundle.zip"), exported);
  const record = { ...agent } as any;
  delete record.recordVersion;
  delete record.components;
  delete record.extras;
  await writeFile(path.join(agentDir, "record.json"), JSON.stringify(record));
  const core = createCore({
    dataDir: path.join(agentDir, "core"),
    secrets: stores.get(agent.instanceId)!,
    egress: new RecordingEgressSink(),
  });
  await core.updatePackage(
    await pack({ ...legacy, version: "2.0.0", payload: { newVersion: true } }),
  );
  await core.setSettings("legacy", {
    custom: "saved",
    key: secretRef("legacy", "key"),
  });
  core.close();
  const migrated = new DesktopHost(options);
  hosts.push(migrated);
  await migrated.initialize();
  const next = (await migrated.listAgents())[0]!;
  expect(next.recordVersion).toBe(2);
  expect(next.components![0]?.version).toBe("2.0.0");
  const resources = (await migrated.resources(next.instanceId)) as any;
  expect(resources.packages[0].enabled).toBe(true);
  expect(resources.packages[0].settings.values.custom).toBe("saved");
  expect(resources.packages[0].settings.secrets.key).toBe(true);
  expect(
    await stores.get(agent.instanceId)!.get(secretRef("legacy", "key")),
  ).toBe("fake-migration-key");
  await rm(path.join(agentDir, "bundle.zip"));
  const bundle = await validateAgentBundle(
    await migrated.exportAgent(next.instanceId),
  );
  expect(bundle.agent.unknown).toEqual({ retained: true });
  expect(Buffer.from(bundle.files["notes.txt"]!).toString()).toBe("retained");
  migrated.close();
  await migrated.initialize();
  expect((await migrated.listAgents())[0]?.components).toEqual(next.components);
});
it("recovers committed assembly journals and discards uncommitted journals and staging", async () => {
  const { host, dir, options, stores } = await fixture(),
    agent = await host.createAgent("Recovery"),
    item = await importInto(host, await pack(manifest("added")));
  host.close();
  const agentDir = path.join(dir, "instances", agent.instanceId),
    next = {
      ...agent,
      components: [
        {
          packageId: "added",
          version: "1.0.0",
          kind: "character",
          digest: item.digest,
          archive: "components/added.zip",
        },
      ],
      agent: { ...agent.agent, characters: ["components/added.zip"] },
    };
  const core = createCore({
    dataDir: path.join(agentDir, "core"),
    secrets: stores.get(agent.instanceId)!,
    egress: new RecordingEgressSink(),
  });
  await core.importPackage((await host.library.get(item.digest)).bytes);
  core.close();
  await writeFile(
    path.join(agentDir, "assembly-transaction.json"),
    JSON.stringify({
      packageId: "added",
      version: "1.0.0",
      beforeVersion: null,
      next,
    }),
  );
  await mkdir(path.join(dir, "instances", ".staging-interrupted"));
  const recovered = new DesktopHost(options);
  hosts.push(recovered);
  await recovered.initialize();
  expect((await recovered.listAgents())[0]?.components).toEqual(
    next.components,
  );
  await expect(
    readFile(path.join(agentDir, "assembly-transaction.json")),
  ).rejects.toThrow();
  expect(await readdir(path.join(dir, "instances"))).toEqual([
    agent.instanceId,
  ]);
  recovered.close();
  await writeFile(
    path.join(agentDir, "assembly-transaction.json"),
    JSON.stringify({
      packageId: "added",
      version: "2.0.0",
      beforeVersion: "1.0.0",
      next: { ...next, name: "bad" },
    }),
  );
  await recovered.initialize();
  expect((await recovered.listAgents())[0]?.name).toBe("Recovery");
});
it("rejects malformed raw cards and tampered library objects without creating Agents", async () => {
  const { host, dir } = await fixture();
  for (const raw of ["null", "[]", "{bad", '"string"'])
    await expect(host.preview(Buffer.from(raw))).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
  const item = await importInto(host, await pack(manifest("tamper")));
  await writeFile(
    path.join(dir, "library/objects", item.digest + ".zip"),
    Buffer.from("bad"),
  );
  await expect(host.createAgent("Tamper", [item.digest])).rejects.toThrow();
  expect(await host.listAgents()).toEqual([]);
});

it("keeps a failed migration untouched and leaves other Agents manageable", async () => {
  const { host, dir, options } = await fixture();
  const healthy = await host.createAgent("Healthy");
  const broken = await host.createAgent("Old Broken"),
    file = path.join(dir, "instances", broken.instanceId, "record.json");
  host.close();
  const record = { ...broken } as any;
  delete record.recordVersion;
  delete record.components;
  await writeFile(file, JSON.stringify(record));
  const before = await readFile(file, "utf8");
  const restarted = new DesktopHost(options);
  hosts.push(restarted);
  await restarted.initialize();
  expect(await readFile(file, "utf8")).toBe(before);
  expect(
    (await restarted.listAgents()).find(
      (a) => a.instanceId === broken.instanceId,
    )?.recoveryError,
  ).toContain("原始数据已保留");
  expect(
    ((await restarted.resources(healthy.instanceId)) as any).packages,
  ).toEqual([]);
  await expect(restarted.frontend(broken.instanceId)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(
    ((await restarted.resources(broken.instanceId)) as any).record
      .recoveryError,
  ).toBeTruthy();
});
it("blocks secret-bearing component export and cleans only unpublished library artifacts", async () => {
  const { host, dir } = await fixture();
  const m = {
    ...manifest("owner", "extension"),
    settingsSchema: {
      type: "object" as const,
      properties: {
        key: {
          type: "string" as const,
          title: "Key",
          description: "",
          "x-secret": true,
        },
      },
    },
  };
  const item = await importInto(host, await pack(m)),
    agent = await host.createAgent("Owner", [item.digest]);
  await host.setSettings(
    agent.instanceId,
    "owner",
    {},
    { key: "fake-protected-library-key" },
  );
  const unsafe = await importInto(
    host,
    Buffer.from('{"raw":"fake-protected-library-key"}'),
  );
  await expect(host.exportLibrary(unsafe.digest)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  const orphan = "a".repeat(64);
  await writeFile(path.join(dir, "library/objects", orphan + ".zip"), "orphan");
  await mkdir(path.join(dir, "library", ".staging-interrupted"));
  host.close();
  await host.initialize();
  await expect(
    readFile(path.join(dir, "library/objects", orphan + ".zip")),
  ).rejects.toThrow();
  expect((await host.listLibrary()).some((p) => p.digest === item.digest)).toBe(
    true,
  );
});

it.each([0, 3, "2", null])(
  "refuses unsupported desktop record version %s before publishing recovery journals",
  async (version) => {
    const { host, dir, options } = await fixture();
    const agent = await host.createAgent("Future record");
    await host.close();
    const agentDir = path.join(dir, "instances", agent.instanceId);
    const file = path.join(agentDir, "record.json");
    const record = {
      ...agent,
      recordVersion: version,
      future: { opaque: true },
    };
    await writeFile(file, JSON.stringify(record));
    const journal = path.join(agentDir, "assembly-transaction.json");
    await writeFile(
      journal,
      JSON.stringify({
        packageId: "absent",
        version: null,
        beforeVersion: null,
        next: { ...agent, name: "must not publish" },
      }),
    );
    const before = await readFile(file);
    const pending = await readFile(journal);
    const restarted = new DesktopHost(options);
    hosts.push(restarted);
    await restarted.initialize();
    expect(await readFile(file)).toEqual(before);
    expect(await readFile(journal)).toEqual(pending);
    expect((await restarted.listAgents())[0]?.recoveryError).toContain(
      "原始数据已保留",
    );
    await expect(restarted.frontend(agent.instanceId)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
  },
);

it.each([0, 3, "2", null])(
  "preserves supported records and journals containing unsupported next version %s",
  async (version) => {
    const { host, dir, options } = await fixture();
    const agent = await host.createAgent("Supported record");
    await host.close();
    const agentDir = path.join(dir, "instances", agent.instanceId);
    const file = path.join(agentDir, "record.json");
    const journal = path.join(agentDir, "assembly-transaction.json");
    await writeFile(
      journal,
      JSON.stringify({
        packageId: "absent",
        version: null,
        beforeVersion: null,
        next: { ...agent, recordVersion: version, name: "must not publish" },
      }),
    );
    const before = await readFile(file),
      pending = await readFile(journal);
    const restarted = new DesktopHost(options);
    hosts.push(restarted);
    await restarted.initialize();
    expect(await readFile(file)).toEqual(before);
    expect(await readFile(journal)).toEqual(pending);
    expect((await restarted.listAgents())[0]?.recoveryError).toContain(
      "原始数据已保留",
    );
    await expect(restarted.frontend(agent.instanceId)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
  },
);

it.each([false, true])(
  "recovers assembly metadata only when the package commit exists (%s)",
  async (committed) => {
    const { host, dir, options } = await fixture();
    const original = await importInto(host, await extension("recoverable"));
    const agent = await host.createAgent("Before", [original.digest]);
    await host.enable(agent.instanceId, "recoverable");
    const newer = await importInto(
      host,
      await extension("recoverable", "1.1.0"),
    );
    if (committed) {
      const update = (await host.previewLibraryUpdate(
        agent.instanceId,
        newer.digest,
      )) as { token: string };
      await host.updatePackage(
        agent.instanceId,
        update.token,
        "recoverable",
        true,
      );
    }
    await host.close();
    const agentDir = path.join(dir, "instances", agent.instanceId),
      file = path.join(agentDir, "record.json");
    const current = JSON.parse(await readFile(file, "utf8"));
    const next = { ...current, name: "After", future: { retained: true } };
    await writeFile(
      path.join(agentDir, "assembly-transaction.json"),
      JSON.stringify({
        packageId: "recoverable",
        version: "1.1.0",
        beforeVersion: "1.0.0",
        next,
      }),
    );
    const restarted = new DesktopHost(options);
    hosts.push(restarted);
    await restarted.initialize();
    const recovered = (await restarted.listAgents())[0]!;
    expect(recovered.name).toBe(committed ? "After" : "Before");
    expect(recovered.components![0]?.version).toBe(
      committed ? "1.1.0" : "1.0.0",
    );
    await expect(
      readFile(path.join(agentDir, "assembly-transaction.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      ((await restarted.resources(agent.instanceId)) as any).packages[0]
        .enabled,
    ).toBe(true);
  },
);

it.each(["1", "2"])(
  "migrates legacy SDK %s records with local secrets and exact consent, without reviving read grants or exporting authorization",
  async (sdkVersion) => {
    const f = await fixture();
    await f.host.close();
    const { LocalSecretStore } = await import("../src/secrets.js");
    const options = {
      ...f.options,
      secretStore: (id: string) =>
        new LocalSecretStore(path.join(f.dir, "instances", id, "secrets")),
    };
    const host = new DesktopHost(options);
    hosts.push(host);
    await host.initialize();
    const component = {
      ...manifest("legacy-reader", "extension"),
      formatVersion: "2.7",
      future: { opaque: [1, null] },
      permissions: [
        {
          id: "files",
          kind: "fs",
          target: "agent-data",
          operations: ["read"],
          reason: "fixture",
          future: { opaque: true },
        },
      ],
      settingsSchema: {
        type: "object",
        properties: {
          label: { type: "string", title: "Label", description: "" },
          key: {
            type: "string",
            title: "Key",
            description: "",
            "x-secret": true,
          },
        },
      },
      payload: {
        opaque: { business: true },
        plumsDesktop: {
          sdkVersion,
          runtime: "main.js",
          contributes: {
            commands: [
              { name: "read", title: "Read" },
              { name: "settings", title: "Settings" },
            ],
          },
        },
      },
    } as ManifestV2;
    const bytes = await pack(component, {
      "main.js": Buffer.from(
        "export function activate(s){s.register('commands','read',()=>s.capability('files',{kind:'fs',operation:'read',path:'fixture.txt'}));s.register('commands','settings',()=>s.settings());}",
      ),
    });
    const { createAgentBundle } = await import("@plumsjs/sdk");
    const archive = await createAgentBundle(
      {
        bundleVersion: "1.0",
        id: "old",
        name: "Old",
        version: "1.0.0",
        extensions: ["reader.zip"],
        connectors: [],
        future: { retained: true },
      },
      { "reader.zip": bytes },
    );
    const agent = await host.install(
      ((await host.preview(archive)) as { token: string }).token,
    );
    await host.setSettings(
      agent.instanceId,
      "legacy-reader",
      { label: "retained" },
      { key: "fixture-private-key" },
    );
    await host.enable(agent.instanceId, "legacy-reader");
    const before = (await host.resources(agent.instanceId)) as any;
    const agentDir = path.join(f.dir, "instances", agent.instanceId),
      file = path.join(agentDir, "record.json");
    await host.close();
    await writeFile(path.join(agentDir, "bundle.zip"), archive);
    const record = { ...agent, future: { retained: true } } as any;
    delete record.recordVersion;
    delete record.components;
    delete record.extras;
    await writeFile(file, JSON.stringify(record));
    const restarted = new DesktopHost(options);
    hosts.push(restarted);
    await restarted.initialize();
    const after = (await restarted.resources(agent.instanceId)) as any;
    expect(after.packages[0].installedAt).toBe(before.packages[0].installedAt);
    expect(after.packages[0].consented).toBe(true);
    expect(after.packages[0].enabled).toBe(true);
    expect(after.packages[0].manifest).toEqual(before.packages[0].manifest);
    expect(after.packages[0].settings.values.label).toBe("retained");
    expect(after.packages[0].settings.secrets.key).toBe(true);
    expect(
      await options
        .secretStore(agent.instanceId)
        .get(secretRef("legacy-reader", "key")),
    ).toBe("fixture-private-key");
    expect((JSON.parse(await readFile(file, "utf8")) as any).future).toEqual({
      retained: true,
    });
    expect(
      await restarted.invoke(
        agent.instanceId,
        "legacy-reader",
        "legacy-reader",
        "commands",
        "settings",
        {},
      ),
    ).toEqual({ label: "retained" });
    options.confirm.ask = async () => false;
    await expect(
      restarted.invoke(
        agent.instanceId,
        "legacy-reader",
        "legacy-reader",
        "commands",
        "read",
        {},
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    const exported = await validateAgentBundle(
      await restarted.exportAgent(agent.instanceId),
    );
    expect(exported.agent.bundleVersion).toBe("1.0");
    expect(exported.agent.future).toEqual({ retained: true });
    expect(exported.packages[0]!.contents.manifest.formatVersion).toBe("2.7");
    expect((exported.packages[0]!.contents.manifest as any).future).toEqual({
      opaque: [1, null],
    });
    const names = Object.keys(exported.files).join(" ");
    expect(names).not.toMatch(
      /secret|settings|grant|authorization|resource|task/,
    );
    const imported = await restarted.install(
      (
        (await restarted.preview(
          await restarted.exportAgent(agent.instanceId),
        )) as { token: string }
      ).token,
    );
    const importedResources = (await restarted.resources(
      imported.instanceId,
    )) as any;
    expect(importedResources.packages[0].enabled).toBe(false);
    expect(importedResources.packages[0].consented).toBe(false);
    expect(importedResources.packages[0].settings.secrets.key).toBe(false);
  },
);
