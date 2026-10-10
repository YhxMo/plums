import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  readArchive,
} from "@plumsjs/core";
import { DesktopHost } from "../../src/host.js";
import type { AgentRecord } from "../../src/host.js";
import {
  protocolPlan,
  fixProtocolBinding,
} from "../../src/protocol-bindings.js";
import { ProjectSandbox } from "../../src/project-sandbox.js";
import { fixtureManifest, packExtension } from "../fixtures/extensions/pack.js";
import { chatFixture } from "./chat-fixture.js";
const native = process.platform === "darwin" && process.arch === "arm64";
const fixtures: Awaited<ReturnType<typeof chatFixture>>[] = [],
  hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of hosts.splice(0)) await h.close();
  for (const f of fixtures.splice(0)) await f.close();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function fixture() {
  const confirm = { ask: vi.fn(async () => true) };
  const f = Object.assign(
    await chatFixture(undefined, undefined, { confirm }),
    { confirm },
  );
  fixtures.push(f);
  for (const name of [
    "coding-tools",
    "crash-probe",
    "policy-fake",
    "machine-probe-b",
  ])
    f.artifacts.set(name, await f.put(await packExtension(name)));
  return f;
}
async function confirm(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  ceiling: "project" | "machine",
  components: string[],
  projects: string[] = [],
) {
  const selection = {
    ceiling,
    components: components.map(f.idOf),
    projects,
    readOnly: [],
  };
  const plan = await f.host.tierPlan(id, selection);
  expect(await f.host.confirmTier(id, plan.fingerprint, selection)).toBe(true);
  return plan;
}

it("test-only fixtures declare project tools, an isolated crash entry and the fixed policy protocol", async () => {
  const f = await fixture();
  expect((await fixtureManifest("coding-tools")).permissions).toContainEqual(
    expect.objectContaining({
      kind: "engine",
      tier: "project",
      toolchains: ["node", "git"],
    }),
  );
  expect((await fixtureManifest("crash-probe")).permissions).toContainEqual(
    expect.objectContaining({ kind: "engine", tier: "project" }),
  );
  expect(f.artifacts.get("policy-fake")!.manifest.permissions).toEqual([]);
});
it("coding-tools list/call features and schemas are compatible with the loop requirement", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-coding-protocol-"));
  dirs.push(dir);
  const core = createCore({
    dataDir: dir,
    egress: new RecordingEgressSink(),
    secrets: new MemorySecretStore(),
  });
  try {
    const components = [];
    for (const name of ["agent-loop", "coding-tools"]) {
      const bytes = await packExtension(name),
        manifest = await fixtureManifest(name);
      await core.importPackage(bytes);
      await core.grantConsent(manifest.id);
      await core.enable(manifest.id);
      components.push({
        packageId: manifest.id,
        digest: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const record = {
      instanceId: "fixture-agent",
      components,
      roots: {},
      agent: { startup: {} },
    } as unknown as AgentRecord;
    const plan = await protocolPlan(core, record);
    const slot = plan.requirements.find(
      (r) => r.requirement.id === "tools-coding",
    )!;
    const candidate = slot.candidates.find(
      (c) => c.intent.providerId === "fixture.coding-tools",
    )!;
    expect(candidate.compatibility.compatible).toBe(true);
    record.protocolBindings = [
      await fixProtocolBinding(core, record, candidate.intent),
    ];
    expect(
      (await protocolPlan(core, record)).requirements.find(
        (r) => r.requirement.id === "tools-coding",
      )?.state,
    ).toBe("bound");
    const d = (await fixtureManifest("coding-tools")).payload.plumsDesktop as {
      contributes: { tools: { inputSchema: unknown; outputSchema: unknown }[] };
    };
    expect(d.contributes.tools[0]?.inputSchema).toHaveProperty("oneOf");
    expect(d.contributes.tools[0]?.outputSchema).toHaveProperty("oneOf");
  } finally {
    core.close();
  }
});
it.runIf(native)(
  "S-B rejects sandbox, unconfirmed and unavailable project entries without starting a machine fallback",
  async () => {
    vi.spyOn(ProjectSandbox.prototype, "inspect").mockResolvedValue({
      reportVersion: "1.0",
      status: "failed",
      ready: false,
      reason: "PROJECT_BOUNDARY_FAILED",
      platform: "darwin",
      arch: "arm64",
      checks: [],
      cleanupCompleted: true,
    });
    const f = await fixture();
    const a = await f.create([
      "model-fake",
      "agent-loop",
      "memory",
      "coding-tools",
    ]);
    const id = a.instanceId;
    const root = await mkdtemp(
      path.join(os.tmpdir(), "plums-project-scenario-"),
    );
    dirs.push(root);
    await mkdir(path.join(root, ".git"));
    await f.host.bindRoot(id, "workspace", root);
    const protocols = await f.host.protocolPlan(id);
    const slot = protocols.requirements.find(
      (r) =>
        r.consumerId === f.idOf("agent-loop") &&
        r.requirement.id === "tools-coding",
    )!;
    await f.host.setProtocolBinding(
      id,
      protocols.fingerprint,
      f.idOf("agent-loop"),
      "tools-coding",
      slot.candidates.find(
        (c) => c.intent.providerId === f.idOf("coding-tools"),
      )!.intent,
    );
    const call = () =>
      f.host.invokeProtocol(id, f.idOf("agent-loop"), "tools-coding", {
        operation: "call",
        input: {
          name: "write_file",
          arguments: { path: "sentinel.txt", content: "synthetic" },
        },
      });
    await expect(call()).rejects.toMatchObject({ code: "TIER_REQUIRED" });
    await confirm(f, id, "project", [], ["workspace"]);
    await expect(call()).rejects.toMatchObject({
      code: "LOCAL_CONFIRM_REQUIRED",
    });
    await confirm(f, id, "project", ["coding-tools"], ["workspace"]);
    await expect(call()).rejects.toMatchObject({ code: "TIER_UNAVAILABLE" });
    expect(
      await f.host.engineStatus(id, f.idOf("coding-tools"), "local"),
    ).toMatchObject({ state: "stopped" });
    expect(
      (await f.host.audit(id)).some((e: any) => e.reason === "ENGINE_START"),
    ).toBe(false);
    await f.host.revokeLocal(id, f.idOf("coding-tools"));
    await expect(call()).rejects.toMatchObject({
      code: "LOCAL_CONFIRM_REQUIRED",
    });
  },
);
it.runIf(native)(
  "S-G/S-H machine control: an added crash entry needs confirmation, keeps other PIDs and memory, and restarts alone",
  async () => {
    const f = await fixture();
    const a = await f.create([
      "model-fake",
      "agent-loop",
      "memory",
      "machine-probe-b",
    ]);
    const id = a.instanceId;
    await confirm(f, id, "machine", ["machine-probe-b"]);
    const probe = () =>
      f.host.invoke(
        id,
        f.idOf("machine-probe-b"),
        f.idOf("machine-probe-b"),
        "commands",
        "probe",
        { method: "pid", input: {} },
      );
    const first = await probe();
    await f.memory(id, "upsert", { id: "same", text: "memory remains" });
    // Explicit machine variant tests lifecycle; it is not a project success result.
    const files = await readArchive(await packExtension("crash-probe"));
    const manifest = await fixtureManifest("crash-probe");
    (manifest.permissions[0] as any).tier = "machine";
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
    f.artifacts.set("crash-probe", await f.put(await createArchive(files)));
    await f.host.addLibraryComponent(
      id,
      f.artifacts.get("crash-probe")!.digest,
    );
    await f.host.enable(id, f.idOf("crash-probe"));
    await expect(
      f.host.startEngine(id, f.idOf("crash-probe"), "local"),
    ).rejects.toMatchObject({ code: "LOCAL_CONFIRM_REQUIRED" });
    expect(await probe()).toBe(first);
    expect(
      (await f.host.tierPlan(id)).entries.find(
        (e) => e.packageId === f.idOf("crash-probe"),
      )?.engines[0]?.state,
    ).toBe("pending");
    await confirm(f, id, "machine", ["machine-probe-b", "crash-probe"]);
    await f.host.startEngine(id, f.idOf("crash-probe"), "local");
    const request = (method: string) =>
      f.host.engineCall(id, f.idOf("crash-probe"), "request", {
        engineId: "local",
        method,
        input: {},
      });
    const crashPid = await request("ping");
    await expect(request("crash")).rejects.toBeDefined();
    expect(await probe()).toBe(first);
    expect(await f.memory(id, "search", { query: "remains" })).toEqual([
      { id: "same", text: "memory remains" },
    ]);
    await f.host.startEngine(id, f.idOf("crash-probe"), "local");
    expect(await request("ping")).not.toBe(crashPid);
    expect(
      (await f.host.audit(id)).some((e: any) => e.reason === "ENGINE_CRASH"),
    ).toBe(true);
    await f.host.addLibraryComponent(
      id,
      f.artifacts.get("policy-fake")!.digest,
    );
    await f.host.enable(id, f.idOf("policy-fake"));
    await f.host.setSettings(
      id,
      f.idOf("policy-fake"),
      { localDecision: "deny" },
      {},
    );
    let pp = await f.host.policyPlan(id);
    await f.host.selectPolicy(
      id,
      pp.fingerprint,
      f.idOf("policy-fake"),
      "decision",
      "fixture",
    );
    await f.grant(id);
    pp = await f.host.policyPlan(id);
    await f.host.grantPolicyScope(id, pp.fingerprint, 900_000, pp.available);
    await expect(
      f.host.startEngine(id, f.idOf("machine-probe-b"), "local"),
    ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
    expect(await f.memory(id, "search", { query: "remains" })).toEqual([
      { id: "same", text: "memory remains" },
    ]);
    await f.host.setSettings(
      id,
      f.idOf("policy-fake"),
      { localDecision: "confirm" },
      {},
    );
    const questions = f.confirm.ask.mock.calls.length;
    await f.host.startEngine(id, f.idOf("machine-probe-b"), "local");
    expect(f.confirm.ask.mock.calls.length).toBe(questions);
    expect(
      (await fixtureManifest("agent-loop")).permissions.some((p) =>
        ["engine", "fs", "exec"].includes(p.kind),
      ),
    ).toBe(false);
  },
);
it("S-E direct import in a new data directory preserves artifacts but starts sandboxed with pending local authorization", async () => {
  const f = await fixture();
  const a = await f.create([
    "model-fake",
    "agent-loop",
    "memory",
    "machine-probe-b",
  ]);
  await confirm(f, a.instanceId, "machine", ["machine-probe-b"]);
  const bundle = await f.host.exportAgent(a.instanceId);
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-direct-import-"));
  dirs.push(dir);
  const fresh = new DesktopHost({
    dataDir: dir,
    fs: new RecordingFsSink(),
    egress: new RecordingEgressSink(),
    secretStore: () => new MemorySecretStore(),
    confirm: { ask: async () => true },
  });
  hosts.push(fresh);
  await fresh.initialize();
  const imported = await fresh.install(
    ((await fresh.preview(bundle)) as { token: string }).token,
  );
  const exportedFiles = await readArchive(bundle);
  expect(imported.components?.map((c) => c.digest).sort()).toEqual(
    a.components
      ?.map((c) =>
        createHash("sha256").update(exportedFiles[c.archive]!).digest("hex"),
      )
      .sort(),
  );
  expect(await fresh.tierStatus(imported.instanceId)).toMatchObject({
    tier: { ceiling: "sandbox", projects: [], readOnly: [], components: [] },
    grants: [],
  });
  const pending = (await fresh.tierPlan(imported.instanceId)).entries.find(
    (e) => e.packageId === "fixture.machine-probe-b",
  )!;
  expect(pending.confirmed).toBe(false);
  expect(pending.engines[0]?.state).toBe("tier-required");
});
