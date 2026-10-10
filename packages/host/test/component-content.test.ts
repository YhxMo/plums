import { it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type Manifest,
  secretRef,
} from "@plumsjs/core";
import { DesktopHost } from "../src/host.js";
import type { ComponentSource } from "../src/component-drafts.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-content-"));
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
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  return { host, dir, stores, options };
}
function manifest(formatVersion = "2.0"): Manifest {
  return {
    formatVersion,
    id: "card",
    name: "角色",
    kind: "character",
    version: "1.0.0",
    description: "完整内容",
    permissions: [],
    dependencies: [],
    payload: { description: "角色正文", unknown: { nested: true } },
    future: { preserved: true },
  } as Manifest;
}
async function imported(
  host: DesktopHost,
  m = manifest(),
  files: Record<string, Uint8Array> = {
    "source/card.json": Buffer.from('{"original":true}'),
    "nested/readme.txt": Buffer.from("original file"),
  },
) {
  const p = (await host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(m)),
      ...files,
    }),
  )) as { token: string };
  return host.importLibrary(p.token);
}
async function changed(host: DesktopHost, source: ComponentSource) {
  const draft = await host.openComponentDraft(source),
    m = JSON.parse(draft.manifestText);
  m.version = "1.0.1";
  m.payload.description = "完整编辑后的正文";
  const next = await host.writeComponentDraft(
    draft.token,
    JSON.stringify(m),
    draft.revision,
  );
  return { draft: next, m };
}
it.each(["1.0", "2.0"])(
  "shows complete %s content, unknown fields and files without creating a working copy",
  async (format) => {
    const f = await fixture(),
      m = manifest(format);
    m.payload = { long: "正文".repeat(30_000), unknown: [1, { all: true }] };
    const item = await imported(f.host, m),
      source: ComponentSource = { kind: "library", digest: item.digest };
    const view = await f.host.inspectComponent(source);
    expect(JSON.parse(view.manifestText)).toEqual(m);
    expect(view.files.map((x) => x.path)).toEqual([
      "manifest.json",
      "nested/readme.txt",
      "source/card.json",
    ]);
    await expect(
      readFile(path.join(f.dir, "component-drafts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("saves an immutable snapshot, preserves source bytes and leaves the original artifact intact", async () => {
  const { host } = await fixture(),
    item = await imported(host);
  const { draft, m } = await changed(host, {
    kind: "library",
    digest: item.digest,
  });
  const validated = await host.validateComponentDraft(draft.token);
  const location = await host.revealComponentDraft(draft.token);
  await writeFile(
    path.join(location, "manifest.json"),
    JSON.stringify({ ...m, version: "9.0.0", payload: { later: true } }),
  );
  await writeFile(path.join(location, "nested/readme.txt"), "after validation");
  const result = await host.saveComponentDraft(
    draft.token,
    validated.validationToken,
  );
  expect(result).toMatchObject({ librarySaved: true, applied: false });
  expect(
    (await host.library.get(result.item.digest)).contents.manifest,
  ).toEqual(m);
  expect(
    Buffer.from(
      (await host.library.get(result.item.digest)).contents.files[
        "nested/readme.txt"
      ]!,
    ).toString(),
  ).toBe("original file");
  expect(
    Buffer.from(
      (await host.library.get(result.item.digest)).contents.files[
        "source/card.json"
      ]!,
    ).toString(),
  ).toBe('{"original":true}');
  expect((await host.library.get(item.digest)).contents.manifest.version).toBe(
    "1.0.0",
  );
  expect(
    JSON.parse(await readFile(path.join(location, "manifest.json"), "utf8"))
      .version,
  ).toBe("9.0.0");
});
it("keeps large JSON editor views recoverable and preserves special file names", async () => {
  const { host } = await fixture(),
    m = manifest();
  m.payload = { long: "x".repeat(11 * 1024 * 1024) };
  const item = await imported(host, m, {
    ["__proto__"]: Buffer.from("opaque file"),
  });
  const draft = await host.openComponentDraft({
    kind: "library",
    digest: item.digest,
  });
  const payloadText = JSON.stringify(m.payload);
  await host.retainComponentDraft(draft.token, {
    manifestText: draft.manifestText,
    payloadText,
    tab: "payload",
    revision: draft.revision,
  });
  const restored = await host.readComponentDraft(draft.token);
  expect(restored.editor?.manifestText).toBe(draft.manifestText);
  expect(restored.editor?.payloadText).toBe(payloadText);
  expect(restored.files.find((f) => f.path === "__proto__")?.size).toBe(11);
});
it("keeps invalid editor input and external manifest edits across restart and rejects silent overwrites", async () => {
  const f = await fixture(),
    item = await imported(f.host),
    source: ComponentSource = { kind: "library", digest: item.digest };
  const draft = await f.host.openComponentDraft(source),
    location = await f.host.revealComponentDraft(draft.token);
  await f.host.retainComponentDraft(draft.token, {
    manifestText: "{",
    payloadText: "[invalid",
    tab: "payload",
    revision: draft.revision,
  });
  const external = {
    ...JSON.parse(draft.manifestText),
    version: "1.2.0",
    payload: { external: true },
  };
  await writeFile(
    path.join(location, "manifest.json"),
    JSON.stringify(external),
  );
  await f.host.close();
  const reopened = new DesktopHost(f.options);
  hosts.push(reopened);
  await reopened.initialize();
  const view = await reopened.openComponentDraft(source);
  expect(view.token).toBe(draft.token);
  expect(view.editor).toEqual({
    manifestText: "{",
    payloadText: "[invalid",
    tab: "payload",
    revision: draft.revision,
  });
  expect(JSON.parse(view.manifestText)).toEqual(external);
  await expect(
    reopened.writeComponentDraft(
      draft.token,
      draft.manifestText,
      draft.revision,
    ),
  ).rejects.toMatchObject({
    code: "IMPORT_INVALID",
    details: { reason: "DRAFT_CONFLICT" },
  });
  expect(
    JSON.parse(await readFile(path.join(location, "manifest.json"), "utf8")),
  ).toEqual(external);
  await reopened.writeComponentDraft(
    view.token,
    JSON.stringify(external),
    view.revision,
  );
  await reopened.discardComponentDraft(view.token);
  await expect(
    readFile(path.join(location, "manifest.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("updates only the bound Agent and preserves independent settings, secrets and enabled states", async () => {
  const f = await fixture(),
    m = manifest();
  m.settingsSchema = {
    type: "object",
    properties: {
      note: { type: "string", title: "备注", description: "备注" },
      key: {
        type: "string",
        title: "密钥",
        description: "密钥",
        "x-secret": true,
      },
    },
  };
  const item = await imported(f.host, m),
    a = await f.host.createAgent("甲", [item.digest]),
    b = await f.host.createAgent("乙", [item.digest]);
  await f.host.setSettings(
    a.instanceId,
    "card",
    { note: "甲" },
    { key: "private-key-a" },
  );
  await f.host.setSettings(
    b.instanceId,
    "card",
    { note: "乙" },
    { key: "private-key-b" },
  );
  await f.host.enable(a.instanceId, "card");
  const { draft } = await changed(f.host, {
    kind: "agent",
    instanceId: a.instanceId,
    packageId: "card",
  });
  const validated = await f.host.validateComponentDraft(draft.token);
  expect(
    await f.host.saveComponentDraft(
      draft.token,
      validated.validationToken,
      true,
    ),
  ).toMatchObject({ librarySaved: true, applied: true });
  const aa = (await f.host.resources(a.instanceId)) as any,
    bb = (await f.host.resources(b.instanceId)) as any;
  expect(aa.packages[0]).toMatchObject({
    version: "1.0.1",
    enabled: true,
    settings: { values: { note: "甲" }, secrets: { key: true } },
  });
  expect(bb.packages[0]).toMatchObject({
    version: "1.0.0",
    enabled: false,
    settings: { values: { note: "乙" } },
  });
  expect(await f.stores.get(a.instanceId)!.get(secretRef("card", "key"))).toBe(
    "private-key-a",
  );
  expect(await f.stores.get(b.instanceId)!.get(secretRef("card", "key"))).toBe(
    "private-key-b",
  );
});
it("reports library success separately when an incompatible configuration blocks Agent update", async () => {
  const f = await fixture(),
    m = manifest();
  m.settingsSchema = {
    type: "object",
    properties: {
      note: { type: "string", title: "备注", description: "备注" },
    },
  };
  const item = await imported(f.host, m),
    a = await f.host.createAgent("甲", [item.digest]);
  await f.host.setSettings(a.instanceId, "card", { note: "保留旧设置" }, {});
  const { draft, m: next } = await changed(f.host, {
    kind: "agent",
    instanceId: a.instanceId,
    packageId: "card",
  });
  next.settingsSchema.properties.note.type = "integer";
  await f.host.writeComponentDraft(
    draft.token,
    JSON.stringify(next),
    draft.revision,
  );
  const checked = await f.host.validateComponentDraft(draft.token);
  const result = await f.host.saveComponentDraft(
    draft.token,
    checked.validationToken,
    true,
  );
  expect(result).toMatchObject({
    librarySaved: true,
    applied: false,
    error: { code: "IMPORT_INVALID", path: "/settings/note" },
  });
  const resources = (await f.host.resources(a.instanceId)) as any;
  expect(resources.packages[0].version).toBe("1.0.0");
  expect(resources.packages[0].settings.values.note).toBe("保留旧设置");
  expect((await f.host.readComponentDraft(draft.token)).token).toBe(
    draft.token,
  );
});
it("requires renewed consent for permission changes and rechecks the original Agent binding", async () => {
  const f = await fixture(),
    item = await imported(f.host),
    a = await f.host.createAgent("甲", [item.digest]);
  const { draft, m } = await changed(f.host, {
    kind: "agent",
    instanceId: a.instanceId,
    packageId: "card",
  });
  m.permissions = [
    {
      id: "read",
      kind: "fs",
      target: "workspace",
      operations: ["read"],
      reason: "读取",
    },
  ];
  await f.host.writeComponentDraft(
    draft.token,
    JSON.stringify(m),
    draft.revision,
  );
  const checked = await f.host.validateComponentDraft(draft.token);
  expect(
    await f.host.saveComponentDraft(draft.token, checked.validationToken),
  ).toMatchObject({
    librarySaved: true,
    applied: false,
    error: { code: "CONSENT_REQUIRED" },
  });
  expect(
    await f.host.saveComponentDraft(draft.token, checked.validationToken, true),
  ).toMatchObject({ applied: true });
  await expect(
    f.host.saveComponentDraft(draft.token, checked.validationToken, true),
  ).rejects.toMatchObject({ details: { reason: "SOURCE_CHANGED" } });
});
it("rejects changed identities, duplicate versions and invalid declarations before library writes", async () => {
  const { host } = await fixture(),
    item = await imported(host),
    { draft, m } = await changed(host, {
      kind: "library",
      digest: item.digest,
    });
  m.id = "other";
  let next = await host.writeComponentDraft(
    draft.token,
    JSON.stringify(m),
    draft.revision,
  );
  await expect(host.validateComponentDraft(draft.token)).rejects.toMatchObject({
    path: "/id",
  });
  m.id = "card";
  m.version = "1.0.0";
  next = await host.writeComponentDraft(
    draft.token,
    JSON.stringify(m),
    next.revision,
  );
  await expect(host.validateComponentDraft(draft.token)).rejects.toMatchObject({
    path: "/version",
  });
  m.version = "1.0.1";
  await imported(host, { ...manifest(), version: "1.0.1", payload: {} });
  next = await host.writeComponentDraft(
    draft.token,
    JSON.stringify(m),
    next.revision,
  );
  await expect(host.validateComponentDraft(draft.token)).rejects.toMatchObject({
    details: { reason: "VERSION_CONFLICT" },
  });
  m.version = "1.0.2";
  m.kind = "extension";
  m.payload = { plumsDesktop: { sdkVersion: "1", runtime: "missing.js" } };
  await host.writeComponentDraft(draft.token, JSON.stringify(m), next.revision);
  await expect(host.validateComponentDraft(draft.token)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  expect(await host.listLibrary()).toHaveLength(2);
});
it("refuses paths, symlinks, FIFO, case collisions and oversized workspaces without publishing files", async () => {
  const { host } = await fixture(),
    item = await imported(host),
    draft = await host.openComponentDraft({
      kind: "library",
      digest: item.digest,
    });
  const root = await host.revealComponentDraft(draft.token);
  await expect(
    host.revealComponentDraft(draft.token, "../draft.json"),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await expect(
    host.revealComponentDraft(draft.token, "/etc/passwd"),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await symlink(os.tmpdir(), path.join(root, "link"));
  await expect(host.readComponentDraft(draft.token)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  await rm(path.join(root, "link"));
  if (process.platform !== "win32") {
    execFileSync("mkfifo", [path.join(root, "pipe")]);
    await expect(host.readComponentDraft(draft.token)).rejects.toMatchObject({
      code: "IMPORT_INVALID",
    });
    await rm(path.join(root, "pipe"));
  }
  await mkdir(path.join(root, "large"));
  await writeFile(
    path.join(root, "large", "file"),
    Buffer.alloc(20 * 1024 * 1024 + 1),
  );
  await expect(host.readComponentDraft(draft.token)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  await rm(path.join(root, "large"), { recursive: true });
  await writeFile(path.join(root, "MANIFEST.JSON"), "{}");
  await expect(host.validateComponentDraft(draft.token)).rejects.toMatchObject({
    code: expect.stringMatching(/IMPORT_INVALID|MANIFEST_INVALID/),
  });
  expect(await host.listLibrary()).toHaveLength(1);
});
it("refreshes known secrets before inspection, draft retention and snapshot commit", async () => {
  const f = await fixture(),
    m = manifest();
  m.settingsSchema = {
    type: "object",
    properties: {
      key: {
        type: "string",
        title: "密钥",
        description: "密钥",
        "x-secret": true,
      },
    },
  };
  const item = await imported(f.host, m),
    a = await f.host.createAgent("甲", [item.digest]);
  await f.host.setSettings(
    a.instanceId,
    "card",
    {},
    { key: "saved-private-key" },
  );
  const { draft, m: next } = await changed(f.host, {
    kind: "library",
    digest: item.digest,
  });
  await expect(
    f.host.retainComponentDraft(draft.token, {
      manifestText: "saved-private-key",
      payloadText: "null",
      tab: "manifest",
      revision: draft.revision,
    }),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  next.payload.description = "becomes-private-later";
  await f.host.writeComponentDraft(
    draft.token,
    JSON.stringify(next),
    draft.revision,
  );
  const checked = await f.host.validateComponentDraft(draft.token);
  await f.host.setSettings(
    a.instanceId,
    "card",
    {},
    { key: "becomes-private-later" },
  );
  await expect(
    f.host.saveComponentDraft(draft.token, checked.validationToken),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(await f.host.listLibrary()).toHaveLength(1);
});
