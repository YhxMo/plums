import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  chmod,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sign } from "node:crypto";
import { MemorySecretStore, createArchive, readArchive } from "@plumsjs/core";
import { parseFoundationAgent } from "@plumsjs/sdk";
import { DesktopHost } from "../src/host.js";
import { digest } from "../src/library.js";
const roots: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-product-"));
  roots.push(dir);
  const options = {
    dataDir: dir,
    nodePath: path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node"),
    confirm: { ask: async () => true },
    secretStore: () => new MemorySecretStore(),
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  return { host, dir, options };
}
async function component(host: DesktopHost) {
  const bytes = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify({
        formatVersion: "2.0",
        kind: "extension",
        id: "fixture",
        name: "Fixture",
        version: "1.0.0",
        description: "Internal fixture",
        dependencies: [],
        permissions: [],
        payload: {
          plumsDesktop: {
            sdkVersion: "2",
            runtime: "main.js",
            contributes: { commands: [{ name: "check", title: "Check" }] },
          },
        },
      }),
    ),
    "main.js": Buffer.from(
      "export function activate(s){s.register('commands','check',async()=>await s.context());}",
    ),
  });
  const p = (await host.preview(bytes)) as { token: string };
  return host.importLibrary(p.token) as Promise<{ digest: string }>;
}
async function historicalArtifact() {
  const bytes = await readFile(
      "packages/host/dist/foundation-resources/official.zip",
    ),
    files = await readArchive(bytes),
    metadata = JSON.parse(Buffer.from(files["official.json"]!).toString()),
    manifest = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
  metadata.version = manifest.version = "0.9.0";
  files["official.json"] = Buffer.from(JSON.stringify(metadata));
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  files["code/original-adapter.mjs"] = files["code/adapter.mjs"]!;
  files["code/adapter.mjs"] = Buffer.from(
    "import {createOfficialFoundationSession as original,PlumsError} from './original-adapter.mjs';export {PlumsError};export function createOfficialFoundationSession(...a){const s=original(...a),call=s.invoke.bind(s);s.invoke=async(...args)=>({historical:true,value:await call(...args)});return s;}",
  );
  delete files["signature.json"];
  const inventory = Object.fromEntries(
      Object.keys(files)
        .sort()
        .map((k) => [k, digest(files[k]!)]),
    ),
    key = await readFile(
      process.env.PLUMS_OFFICIAL_SIGNING_KEY ??
        ".artifacts/foundation-signing/private.pem",
    );
  files["signature.json"] = Buffer.from(
    JSON.stringify({
      signatureVersion: 1,
      signature: sign(
        null,
        Buffer.from(JSON.stringify(inventory)),
        key,
      ).toString("base64"),
    }),
  );
  return createArchive(files);
}
it("offline defaults install only the official artifact and export a portable exact selection without local authorization", async () => {
  const f = await fixture(),
    a = await f.host.createAgent("Empty");
  const view = await f.host.foundationManagement();
  expect(view.catalog).toHaveLength(1);
  expect(await f.host.listLibrary()).toHaveLength(0);
  expect(await f.host.resources(a.instanceId)).toMatchObject({ packages: [] });
  const files = await readArchive(await f.host.exportAgent(a.instanceId)),
    agent = JSON.parse(Buffer.from(files["agent.json"]!).toString());
  expect(agent.foundation).toEqual({ selection: a.foundation!.selection });
  expect(parseFoundationAgent(agent.foundation)).toEqual(agent.foundation);
  expect(Buffer.from(files["agent.json"]!).toString()).not.toContain(
    a.foundation!.installationId,
  );
  expect(Object.keys(files)).not.toContain("record.json");
});
it("preserves and really executes historical signed code through a restart and protects disabled references", async () => {
  const f = await fixture(),
    item = await component(f.host),
    oldBytes = await historicalArtifact(),
    preview = (await f.host.preview(oldBytes)) as {
      token: string;
      type: string;
      selection: any;
    };
  expect(preview.type).toBe("foundation");
  await f.host.importLibrary(preview.token);
  const a = await f.host.createAgent(
    "Old",
    [item.digest],
    undefined,
    undefined,
    undefined,
    { selection: preview.selection },
  );
  await f.host.enable(a.instanceId, "fixture");
  expect(
    await f.host.invoke(
      a.instanceId,
      "fixture",
      "fixture",
      "commands",
      "check",
      {},
    ),
  ).toMatchObject({ historical: true, value: { agentId: a.instanceId } });
  await f.host.close();
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  expect(await next.foundationStatus(a.instanceId)).toEqual(a.foundation);
  expect(
    await next.invoke(
      a.instanceId,
      "fixture",
      "fixture",
      "commands",
      "check",
      {},
    ),
  ).toMatchObject({ historical: true, value: { agentId: a.instanceId } });
  const b = await next.createAgent("Current");
  expect(b.foundation!.selection.digest).not.toEqual(preview.selection.digest);
  await next.setFoundationEnabled(a.instanceId, false);
  await expect(next.removeFoundation(preview.selection)).rejects.toMatchObject({
    details: { reason: "FOUNDATION_IN_USE" },
  });
  expect(digest(await next.exportFoundation(preview.selection))).toEqual(
    preview.selection.digest,
  );
  const plan = await next.foundationPlan(a.instanceId, b.foundation!.selection);
  await next.switchFoundation(a.instanceId, plan.fingerprint, plan.candidate);
  expect(
    await next.invoke(
      a.instanceId,
      "fixture",
      "fixture",
      "commands",
      "check",
      {},
    ),
  ).toMatchObject({ agentId: a.instanceId });
  await next.removeFoundation(preview.selection);
});
it("imports a portable Agent with a missing pin without granting permission; management repairs it explicitly", async () => {
  const f = await fixture(),
    a = await f.host.createAgent("Source"),
    files = await readArchive(await f.host.exportAgent(a.instanceId)),
    agent = JSON.parse(Buffer.from(files["agent.json"]!).toString());
  agent.foundation.selection.version = "99.0.0";
  agent.foundation.selection.digest = "a".repeat(64);
  files["agent.json"] = Buffer.from(JSON.stringify(agent));
  const preview = (await f.host.preview(await createArchive(files))) as {
      token: string;
    },
    imported = await f.host.install(preview.token);
  expect(imported.foundation).toMatchObject({
    enabled: false,
    selection: agent.foundation.selection,
  });
  const management = await f.host.foundationManagement(imported.instanceId);
  expect(management.agents[0]).toMatchObject({
    compatible: false,
    reason: "FOUNDATION_UNAVAILABLE",
  });
  await expect(
    f.host.setFoundationEnabled(imported.instanceId, true),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_UNAVAILABLE" } });
  const plan = await f.host.foundationPlan(
    imported.instanceId,
    a.foundation!.selection,
  );
  await f.host.switchFoundation(
    imported.instanceId,
    plan.fingerprint,
    plan.candidate,
  );
  expect(await f.host.foundationStatus(imported.instanceId)).toMatchObject({
    enabled: true,
    selection: a.foundation!.selection,
  });
});
it("rejects forged builtin packages and changed runtime bytes; restores missing current objects without changing Agent pins", async () => {
  const f = await fixture(),
    bytes = await readFile(
      "packages/host/dist/foundation-resources/official.zip",
    ),
    files = await readArchive(bytes);
  files["code/adapter.mjs"] = Buffer.from('throw Error("forged");');
  await expect(
    f.host.preview(await createArchive(files)),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_INVALID" } });
  const a = await f.host.createAgent("A"),
    file = path.join(
      f.dir,
      "foundations/objects",
      a.foundation!.selection.digest + ".zip",
    );
  await rm(file);
  expect(await f.host.foundationPlan(a.instanceId)).toMatchObject({
    compatible: false,
    failure: { reason: "FOUNDATION_UNAVAILABLE" },
  });
  await f.host.restoreBuiltinFoundation();
  expect(await f.host.foundationStatus(a.instanceId)).toEqual(a.foundation);
  expect(await f.host.foundationPlan(a.instanceId)).toMatchObject({
    compatible: true,
  });
});
it("keeps corrupt and future record bytes and offers a recovery entry independently of runnable sessions", async () => {
  const f = await fixture(),
    a = await f.host.createAgent("Future");
  await f.host.close();
  const file = path.join(f.dir, "instances", a.instanceId, "record.json"),
    record = JSON.parse(await readFile(file, "utf8"));
  record.foundation.bindingVersion = 99;
  const original = JSON.stringify(record);
  await writeFile(file, original);
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  expect(
    (await next.foundationManagement()).agents.find(
      (x) => x.instanceId === a.instanceId,
    ),
  ).toMatchObject({
    recoveryBlocked: true,
    reason: "FOUNDATION_RECOVERY_REQUIRED",
  });
  await expect(
    next.retryFoundationRecovery(a.instanceId),
  ).rejects.toMatchObject({
    details: { reason: "FOUNDATION_RECOVERY_REQUIRED" },
  });
  expect(await readFile(file, "utf8")).toBe(original);
  await writeFile(file, "{invalid");
  expect(
    (await next.foundationManagement()).agents.find(
      (x) => x.instanceId === a.instanceId,
    ),
  ).toMatchObject({ recoveryBlocked: true });
  expect(await readFile(file, "utf8")).toBe("{invalid");
});

it("round-trips unknown same-major selection fields and treats ordinary artifact filenames as component files", async () => {
  const f = await fixture(),
    a = await f.host.createAgent("Source"),
    selection = {
      ...a.foundation!.selection,
      futureDisplay: { channel: "stable" },
    };
  const pinned = await f.host.createAgent(
    "Pinned",
    [],
    undefined,
    undefined,
    undefined,
    { selection },
  );
  expect((await f.host.foundationPlan(pinned.instanceId)).compatible).toBe(
    true,
  );
  const exported = await readArchive(
    await f.host.exportAgent(pinned.instanceId),
  );
  expect(
    JSON.parse(Buffer.from(exported["agent.json"]!).toString()).foundation
      .selection,
  ).toEqual(selection);
  expect(digest(await f.host.exportFoundation(selection))).toBe(
    selection.digest,
  );
  const bytes = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify({
        formatVersion: "2.0",
        kind: "extension",
        id: "ordinary-files",
        name: "Ordinary files",
        version: "1.0.0",
        description: "Fixture",
        dependencies: [],
        permissions: [],
        payload: {},
      }),
    ),
    "official.json": Buffer.from("ordinary content"),
    "adapter.json": Buffer.from("ordinary content"),
  });
  const preview = (await f.host.preview(bytes)) as {
    type: string;
    token: string;
  };
  expect(preview.type).toBe("component");
  expect(await f.host.importLibrary(preview.token)).toMatchObject({
    manifest: { id: "ordinary-files" },
  });
});

async function independentProvider(host: DesktopHost) {
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
                features: ["sdk.register", "sdk.context"],
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
  const p = (await host.preview(bytes)) as { token: string };
  await host.importLibrary(p.token);
  return { bytes, selection: (await host.listFoundations())[0]!.selection };
}
it("keeps a missing third-party pin on portable import and requires explicit recovery without enabling components", async () => {
  const source = await fixture(),
    provider = await independentProvider(source.host),
    item = await component(source.host),
    original = await source.host.createAgent(
      "Portable",
      [item.digest],
      undefined,
      undefined,
      undefined,
      { selection: provider.selection },
    );
  const bytes = await source.host.exportAgent(original.instanceId),
    receiver = await fixture(),
    preview = (await receiver.host.preview(bytes)) as { token: string },
    a = await receiver.host.install(preview.token);
  expect(a.foundation).toMatchObject({
    enabled: false,
    selection: provider.selection,
  });
  expect((await receiver.host.resources(a.instanceId)).packages).toEqual([
    expect.objectContaining({ id: "fixture", enabled: false }),
  ]);
  expect(
    (await receiver.host.foundationManagement(a.instanceId)).agents[0],
  ).toMatchObject({ compatible: false, reason: "FOUNDATION_UNAVAILABLE" });
  await expect(
    receiver.host.setFoundationEnabled(a.instanceId, true),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_UNAVAILABLE" } });
  const p = (await receiver.host.preview(provider.bytes)) as { token: string };
  await receiver.host.importLibrary(p.token);
  expect((await receiver.host.foundationStatus(a.instanceId)).enabled).toBe(
    false,
  );
  await receiver.host.setFoundationEnabled(a.instanceId, true);
  expect(
    (await receiver.host.foundationStatus(a.instanceId)).selection,
  ).toEqual(provider.selection);
  expect(
    (await receiver.host.resources(a.instanceId)).packages[0]!.enabled,
  ).toBe(false);
});
it("retains healthy third-party candidates when one ordinary library object is corrupt", async () => {
  const f = await fixture(),
    provider = await independentProvider(f.host),
    item = await component(f.host);
  await rm(path.join(f.dir, "library/objects", item.digest + ".zip"));
  const view = await f.host.foundationManagement();
  expect(view.catalogFailure).toBe(true);
  expect(view.catalog.map((x) => x.selection)).toContainEqual(
    provider.selection,
  );
  const a = await f.host.createAgent(
    "Recovered",
    [],
    undefined,
    undefined,
    undefined,
    { selection: provider.selection },
  );
  expect((await f.host.foundationPlan(a.instanceId)).compatible).toBe(true);
});
it("retains failed pre-return official snapshot cleanup through close and a real process restart", async () => {
  const f = await fixture(),
    item = await component(f.host),
    a = await f.host.createAgent("Cleanup", [item.digest]);
  await f.host.enable(a.instanceId, "fixture");
  await f.host.close();
  const folder = path.join(f.dir, "foundation-snapshots");
  await mkdir(folder, { recursive: true });
  const script = `import{DesktopHost}from ${JSON.stringify(pathToFileURL(path.resolve("packages/host/dist/host.js")).href)};
    import{MemorySecretStore}from ${JSON.stringify(pathToFileURL(path.resolve("packages/core/dist/index.js")).href)};
    import{chmod}from'node:fs/promises';
    const h=new DesktopHost({dataDir:process.argv[1],confirm:{ask:async()=>true},secretStore:()=>new MemorySecretStore()});await h.initialize();await chmod(process.argv[1]+'/foundation-snapshots',0);
    let invoke,close;try{await h.invoke(process.argv[2],'fixture','fixture','commands','check',{});}catch(e){invoke=e.details?.reason;}try{await h.close();}catch(e){close=e.details?.reason;}console.log(JSON.stringify({invoke,close}));process.exit(0);`;
  try {
    const result = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      script,
      f.dir,
      a.instanceId,
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      invoke: "FOUNDATION_CLEANUP_FAILED",
      close: "FOUNDATION_CLEANUP_FAILED",
    });
    const db = new DatabaseSync(path.join(f.dir, "foundation-state.db"));
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number })
        .n,
    ).toBe(1);
    db.close();
  } finally {
    await chmod(folder, 0o700);
  }
  const next = new DesktopHost(f.options);
  hosts.push(next);
  await next.initialize();
  expect(await next.foundationStatus(a.instanceId)).toEqual(a.foundation);
  const db = new DatabaseSync(path.join(f.dir, "foundation-state.db"));
  expect(
    (db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number })
      .n,
  ).toBe(0);
  db.close();
  expect(
    await next.invoke(
      a.instanceId,
      "fixture",
      "fixture",
      "commands",
      "check",
      {},
    ),
  ).toMatchObject({ agentId: a.instanceId });
});

it.each([false, true])(
  "protects library and builtin artifacts when a published record becomes unreadable (damage after initialize: %s)",
  async (afterInitialize) => {
    const f = await fixture(),
      provider = await independentProvider(f.host),
      item = await component(f.host),
      a = await f.host.createAgent(
        "Protected",
        [],
        undefined,
        undefined,
        undefined,
        {
          selection: provider.selection,
        },
      ),
      official = await f.host.createAgent("Official");
    await f.host.setFoundationEnabled(a.instanceId, false);
    await f.host.close();
    const recordFile = path.join(
        f.dir,
        "instances",
        a.instanceId,
        "record.json",
      ),
      damaged = "{invalid-record",
      indexFile = path.join(f.dir, "library/index.json"),
      index = await readFile(indexFile),
      providerFile = path.join(
        f.dir,
        "library/objects",
        provider.selection.digest + ".zip",
      ),
      providerBytes = await readFile(providerFile),
      componentFile = path.join(f.dir, "library/objects", item.digest + ".zip"),
      componentBytes = await readFile(componentFile);
    if (!afterInitialize) await writeFile(recordFile, damaged);
    const next = new DesktopHost(f.options);
    hosts.push(next);
    await next.initialize();
    if (afterInitialize) await writeFile(recordFile, damaged);
    await expect(
      next.removeFoundation(provider.selection),
    ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    await expect(next.removeLibrary(item.digest)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
    await expect(
      next.removeFoundation(official.foundation!.selection),
    ).rejects.toMatchObject({ details: { reason: "FOUNDATION_IN_USE" } });
    expect(await readFile(indexFile)).toEqual(index);
    expect(await readFile(providerFile)).toEqual(providerBytes);
    expect(await readFile(componentFile)).toEqual(componentBytes);
    expect(await readFile(recordFile, "utf8")).toBe(damaged);
  },
);

it.each([
  "instance",
  "record-version",
  "binding-version",
  "component-pins",
  "declared-selection",
])(
  "keeps uncertifiable library references when the published %s is invalid after startup",
  async (damage) => {
    const f = await fixture(),
      item = await component(f.host),
      a = await f.host.createAgent("Uncertain"),
      file = path.join(f.dir, "instances", a.instanceId, "record.json"),
      record = JSON.parse(await readFile(file, "utf8"));
    if (damage === "instance") record.instanceId = "different-instance";
    if (damage === "record-version") record.recordVersion = 99;
    if (damage === "binding-version") record.foundation.bindingVersion = 99;
    if (damage === "component-pins") delete record.components;
    if (damage === "declared-selection")
      record.agent.foundation = { selection: { selectionVersion: "99.0" } };
    const original = JSON.stringify(record),
      indexFile = path.join(f.dir, "library/index.json"),
      index = await readFile(indexFile),
      object = path.join(f.dir, "library/objects", item.digest + ".zip"),
      bytes = await readFile(object);
    await writeFile(file, original);
    await expect(f.host.removeLibrary(item.digest)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
    expect(await readFile(indexFile)).toEqual(index);
    expect(await readFile(object)).toEqual(bytes);
    expect(await readFile(file, "utf8")).toBe(original);
  },
);
