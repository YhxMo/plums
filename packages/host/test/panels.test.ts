import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  RecordingFsSink,
  type ManifestV2,
  type AuditEvent,
} from "@plumsjs/core";
import { DesktopHost } from "../src/host.js";
import type { PanelDelivery } from "../src/panels.js";

const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(
  providerWrite = true,
  confirm: () => Promise<boolean> = async () => true,
  engine = false,
) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "plums-panels-"));
  dirs.push(dataDir);
  const deliveries: PanelDelivery[] = [],
    audit: AuditEvent[] = [],
    secrets = new MemorySecretStore(),
    fs = new RecordingFsSink();
  const host = new DesktopHost({
    dataDir,
    secretStore: () => secrets,
    fs,
    confirm: { ask: confirm },
    audit: async (_id, e) => {
      audit.push(e);
    },
    panelEvent: (e) => {
      deliveries.push(e);
    },
  });
  hosts.push(host);
  await host.initialize();
  const items = [];
  for (const id of ["orchestrator", "board"]) {
    const root = id === "orchestrator";
    const manifest: ManifestV2 = {
      formatVersion: "2.0",
      id,
      kind: "extension",
      name: id,
      version: "1.0.0",
      description: "",
      dependencies: [],
      permissions: [
        {
          id: "data",
          kind: "fs",
          target: "agent-data",
          operations: root || providerWrite ? ["read", "write"] : ["read"],
          reason: "Synthetic fixture",
        },
        ...(root && engine
          ? [
              {
                id: "fixture-engine",
                kind: "engine" as const,
                target: "fixture",
                operations: ["run"],
                reason: "Synthetic engine",
              },
            ]
          : []),
      ],
      settingsSchema: {
        type: "object",
        properties: {
          label: {
            type: "string",
            title: "Label",
            description: "Fixture label",
          },
          token: {
            type: "string",
            title: "Token",
            description: "Fixture token",
            "x-secret": true,
          },
        },
      },
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          ...(root && engine
            ? {
                engines: [
                  {
                    id: "fixture",
                    title: "Fixture",
                    entry: "engine.js",
                    runtime: "node",
                    platforms: [`${process.platform}-${process.arch}`],
                    protocol: "jsonrpc-jsonl-v1",
                  },
                ],
              }
            : {}),
          ...(root ? { frontend: "index.html" } : {}),
          contributes: root
            ? {
                commands: [
                  { name: "context", title: "Context" },
                  { name: "read", title: "Read" },
                  { name: "write", title: "Write" },
                ],
              }
            : { tools: [{ name: "board", title: "Board" }] },
          protocols: root
            ? {
                requires: [
                  {
                    id: "board",
                    protocol: "org.example.board",
                    range: "^1.0.0",
                  },
                ],
              }
            : {
                provides: [
                  {
                    id: "board",
                    protocol: "org.example.board",
                    version: "1.0.0",
                    contribution: { kind: "tools", name: "board" },
                  },
                ],
              },
          ...(!root
            ? {
                panels: [
                  {
                    id: "board",
                    title: "Board",
                    entry: "index.html",
                    provideId: "board",
                    messageVersion: "1.0",
                    topics: ["answer", "present"],
                  },
                ],
              }
            : {}),
        },
      },
    };
    const code = root
      ? `export function activate(s){s.register('commands','context',()=>s.context());for(const operation of ['read','write'])s.register('commands',operation,()=>s.capability('data',{kind:'fs',operation,path:'x.txt',...(operation==='write'?{data:[1]}:{})}));}`
      : `export function activate(s){s.register('tools','board',input=>input);}`;
    const preview = (await host.preview(
      await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(manifest)),
        "main.js": Buffer.from(code),
        "index.html": Buffer.from(`<title>${id}</title>`),
        ...(root && engine
          ? {
              "engine.js": Buffer.from(
                `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.id)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocol:'jsonrpc-jsonl-v1'}:{ok:true}}));});`,
              ),
            }
          : {}),
      }),
    )) as { token: string };
    items.push(await host.importLibrary(preview.token));
  }
  const choice = (await host.planAssembly(items.map((i) => i.digest)))
    .protocols[0]!.candidates[0]!.intent;
  const create = async () => {
    const agent = await host.createAgent(
      "Panels",
      items.map((i) => i.digest),
      undefined,
      "orchestrator",
      [choice],
    );
    await host.enable(agent.instanceId, "board");
    await host.enable(agent.instanceId, "orchestrator");
    await writeFile(
      path.join(dataDir, "instances", agent.instanceId, "agent-data", "x.txt"),
      "Synthetic boundary fixture",
    );
    return agent;
  };
  const agent = await create(),
    root = (await host.openFrontend(agent.instanceId))!,
    panel = await host.openPanel(
      root.context.sessionId,
      root.context.handle,
      "board",
      "board",
    );
  const post = (data: unknown = { answer: "synthetic-body" }) =>
    host.postPanel(root.context.sessionId, panel.context.handle, {
      version: "1.0",
      to: root.context.handle,
      topic: "answer",
      data,
    });
  const message = () =>
    deliveries
      .filter(
        (d): d is Extract<PanelDelivery, { type: "message" }> =>
          d.type === "message",
      )
      .at(-1)!.message;
  return {
    host,
    agent,
    root,
    panel,
    create,
    post,
    message,
    deliveries,
    audit,
    secrets,
    fs,
  };
}
it("opens independently owned snapshots, routes only a bound pair and freezes sender identity without auditing business content", async () => {
  const f = await fixture();
  expect(f.panel.context).toMatchObject({
    agentId: f.agent.instanceId,
    componentId: "board",
    panelId: "board",
    parentHandle: f.root.context.handle,
  });
  await f.host.panelLayout(f.root.context.sessionId, f.root.context.handle, {
    root: { x: 0, y: 0, width: 0.5, height: 1 },
    panels: [
      { handle: f.panel.context.handle, x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  });
  const data = { answer: "synthetic-body" };
  const posted = f.post(data);
  data.answer = "changed";
  await posted;
  expect(f.message()).toMatchObject({
    data: { answer: "synthetic-body" },
    from: {
      handle: f.panel.context.handle,
      componentId: "board",
      panelId: "board",
    },
    to: f.root.context.handle,
  });
  expect(Object.isFrozen(f.message().from)).toBe(true);
  expect(JSON.stringify(f.audit)).not.toContain("synthetic-body");
  const context = await f.host.frontendInvoke(
    f.root.context.sessionId,
    f.root.context.handle,
    {
      kind: "commands",
      name: "context",
      input: {},
      messageId: f.message().messageId,
    },
  );
  expect(context).toMatchObject({
    agentId: f.agent.instanceId,
    componentId: "orchestrator",
    frontend: {
      sessionId: f.root.context.sessionId,
      handle: f.root.context.handle,
    },
  });
});
it("rejects sender claims, foreign sessions, undeclared topics, wrong versions, oversized data and panel management of its parent", async () => {
  const f = await fixture(),
    other = await f.create(),
    otherRoot = (await f.host.openFrontend(other.instanceId))!;
  const valid = {
    version: "1.0" as const,
    to: f.root.context.handle,
    topic: "answer",
    data: null,
  };
  for (const bad of [
    { ...valid, from: { componentId: "orchestrator" } },
    { ...valid, to: otherRoot.context.handle },
    { ...valid, topic: "other" },
    { ...valid, version: "2.0" },
    { ...valid, data: "x".repeat(65536) },
  ])
    await expect(
      f.host.postPanel(
        f.root.context.sessionId,
        f.panel.context.handle,
        bad as any,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    f.host.postPanel(
      otherRoot.context.sessionId,
      f.panel.context.handle,
      valid,
    ),
  ).rejects.toMatchObject({ details: { reason: "PANEL_HANDLE_STALE" } });
  await expect(
    f.host.openPanel(
      f.root.context.sessionId,
      f.panel.context.handle,
      "board",
      "board",
    ),
  ).rejects.toMatchObject({ details: { reason: "PANEL_OPEN_DENIED" } });
  await expect(
    f.host.closePanel(
      f.root.context.sessionId,
      f.panel.context.handle,
      f.root.context.handle,
    ),
  ).rejects.toMatchObject({ details: { reason: "PANEL_CLOSE_DENIED" } });
  expect(f.deliveries.filter((e) => e.type === "message")).toHaveLength(0);
});
it("preserves the message sender's permission intersection when responding through a real isolate", async () => {
  const f = await fixture(false);
  await f.post();
  await expect(
    f.host.frontendInvoke(f.root.context.sessionId, f.root.context.handle, {
      messageId: f.message().messageId,
      kind: "commands",
      name: "write",
      input: {},
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(f.fs.records).toHaveLength(0);
  await f.host.frontendInvoke(f.root.context.sessionId, f.root.context.handle, {
    messageId: f.message().messageId,
    kind: "commands",
    name: "read",
    input: {},
  });
  expect(f.fs.records).toHaveLength(1);
  await expect(
    f.host.frontendInvoke(f.root.context.sessionId, f.panel.context.handle, {
      messageId: f.message().messageId,
      kind: "tools",
      name: "board",
      input: {},
    }),
  ).rejects.toMatchObject({ details: { reason: "PANEL_MESSAGE_STALE" } });
});
it("unregisters a panel, invalidates receipts and handles, and reopens with a new identity while its root remains available", async () => {
  const f = await fixture();
  await f.post();
  const receipt = f.message().messageId;
  await f.host.closePanel(
    f.root.context.sessionId,
    f.root.context.handle,
    f.panel.context.handle,
  );
  await expect(f.post()).rejects.toMatchObject({
    details: { reason: "PANEL_HANDLE_STALE" },
  });
  await expect(
    f.host.frontendInvoke(f.root.context.sessionId, f.root.context.handle, {
      messageId: receipt,
      kind: "commands",
      name: "context",
      input: {},
    }),
  ).rejects.toMatchObject({ details: { reason: "PANEL_MESSAGE_STALE" } });
  const reopened = await f.host.openPanel(
    f.root.context.sessionId,
    f.root.context.handle,
    "board",
    "board",
  );
  expect(reopened.context.handle).not.toBe(f.panel.context.handle);
  expect(
    await f.host.frontendContext(
      f.root.context.sessionId,
      f.root.context.handle,
    ),
  ).toEqual(f.root.context);
});
it("invalidates all screen handles on cancel, close, rebuild and host restart without changing the saved provider selection", async () => {
  const f = await fixture();
  await f.host.revokeTaskScope(f.agent.instanceId);
  await expect(f.post()).rejects.toMatchObject({
    details: { reason: "PANEL_HANDLE_STALE" },
  });
  const root = (await f.host.openFrontend(f.agent.instanceId))!;
  expect(root.context.sessionId).not.toBe(f.root.context.sessionId);
  await f.host.openPanel(
    root.context.sessionId,
    root.context.handle,
    "board",
    "board",
  );
  await f.host.setSettings(
    f.agent.instanceId,
    "board",
    { label: "rebuild" },
    {},
  );
  await expect(
    f.host.frontendContext(root.context.sessionId, root.context.handle),
  ).rejects.toMatchObject({ details: { reason: "PANEL_HANDLE_STALE" } });
  const next = (await f.host.openFrontend(f.agent.instanceId))!;
  await f.host.openPanel(
    next.context.sessionId,
    next.context.handle,
    "board",
    "board",
  );
  f.host.closeFrontend(next.context.sessionId);
  await expect(
    f.host.frontendContext(next.context.sessionId, next.context.handle),
  ).rejects.toThrow();
  await f.host.close();
  const restart = new DesktopHost({ ...f.host.options });
  hosts.push(restart);
  await restart.initialize();
  const fresh = (await restart.openFrontend(f.agent.instanceId))!;
  expect(
    (
      await restart.openPanel(
        fresh.context.sessionId,
        fresh.context.handle,
        "board",
        "board",
      )
    ).context.componentId,
  ).toBe("board");
  await expect(
    restart.frontendContext(next.context.sessionId, next.context.handle),
  ).rejects.toThrow();
});
it("cancels an event response awaiting confirmation when the sending panel closes before its sink", async () => {
  let started!: () => void, finish!: (v: boolean) => void;
  const waiting = new Promise<void>((r) => (started = r)),
    answer = new Promise<boolean>((r) => (finish = r));
  const f = await fixture(true, async () => {
    started();
    return answer;
  });
  await f.post();
  const result = f.host
    .frontendInvoke(f.root.context.sessionId, f.root.context.handle, {
      kind: "commands",
      name: "write",
      input: {},
      messageId: f.message().messageId,
    })
    .catch((e) => e);
  await waiting;
  await f.host.closePanel(
    f.root.context.sessionId,
    f.root.context.handle,
    f.panel.context.handle,
  );
  finish(true);
  expect(await result).toBeInstanceOf(Error);
  expect(f.fs.records).toHaveLength(0);
  expect(
    await f.host.frontendContext(
      f.root.context.sessionId,
      f.root.context.handle,
    ),
  ).toEqual(f.root.context);
});
it("bounds message throughput and excludes content from exports", async () => {
  const f = await fixture();
  vi.spyOn(Date, "now").mockReturnValue(Date.now());
  for (let i = 0; i < 128; i++) await f.post({ i });
  await expect(f.post()).rejects.toMatchObject({
    details: { reason: "PANEL_BACKPRESSURE" },
  });
  const exported = await f.host.exportAgent(f.agent.instanceId);
  const { validateAgentBundle } = await import("@plumsjs/sdk");
  const bundle = await validateAgentBundle(exported);
  expect(JSON.stringify(bundle.agent)).not.toContain(f.root.context.sessionId);
  expect(JSON.stringify(bundle.agent)).not.toContain(f.panel.context.handle);
  expect(JSON.stringify(bundle.agent)).not.toContain("messageId");
});
it("rechecks a revoked endpoint after asynchronous secret refresh and redacts both components' keys", async () => {
  const f = await fixture();
  await f.host.setSettings(
    f.agent.instanceId,
    "orchestrator",
    { label: "root" },
    { token: "synthetic-key" },
  );
  const root = (await f.host.openFrontend(f.agent.instanceId))!,
    panel = await f.host.openPanel(
      root.context.sessionId,
      root.context.handle,
      "board",
      "board",
    );
  await f.host.postPanel(root.context.sessionId, panel.context.handle, {
    version: "1.0",
    to: root.context.handle,
    topic: "answer",
    data: { text: "synthetic-key" },
  });
  expect(JSON.stringify(f.message().data)).not.toContain("synthetic-key");
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>((r) => (entered = r)),
    resume = new Promise<void>((r) => (release = r)),
    get = f.secrets.get.bind(f.secrets);
  vi.spyOn(f.secrets, "get").mockImplementation(async (ref) => {
    entered();
    await resume;
    return get(ref);
  });
  const result = f.host
    .postPanel(root.context.sessionId, panel.context.handle, {
      version: "1.0",
      to: root.context.handle,
      topic: "answer",
      data: { text: "revoked-content" },
    })
    .catch((e) => e);
  await pending;
  await f.host.closePanel(
    root.context.sessionId,
    root.context.handle,
    panel.context.handle,
  );
  release();
  expect(await result).toMatchObject({ code: "PERMISSION_DENIED" });
  expect(JSON.stringify(f.deliveries)).not.toContain("revoked-content");
  expect(
    await f.host.frontendContext(root.context.sessionId, root.context.handle),
  ).toEqual(root.context);
});
it("keeps only the newest concurrent frontend session active", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([
    f.host.openFrontend(f.agent.instanceId),
    f.host.openFrontend(f.agent.instanceId),
  ]);
  const resources = results
    .filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<DesktopHost["openFrontend"]>>
      > => r.status === "fulfilled",
    )
    .map((r) => r.value!);
  expect(resources.length).toBeGreaterThan(0);
  await expect(
    f.host.frontendContext(f.root.context.sessionId, f.root.context.handle),
  ).rejects.toThrow();
  const active = await Promise.allSettled(
    resources.map((r) =>
      f.host.frontendContext(r.context.sessionId, r.context.handle),
    ),
  );
  expect(active.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("cancels pending engine startup with its frontend but retains an already authorized running engine after frontend close", async () => {
  let entered!: () => void, release!: () => void;
  const pending = new Promise<void>((r) => {
      entered = r;
    }),
    answer = new Promise<void>((r) => {
      release = r;
    });
  const confirm = vi.fn(async () => true);
  const f = await fixture(true, confirm, true);
  await expect(
    f.host.frontendEngine(
      f.root.context.sessionId,
      f.root.context.handle,
      "start",
      { engineId: "fixture" },
    ),
  ).rejects.toMatchObject({ code: "TIER_REQUIRED" });
  expect(confirm).not.toHaveBeenCalled();
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: ["orchestrator"],
  };
  const plan = await f.host.tierPlan(f.agent.instanceId, selection);
  await f.host.confirmTier(f.agent.instanceId, plan.fingerprint, selection);
  const previous = f.host.options.audit!;
  let blocked = false;
  f.host.options.audit = async (id, event) => {
    await previous(id, event);
    if (event.reason === "ENGINE_START" && !blocked) {
      blocked = true;
      entered();
      await answer;
    }
  };
  const starting = f.host
    .frontendEngine(f.root.context.sessionId, f.root.context.handle, "start", {
      engineId: "fixture",
    })
    .catch((e) => e);
  await pending;
  f.host.closeFrontend(f.root.context.sessionId);
  release();
  expect(await starting).toMatchObject({ code: expect.any(String) });
  expect(
    await f.host.engineStatus(f.agent.instanceId, "orchestrator", "fixture"),
  ).toMatchObject({ state: "stopped", trusted: true });
  const root = (await f.host.openFrontend(f.agent.instanceId))!;
  expect(
    await f.host.frontendEngine(
      root.context.sessionId,
      root.context.handle,
      "start",
      { engineId: "fixture" },
    ),
  ).toMatchObject({ state: "running", trusted: true });
  f.host.closeFrontend(root.context.sessionId);
  expect(
    await f.host.engineStatus(f.agent.instanceId, "orchestrator", "fixture"),
  ).toMatchObject({ state: "running", trusted: true });
  expect(
    await f.host.engineCall(f.agent.instanceId, "orchestrator", "request", {
      engineId: "fixture",
      method: "ping",
      input: {},
    }),
  ).toEqual({ ok: true });
  expect(confirm).toHaveBeenCalledTimes(1);
});
