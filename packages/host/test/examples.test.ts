import { it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type Manifest,
  type EgressRequest,
  type EgressResult,
} from "@plums/core";
import { createAgentBundle, validateAgentBundle } from "@plums/sdk";
import { DesktopHost } from "../src/host.js";
const dirs: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((h) => h.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function component(core: ReturnType<typeof createCore>, name: string) {
  const dir = path.resolve("examples", name),
    manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    ) as Manifest,
    files: Record<string, Uint8Array> = {};
  async function walk(at: string) {
    for (const e of await readdir(path.join(dir, at), {
      withFileTypes: true,
    })) {
      const p = path.posix.join(at, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p !== "manifest.json")
        files[p] = new Uint8Array(await readFile(path.join(dir, p)));
    }
  }
  await walk("");
  return core.exportPackage({ manifest, files });
}
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-example-test-"));
  dirs.push(dir);
  const core = createCore({
    dataDir: path.join(dir, "builder"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  const c = await component(core, "character"),
    e = await component(core, "chat-ui"),
    m = await component(core, "model-connector");
  core.close();
  const bundle = await createAgentBundle(
    {
      bundleVersion: "1.0",
      id: "chat-agent",
      name: "Chat",
      version: "1.0.0",
      character: "card.zip",
      extensions: ["chat.zip"],
      connectors: ["model.zip"],
      startup: "chat",
    },
    { "card.zip": c, "chat.zip": e, "model.zip": m },
  );
  const stores = new Map<string, MemorySecretStore>();
  const fs = new RecordingFsSink({
    data: new TextEncoder().encode("fixture file"),
    entries: [{ name: "source.txt", type: "file" }],
  });
  class ModelSink extends RecordingEgressSink {
    async send(r: EgressRequest): Promise<EgressResult> {
      await super.send(r);
      if (this.records.length === 1)
        return {
          status: 200,
          body: JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "list",
                      type: "function",
                      function: {
                        name: "list_directory",
                        arguments: '{"path":"."}',
                      },
                    },
                    {
                      id: "read",
                      type: "function",
                      function: {
                        name: "read_file",
                        arguments: '{"path":"source.txt"}',
                      },
                    },
                    {
                      id: "write",
                      type: "function",
                      function: {
                        name: "write_file",
                        arguments: '{"path":"result.txt","text":"confirmed"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { role: "assistant", content: "finished" } }],
        }),
      };
    }
  }
  const egress = new ModelSink();
  let confirmed = 0;
  const host = new DesktopHost({
    dataDir: path.join(dir, "library"),
    confirm: {
      async ask() {
        confirmed++;
        return true;
      },
    },
    fs,
    egress,
    secretStore: (id) => {
      let store = stores.get(id);
      if (!store) {
        store = new MemorySecretStore();
        stores.set(id, store);
      }
      return store;
    },
  });
  hosts.push(host);
  await host.initialize();
  const preview = (await host.preview(bundle)) as { token: string };
  const record = await host.install(preview.token);
  await host.enable(record.instanceId, "model");
  await host.enable(record.instanceId, "chat");
  await host.setSettings(
    record.instanceId,
    "model",
    { model: "test-model" },
    { apiKey: "fake-test-key" },
  );
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "source.txt"), "metadata fixture");
  await host.bindRoot(record.instanceId, "workspace", workspace);
  return { host, record, dir, egress, fs, confirmed: () => confirmed };
}
it("runs the external model/tool loop, records data writes and enforces a clean export", async () => {
  const f = await fixture();
  expect(
    await f.host.invoke(
      f.record.instanceId,
      "chat",
      "chat",
      "commands",
      "chat",
      { text: "test task" },
    ),
  ).toEqual({ text: "finished", steps: 2 });
  expect(f.egress.records).toHaveLength(2);
  const second = JSON.parse(f.egress.records[1]!.body!);
  expect(
    second.messages.filter((m: { role: string }) => m.role === "tool"),
  ).toHaveLength(3);
  expect(f.fs.records.some((r) => r.operation === "list")).toBe(true);
  expect(f.fs.records.filter((r) => r.operation === "write")).toHaveLength(2);
  // No task grant: both read and list now require single-use desktop approval.
  expect(f.confirmed()).toBe(6);
  const exported = await validateAgentBundle(
    await f.host.exportAgent(f.record.instanceId),
  );
  expect(Object.keys(exported.files).sort()).toEqual([
    "agent.json",
    "card.zip",
    "chat.zip",
    "model.zip",
  ]);
  expect(JSON.stringify(exported.packages)).not.toContain("fake-test-key");
  expect(
    JSON.stringify(await f.host.resources(f.record.instanceId)),
  ).not.toContain("fake-test-key");
  const audit = await f.host.audit(f.record.instanceId);
  expect(
    audit.some((e) =>
      (e as { callerIds?: string[] }).callerIds?.includes("chat"),
    ),
  ).toBe(true);
});
it("blocks missing caller permissions and disabled frontend identities", async () => {
  const f = await fixture();
  await f.host.disable(f.record.instanceId, "chat");
  await expect(
    f.host.invoke(
      f.record.instanceId,
      "chat",
      "model",
      "connectors",
      "complete",
      {},
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(f.egress.records).toHaveLength(0);
  await expect(
    f.host.bindRoot(f.record.instanceId, "workspace", "/"),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
it("revokes directory access on unbind, preserves files and other bindings, and keeps the change after restart", async () => {
  const f = await fixture();
  const id = f.record.instanceId;
  const enabledBefore = (await f.host.resources(id)).packages.map(
    ({ id, enabled }) => ({ id, enabled }),
  );
  const workspace = path.join(f.dir, "workspace");
  await f.host.bindRoot(id, "reference", workspace);
  await f.host.invoke(id, "chat", "chat", "tools", "read_file", {
    path: "source.txt",
  });
  const before = f.fs.records.length;
  await expect(f.host.unbindRoot(id, "agent-data")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await expect(f.host.unbindRoot(id, "../workspace")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await f.host.unbindRoot(id, "workspace");
  await expect(
    f.host.invoke(id, "chat", "chat", "tools", "read_file", {
      path: "source.txt",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(f.fs.records).toHaveLength(before);
  expect(await readFile(path.join(workspace, "source.txt"), "utf8")).toBe(
    "metadata fixture",
  );
  f.host.close();
  await f.host.initialize();
  const detail = await f.host.resources(id);
  expect(detail.record.roots.workspace).toBeUndefined();
  expect(detail.record.roots.reference).toBe(await realpath(workspace));
  expect(detail.packages.map(({ id, enabled }) => ({ id, enabled }))).toEqual(
    enabledBefore,
  );
  await f.host.bindRoot(id, "workspace", workspace);
  await f.host.invoke(id, "chat", "chat", "tools", "read_file", {
    path: "source.txt",
  });
  expect(f.fs.records).toHaveLength(before + 1);
});
it("rejects reverse dependency removal and incompatible updates before changing components", async () => {
  const f = await fixture();
  await expect(
    f.host.uninstallPackage(f.record.instanceId, "model"),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  const original = await validateAgentBundle(
    await f.host.exportAgent(f.record.instanceId),
  );
  const model = original.packages.find(
    (p) => p.contents.manifest.id === "model",
  )!.contents;
  const core = createCore({
    dataDir: path.join(f.dir, "builder-2"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  const bytes = await core.exportPackage({
    ...model,
    manifest: { ...model.manifest, version: "2.0.0" },
  });
  core.close();
  const preview = (await f.host.previewComponent(
    f.record.instanceId,
    bytes,
  )) as { token: string };
  await expect(
    f.host.updatePackage(f.record.instanceId, preview.token, "model", true),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  expect(JSON.stringify(await f.host.resources(f.record.instanceId))).toContain(
    "1.0.0",
  );
});
