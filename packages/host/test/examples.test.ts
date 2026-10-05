import { it, expect, afterEach, vi } from "vitest";
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
type ModelProtocol = "OpenAI Chat Completions" | "OpenAI Responses" | "Anthropic Messages" | "Gemini";
const dirs: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((h) => h.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

const protocolFixtures: {
  protocol: ModelProtocol;
  path: string;
  header: string;
  first: unknown;
  final: unknown;
  continuation: string;
}[] = [
  {
    protocol: "OpenAI Chat Completions",
    path: "/proxy/v1/chat/completions",
    header: "Authorization",
    continuation: "reasoning_content",
    first: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            reasoning_content: "opaque-native-state",
            tool_calls: [
              {
                id: "call",
                type: "function",
                function: { name: "list_directory", arguments: '{"path":"."}' },
              },
            ],
          },
        },
      ],
    },
    final: {
      choices: [{ message: { role: "assistant", content: "finished" } }],
    },
  },
  {
    protocol: "OpenAI Responses",
    path: "/proxy/v1/responses",
    header: "Authorization",
    continuation: "function_call_output",
    first: {
      status: "completed",
      output: [
        {
          type: "reasoning",
          id: "reason",
          summary: [],
          encrypted_content: "opaque-native-state",
        },
        {
          type: "function_call",
          id: "fc",
          call_id: "call",
          name: "list_directory",
          arguments: '{"path":"."}',
        },
      ],
    },
    final: {
      status: "completed",
      output: [
        {
          id: "msg",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "finished" }],
        },
      ],
    },
  },
  {
    protocol: "Anthropic Messages",
    path: "/proxy/v1/messages",
    header: "x-api-key",
    continuation: "tool_result",
    first: {
      content: [
        {
          type: "thinking",
          thinking: "private thought",
          signature: "opaque-native-state",
        },
        {
          type: "tool_use",
          id: "call",
          name: "list_directory",
          input: { path: "." },
        },
      ],
    },
    final: { content: [{ type: "text", text: "finished" }] },
  },
  {
    protocol: "Gemini",
    path: "/proxy/v1/models/arbitrary-model:generateContent",
    header: "x-goog-api-key",
    continuation: "functionResponse",
    first: {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: "call",
                  name: "list_directory",
                  args: { path: "." },
                },
                thoughtSignature: "opaque-native-state",
              },
            ],
          },
        },
      ],
    },
    final: { candidates: [{ content: { parts: [{ text: "finished" }] } }] },
  },
];
it.each(protocolFixtures)(
  "runs $protocol text, tools and follow-up after restart through the actual Agent",
  async (data) => {
    const f = await fixture(),
      id = f.record.instanceId;
    await f.host.setSettings(
      id,
      "model",
      {
        protocol: data.protocol,
        model: "arbitrary-model",
        endpoint: "https://gateway.example/proxy/v1",
      },
      {},
    );
    let savedHistory: Uint8Array | undefined;
    const read = f.fs.read.bind(f.fs),
      write = f.fs.write.bind(f.fs);
    vi.spyOn(f.fs, "write").mockImplementation(async (request) => {
      await write(request);
      if (path.basename(request.path) === "conversation.json") {
        savedHistory = request.data.slice();
        await writeFile(request.path, "history metadata fixture");
      }
    });
    vi.spyOn(f.fs, "read").mockImplementation(async (request) => {
      const value = await read(request);
      return path.basename(request.path) === "conversation.json" && savedHistory
        ? savedHistory.slice()
        : value;
    });
    const plan = await f.host.agentEnablePlan(id);
    await f.host.enableAgent(id, plan.fingerprint);
    vi.spyOn(f.egress, "send").mockImplementation(async (request) => {
      f.egress.records.push(request);
      return {
        status: 200,
        body: JSON.stringify(
          f.egress.records.length === 1 ? data.first : data.final,
        ),
      };
    });
    expect(
      await f.host.invoke(id, "chat", "chat", "commands", "chat", {
        text: "read workspace",
        useTools: true,
      }),
    ).toEqual({ text: "finished", steps: 2 });
    expect(f.egress.records).toHaveLength(2);
    const first = f.egress.records[0]!;
    expect(first.url).toBe("https://gateway.example" + data.path);
    expect(first.headers?.[data.header]).toBe(
      data.header === "Authorization"
        ? "Bearer fake-test-key"
        : "fake-test-key",
    );
    expect(JSON.stringify(first)).not.toContain("opencode.ai");
    expect(JSON.stringify(JSON.parse(first.body!))).not.toContain(
      "fake-test-key",
    );
    const second = f.egress.records[1]!.body!;
    expect(second).toContain("opaque-native-state");
    expect(second).toContain(data.continuation);
    expect(f.fs.records.some((r) => r.operation === "list")).toBe(true);
    f.host.close();
    expect(
      await f.host.invoke(id, "chat", "chat", "commands", "chat", {
        text: "follow up",
      }),
    ).toEqual({ text: "finished", steps: 1 });
    expect(f.egress.records).toHaveLength(3);
    expect(f.egress.records[2]!.body).toContain("opaque-native-state");
    expect(JSON.parse(f.egress.records[2]!.body!)).not.toHaveProperty("tools");
    const audit = JSON.stringify(await f.host.audit(id));
    for (const value of [
      "fake-test-key",
      "opaque-native-state",
      "follow up",
      "read workspace",
    ])
      expect(audit).not.toContain(value);
  },
);
it.each(protocolFixtures)(
  "supports $protocol models without function calling using only the four model settings",
  async (data) => {
    const f = await fixture(),
      id = f.record.instanceId;
    await f.host.setSettings(
      id,
      "model",
      {
        protocol: data.protocol,
        model: "arbitrary-model",
        endpoint: "https://gateway.example/proxy/v1",
      },
      { apiKey: "fake-text-only-key" },
    );
    const plan = await f.host.agentEnablePlan(id);
    await f.host.enableAgent(id, plan.fingerprint);
    vi.spyOn(f.egress, "send").mockImplementation(async (request) => {
      f.egress.records.push(request);
      if (JSON.parse(request.body!).tools)
        return { status: 400, body: "tools unsupported" };
      return { status: 200, body: JSON.stringify(data.final) };
    });
    expect(
      await f.host.invoke(id, "chat", "chat", "commands", "chat", {
        text: "hello",
      }),
    ).toEqual({ text: "finished", steps: 1 });
    expect(f.egress.records).toHaveLength(1);
    expect(f.egress.records[0]!.url).toBe(
      "https://gateway.example" + data.path,
    );
    expect(JSON.parse(f.egress.records[0]!.body!)).not.toHaveProperty("tools");
    expect(
      f.fs.records.filter((r) => r.rootPath === path.join(f.dir, "workspace")),
    ).toEqual([]);
  },
);
it("rejects protocol changes during approval and invalid protocols before changing a saved key", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  const plan = await f.host.agentEnablePlan(id);
  await expect(
    f.host.setSettings(
      id,
      "model",
      {
        protocol: "private-unsupported-protocol",
        model: "arbitrary-model",
        endpoint: "https://gateway.example",
      },
      { apiKey: "fake-overwrite-key" },
    ),
  ).rejects.toMatchObject({
    code: "SETTINGS_INVALID",
    path: "/settings/protocol",
  });
  await f.host.setSettings(
    id,
    "model",
    {
      protocol: "OpenAI Responses",
      model: "arbitrary-model",
      endpoint: "https://gateway.example",
    },
    {},
  );
  await expect(f.host.enableAgent(id, plan.fingerprint)).rejects.toMatchObject({
    code: "IMPORT_INVALID",
  });
  await expect(
    f.host.invoke(id, "chat", "model", "connectors", "complete", {
      messages: [{ role: "user", content: "hello" }],
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.egress.records).toHaveLength(0);
  const next = await f.host.agentEnablePlan(id);
  await f.host.enableAgent(id, next.fingerprint);
  vi.spyOn(f.egress, "send").mockImplementation(async (request) => {
    f.egress.records.push(request);
    return { status: 200, body: JSON.stringify(protocolFixtures[1]!.final) };
  });
  await f.host.invoke(id, "chat", "model", "connectors", "complete", {
    messages: [{ role: "user", content: "hello" }],
    protocol: "Gemini",
    model: "forged",
    endpoint: "https://evil.example",
    apiKey: "forged",
  });
  expect(f.egress.records[0]!.url).toBe("https://gateway.example/v1/responses");
  expect(f.egress.records[0]!.headers?.Authorization).toBe(
    "Bearer fake-test-key",
  );
  expect(JSON.parse(f.egress.records[0]!.body!).model).toBe("arbitrary-model");
});
async function component(
  core: ReturnType<typeof createCore>,
  name: string,
  legacy = false,
) {
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
  if (legacy && (name === "model-connector" || name === "chat-ui")) {
    manifest.version = "1.2.0";
    manifest.permissions = manifest.permissions.map((p) =>
      p.target === "https"
        ? {
            id: p.id,
            kind: "service",
            target: "model",
            operations: ["complete"],
            reason: p.reason,
          }
        : p,
    );
    const contribution = (manifest.payload as {plumsDesktop: Record<string,unknown>}).plumsDesktop;
    contribution.sdkVersion = "1";
    if (name === "chat-ui") manifest.dependencies[0]!.range = "^1.2.0";
    if (name === "model-connector") {
      delete contribution.connections;
      contribution.model = { protocolSetting:"protocol", endpointSetting:"endpoint", modelSetting:"model", keySetting:"apiKey" };
      files["runtime/main.js"] = new TextEncoder().encode(`export function activate(sdk) { sdk.register("connectors", "complete", async input => sdk.capability("model-api", {kind:"service",operation:"complete",binding:"model",sources:[],input})); }`);
    }
  }
  return core.exportPackage({ manifest, files });
}
async function fixture(legacy = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-example-test-"));
  dirs.push(dir);
  const core = createCore({
    dataDir: path.join(dir, "builder"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  const c = await component(core, "character"),
    e = await component(core, "chat-ui", legacy),
    m = await component(core, "model-connector", legacy);
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
      if (this.records.length === 1 && JSON.parse(r.body ?? "{}").tools?.length)
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
  await host.setSettings(
    record.instanceId,
    "model",
    { model: "user-defined-model", endpoint: "https://opencode.ai/zen/go" },
    { apiKey: "fake-test-key" },
  );
  const workspace = path.join(dir, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "source.txt"), "metadata fixture");
  await host.bindRoot(record.instanceId, "workspace", workspace);
  const plan = await host.agentEnablePlan(record.instanceId);
  await host.enableAgent(record.instanceId, plan.fingerprint);
  return { host, record, dir, egress, fs, confirmed: () => confirmed };
}
it.each([401, 404, 429, 500])(
  "reports HTTP %s without remote text or repeating the model request",
  async (status) => {
    const { host, record, egress } = await fixture();
    const send = vi.spyOn(egress, "send").mockResolvedValue({
      status,
      body: "fake-test-key private remote details",
    });
    await expect(
      host.invoke(record.instanceId, "chat", "chat", "commands", "chat", {
        text: "fixture",
      }),
    ).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: {
        phase: "sink",
        executionState: "completed",
        reason: "HTTP_REJECTED",
        httpStatus: status,
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await host.audit(record.instanceId))).not.toContain(
      "private remote details",
    );
  },
);
it("reports an invalid completed model response without exposing its body", async () => {
  const { host, record, egress } = await fixture();
  const send = vi.spyOn(egress, "send").mockResolvedValue({
    status: 200,
    body: "fake-test-key malformed response",
  });
  await expect(
    host.invoke(record.instanceId, "chat", "chat", "commands", "chat", {
      text: "fixture",
    }),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      executionState: "completed",
      reason: "RESPONSE_INVALID",
      httpStatus: 200,
    },
  });
  expect(send).toHaveBeenCalledTimes(1);
});
it("sends a stable OpenCode session identifier for each Agent", async () => {
  const { host, record, egress } = await fixture();
  await host.invoke(record.instanceId, "chat", "chat", "commands", "chat", {
    text: "fixture",
    useTools: true,
  });
  expect(egress.records.length).toBeGreaterThan(1);
  expect(
    egress.records.every(
      (request) =>
        request.headers?.["x-opencode-session"] === record.instanceId,
    ),
  ).toBe(true);
});
it("runs the external model/tool loop, records data writes and enforces a clean export", async () => {
  const f = await fixture();
  expect(
    await f.host.invoke(
      f.record.instanceId,
      "chat",
      "chat",
      "commands",
      "chat",
      { text: "test task", useTools: true },
    ),
  ).toEqual({ text: "finished", steps: 2 });
  expect(f.egress.records).toHaveLength(2);
  expect(f.egress.records[0]!.url).toBe(
    "https://opencode.ai/zen/go/v1/chat/completions",
  );
  expect(f.egress.records[0]!.headers?.Authorization).toBe(
    "Bearer fake-test-key",
  );
  expect(JSON.parse(f.egress.records[0]!.body!).model).toBe(
    "user-defined-model",
  );
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
    manifest: { ...model.manifest, version: "3.0.0" },
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
    "2.0.0",
  );
});

it("shows the configured target, preserves approval across restart, and requires fresh approval after a change", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  const resources = await f.host.resources(id);
  for (const p of resources.packages.filter(
    (p) => p.id === "model" || p.id === "chat",
  ))
    expect(Object.values(p.serviceTargets).flat()).toEqual([
      "opencode.ai（user-defined-model）",
    ]);
  const before = await f.host.agentEnablePlan(id);
  expect(before.entries.every((p) => !p.needsApproval)).toBe(true);
  f.host.close();
  await f.host.initialize();
  expect(
    (await f.host.agentEnablePlan(id)).entries.every((p) => !p.needsApproval),
  ).toBe(true);
  await f.host.setSettings(
    id,
    "model",
    {
      model: "another/arbitrary-model",
      endpoint: "https://custom-provider.example/v1",
    },
    {},
  );
  await expect(
    f.host.enableAgent(id, before.fingerprint),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await expect(
    f.host.invoke(id, "chat", "model", "connectors", "complete", {
      messages: [{ role: "user", content: "fixture" }],
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.egress.records).toHaveLength(0);
  const after = await f.host.agentEnablePlan(id);
  expect(
    after.entries
      .filter((p) => p.needsApproval)
      .map((p) => p.packageId)
      .sort(),
  ).toEqual(["chat", "model"]);
  await f.host.enableAgent(id, after.fingerprint);
  await f.host.invoke(id, "chat", "model", "connectors", "complete", {
    messages: [{ role: "user", content: "fixture" }],
    endpoint: "https://unapproved.example",
    model: "forged",
    apiKey: "forged",
  });
  expect(f.egress.records[0]!.url).toBe(
    "https://custom-provider.example/v1/chat/completions",
  );
  expect(JSON.parse(f.egress.records[0]!.body!).model).toBe(
    "another/arbitrary-model",
  );
  expect(f.egress.records[0]!.headers?.Authorization).toBe(
    "Bearer fake-test-key",
  );
  expect(
    (await f.host.agentEnablePlan(id)).entries.every((p) => !p.needsApproval),
  ).toBe(true);
});

it("rejects unsafe endpoints before saving a key and invalidates approval when only the key changes", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  await expect(
    f.host.setSettings(
      id,
      "model",
      { model: "any-model", endpoint: "http://localhost:8000" },
      { apiKey: "replacement-key" },
    ),
  ).rejects.toMatchObject({
    code: "SETTINGS_INVALID",
    path: "/settings/endpoint",
  });
  expect(
    (await f.host.agentEnablePlan(id)).entries.every((p) => !p.needsApproval),
  ).toBe(true);
  const current = (await f.host.resources(id)).packages.find(
    (p) => p.id === "model",
  )!;
  await f.host.setSettings(id, "model", current.settings.values, {
    apiKey: "replacement-key",
  });
  await expect(
    f.host.invoke(id, "model", "model", "connectors", "complete", {
      messages: [{ role: "user", content: "fixture" }],
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.egress.records).toHaveLength(0);
  const after = await f.host.agentEnablePlan(id);
  await f.host.enableAgent(id, after.fingerprint);
  await f.host.invoke(id, "chat", "model", "connectors", "complete", {
    messages: [{ role: "user", content: "fixture" }],
  });
  expect(f.egress.records[0]!.headers?.Authorization).toBe(
    "Bearer replacement-key",
  );
  expect(JSON.stringify(await f.host.resources(id))).not.toContain(
    "replacement-key",
  );
  expect(JSON.stringify(await f.host.audit(id))).not.toContain(
    "replacement-key",
  );
});

it("aborts an in-flight request when model configuration changes", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const send = f.egress.send.bind(f.egress);
  vi.spyOn(f.egress, "send").mockImplementation(async (request) => {
    const response = await send(request);
    entered();
    await gate;
    return response;
  });
  const pending = f.host.invoke(id, "chat", "chat", "commands", "chat", {
    text: "hello",
  });
  const outcome = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  await started;
  await f.host.setSettings(
    id,
    "model",
    { model: "changed", endpoint: "https://other.example/v1" },
    {},
  );
  release();
  expect(await outcome).toMatchObject({ message: "Extension stopped" });
  expect(f.egress.records).toHaveLength(1);
  expect(f.fs.records.some((r) => r.operation === "write")).toBe(false);
});

it("rejects a component approval preview when its configured target changes", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  const before = (await f.host.resources(id)).packages.find(
    (p) => p.id === "model",
  )!;
  await f.host.setSettings(
    id,
    "model",
    { model: "changed", endpoint: "https://changed.example/v1" },
    {},
  );
  await expect(
    f.host.enable(
      id,
      "model",
      JSON.stringify(before.manifest),
      before.fingerprint,
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    f.host.invoke(id, "chat", "model", "connectors", "complete", {
      messages: [{ role: "user", content: "fixture" }],
    }),
  ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.egress.records).toHaveLength(0);
});

it("revokes all model consumers after a committed key change even when revocation audit fails", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  const current = (await f.host.resources(id)).packages.find(
    (p) => p.id === "model",
  )!;
  f.host.options.audit = async (_id, event) => {
    if (event.phase === "revoke") throw Error("audit unavailable");
  };
  await expect(
    f.host.setSettings(id, "model", current.settings.values, {
      apiKey: "committed-key",
    }),
  ).rejects.toMatchObject({ code: "CAPABILITY_FAILED" });
  for (const owner of ["chat", "model"])
    await expect(
      f.host.invoke(id, owner, "model", "connectors", "complete", {
        messages: [{ role: "user", content: "fixture" }],
      }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect(f.egress.records).toHaveLength(0);
  f.host.options.audit = undefined;
  const plan = await f.host.agentEnablePlan(id);
  await f.host.enableAgent(id, plan.fingerprint);
  await f.host.invoke(id, "chat", "model", "connectors", "complete", {
    messages: [{ role: "user", content: "fixture" }],
  });
  expect(f.egress.records[0]!.headers?.Authorization).toBe(
    "Bearer committed-key",
  );
});

it("updates existing chat components while retaining the configured endpoint, model and key", async () => {
  const f = await fixture(true),
    id = f.record.instanceId;
  await expect(
    f.host.invoke(id, "chat", "model", "connectors", "complete", {
      messages: [{ role: "user", content: "fixture" }],
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(f.egress.records).toHaveLength(0);
  const core = createCore({
    dataDir: path.join(f.dir, "updates"),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
  });
  try {
    for (const [name, packageId] of [
      ["chat-ui", "chat"],
      ["model-connector", "model"],
    ]) {
      const preview = (await f.host.previewComponent(
        id,
        await component(core, name!),
      )) as { token: string };
      await f.host.updatePackage(id, preview.token, packageId!, true);
    }
  } finally {
    core.close();
  }
  const model = (await f.host.resources(id)).packages.find(
    (p) => p.id === "model",
  )!;
  expect(model.settings.values).toMatchObject({
    model: "user-defined-model",
    endpoint: "https://opencode.ai/zen/go",
  });
  expect(model.settings.secrets.apiKey).toBe(true);
  const plan = await f.host.agentEnablePlan(id);
  await f.host.enableAgent(id, plan.fingerprint);
  await f.host.invoke(id, "chat", "model", "connectors", "complete", {
    messages: [{ role: "user", content: "fixture" }],
  });
  expect(f.egress.records[0]!.url).toBe(
    "https://opencode.ai/zen/go/v1/chat/completions",
  );
  expect(f.egress.records[0]!.headers?.Authorization).toBe(
    "Bearer fake-test-key",
  );
});

it("keeps configured model requests within a finite task scope and asks again after stop", async () => {
  const f = await fixture(),
    id = f.record.instanceId;
  const plan = await f.host.taskScopePlan(id);
  const selection = plan.entries.flatMap((entry) =>
    entry.permissions
      .filter((p) => p.kind === "service" && p.target === "https")
      .map((p) => ({
        packageId: entry.packageId,
        permissionId: p.id,
        operation: "send" as const,
      })),
  );
  expect(selection).toHaveLength(2);
  expect(
    plan.entries.find((p) => p.packageId === "model")?.serviceTargets?.[
      "model-api"
    ],
  ).toEqual(["opencode.ai（user-defined-model）"]);
  await f.host.grantTaskScope(id, plan.fingerprint, 60_000, selection);
  await f.host.invoke(id, "chat", "model", "connectors", "complete", {
    messages: [{ role: "user", content: "fixture" }],
  });
  expect(f.confirmed()).toBe(0);
  expect(f.egress.records).toHaveLength(1);
  await f.host.revokeTaskScope(id);
  f.host.options.confirm.ask = async () => false;
  await expect(
    f.host.invoke(id, "chat", "model", "connectors", "complete", {
      messages: [{ role: "user", content: "fixture" }],
    }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  expect(f.egress.records).toHaveLength(1);
});
