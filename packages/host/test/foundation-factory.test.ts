import { afterEach, expect, it } from "vitest";
import {
  createArchive,
  MemorySecretStore,
  RecordingFsSink,
  type PackageContents,
} from "@plums/core";
import type { FoundationSession } from "@plums/sdk";
import * as hostApi from "../src/index.js";
import { DesktopHost } from "../src/host.js";
import type {
  InvocationContext,
  RuntimeBridge,
  FoundationSessionOptions,
} from "../src/foundation-runtime.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sessions: FoundationSession<InvocationContext>[] = [];
const hosts: DesktopHost[] = [];
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
function component(features: string[] = []): PackageContents {
  return {
    manifest: {
      formatVersion: "2.0",
      id: "factory-fixture",
      kind: "extension",
      name: "Factory fixture",
      version: "1.0.0",
      description: "",
      dependencies: [],
      permissions: [
        {
          id: "files",
          kind: "fs",
          target: "agent-data",
          operations: ["list"],
          reason: "fixture",
        },
      ],
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          contributes: { commands: [{ name: "check", title: "Check" }] },
          foundation: {
            requirementVersion: "1.0",
            protocolRange: "^1.0.0",
            sdk: { id: "org.plums.sdk", version: "2.0.0" },
            features,
          },
        },
      },
    },
    files: {
      "main.js": Buffer.from(
        "export function activate(s){s.register('commands','check',()=>s.capability('files',{kind:'fs',operation:'list',path:'.'}));}",
      ),
    },
  };
}
const context = () => ({
  callers: [],
  ancestry: ["factory-fixture"],
  signal: new AbortController().signal,
});
function options(
  contents = component(),
  bridge: RuntimeBridge = async () => ({ value: "before" }),
): FoundationSessionOptions {
  return {
    component: contents,
    actor: {
      agentId: "fixture-agent",
      componentId: contents.manifest.id,
      installationId: "fixture-installation",
      componentVersion: contents.manifest.version,
      componentDigest: "a".repeat(64),
    },
    bridge,
    assertActive: async () => {},
    assertCurrent: () => {},
  };
}

it("rejects an explicit unsupported foundation requirement through DesktopHost before any Sink call", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "plums-foundation-factory-"),
  );
  dirs.push(dir);
  const fs = new RecordingFsSink();
  const host = new DesktopHost({
    dataDir: dir,
    fs,
    confirm: { ask: async () => true },
    secretStore: () => new MemorySecretStore(),
  });
  hosts.push(host);
  await host.initialize();
  const contents = component(["sdk.nonexistent"]);
  const preview = (await host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(contents.manifest)),
      ...contents.files,
    }),
  )) as { token: string };
  const item = await host.importLibrary(preview.token);
  await expect(
    host.createAgent("Fixture", [item.digest]),
  ).rejects.toMatchObject({
    details: {
      reason: "FOUNDATION_INCOMPATIBLE",
      executionState: "not_started",
    },
  });
  expect(await host.listAgents()).toEqual([]);
  expect(fs.records).toHaveLength(0);
});

it("prepares with zero callbacks, activates the official SDK, snapshots files, and cannot revive a closed session", async () => {
  const registry = hostApi.createOfficialFoundationRegistry();
  let calls = 0;
  const contents = component();
  const session = await hostApi.createFoundationSession(
    registry,
    hostApi.OFFICIAL_FOUNDATION_REFERENCE,
    options(contents, async () => {
      calls++;
      return { value: "before" };
    }),
  );
  sessions.push(session);
  contents.files["main.js"] = Buffer.from(
    "export function activate(){throw Error('mutated')}",
  );
  await session.ready();
  expect(calls).toBe(0);
  await expect(
    session.invoke("commands", "check", {}, context()),
  ).rejects.toMatchObject({ details: { executionState: "not_started" } });
  await session.activate();
  expect(await session.invoke("commands", "check", {}, context())).toEqual({
    value: "before",
  });
  expect(calls).toBe(1);
  await session.cancel();
  expect(session.alive).toBe(false);
  await expect(session.activate()).rejects.toBeDefined();
});

it("resolves exact registered versions and refuses replacement, missing providers, and incompatible SDKs", async () => {
  const registry = hostApi.createOfficialFoundationRegistry();
  const registration = {
    provider: hostApi.OFFICIAL_FOUNDATION_PROVIDER,
    version: "1.0.0",
    create: async () => {
      throw Error("must not run");
    },
  };
  expect(() => registry.register(registration)).toThrow();
  await expect(
    hostApi.createFoundationSession(
      registry,
      { ...hostApi.OFFICIAL_FOUNDATION_REFERENCE, version: "9.0.0" },
      options(),
    ),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_UNAVAILABLE" } });
  const contents = component();
  const payload = contents.manifest.payload as {
    plumsDesktop: { foundation: { sdk: { id: string } } };
  };
  payload.plumsDesktop.foundation.sdk.id = "org.example.sdk";
  await expect(
    hostApi.createFoundationSession(
      registry,
      hostApi.OFFICIAL_FOUNDATION_REFERENCE,
      options(contents),
    ),
  ).rejects.toMatchObject({ details: { reason: "FOUNDATION_INCOMPATIBLE" } });
});

it("retains event and delegated callback context through the public official session", async () => {
  const contents = component();
  contents.files["main.js"] = Buffer.from(
    "let last;export function activate(s){s.onEvent('update',e=>{last=e});s.register('commands','check',async()=>({last,settings:await s.settings()}));}",
  );
  let observed: InvocationContext | undefined;
  const session = await hostApi.createFoundationSession(
    hostApi.createOfficialFoundationRegistry(),
    hostApi.OFFICIAL_FOUNDATION_REFERENCE,
    options(contents, async (_method, _args, ctx) => {
      observed = ctx;
      return null;
    }),
  );
  sessions.push(session);
  await session.ready();
  await session.activate();
  const ctx = {
    ...context(),
    callers: [{ packageId: "caller", permissionId: "" }],
    ancestry: ["caller", "factory-fixture"],
  };
  await session.deliverEvent("update", { value: 7 }, ctx);
  expect(await session.invoke("commands", "check", {}, ctx)).toEqual({
    last: { value: 7 },
    settings: null,
  });
  expect(observed).toMatchObject({
    callers: ctx.callers,
    ancestry: ctx.ancestry,
    resourceInstanceId: session.instanceId,
  });
  expect(observed?.invocationId).toBeTypeOf("string");
});

it("enforces schemas and the host policy gate even when an adapter only implements the public session interface", async () => {
  const registry = new hostApi.FoundationRegistry();
  let dispatched = 0,
    revoked = false,
    cleaned = false;
  registry.register({
    provider: {
      ...hostApi.OFFICIAL_FOUNDATION_PROVIDER,
      id: "org.example.test",
    },
    version: "1.0.0",
    create: async (o) => ({
      instanceId: o.binding.instanceId,
      alive: true,
      ready: async () => {},
      activate: async () => {},
      invoke: async () => {
        dispatched++;
        return { wrong: "fixture" };
      },
      deliverEvent: async () => null,
      cancel: async () => {},
      stop: () => {},
      close: async () => {
        cleaned = true;
      },
    }),
  });
  const contents = component();
  const declaration = (
    contents.manifest.payload as { plumsDesktop: { contributes: unknown } }
  ).plumsDesktop;
  declaration.contributes = {
    tools: [
      {
        name: "save",
        title: "Save",
        inputSchema: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
        },
        outputSchema: {
          type: "object",
          properties: { saved: { type: "boolean" } },
          required: ["saved"],
        },
      },
    ],
  };
  const session = await hostApi.createFoundationSession(
    registry,
    { id: "org.example.test", version: "1.0.0" },
    {
      ...options(contents),
      beforeInvoke: async () => async () => {
        if (revoked) throw Error("fixture policy revoked");
      },
    },
  );
  sessions.push(session);
  await session.ready();
  await session.activate();
  await expect(
    session.invoke("tools", "save", {}, context()),
  ).rejects.toMatchObject({
    details: {
      reason: "CONTRIBUTION_INPUT_INVALID",
      executionState: "not_started",
    },
  });
  expect(dispatched).toBe(0);
  revoked = true;
  await expect(
    session.invoke("tools", "save", { value: 1 }, context()),
  ).rejects.toThrow("fixture policy revoked");
  expect(dispatched).toBe(0);
  revoked = false;
  await expect(
    session.invoke("tools", "save", { value: 1 }, context()),
  ).rejects.toMatchObject({
    details: {
      reason: "CONTRIBUTION_OUTPUT_INVALID",
      executionState: "completed",
    },
  });
  expect(dispatched).toBe(1);
  await session.close();
  expect(cleaned).toBe(true);
});

it.each(["invoke", "event"])(
  "checks the required async host checkpoint for %s without an optional call checkpoint",
  async (operation) => {
    const registry = new hostApi.FoundationRegistry();
    let revoked = false,
      dispatched = 0,
      checks = 0;
    registry.register({
      provider: {
        ...hostApi.OFFICIAL_FOUNDATION_PROVIDER,
        id: "org.example.checkpoint",
      },
      version: "1.0.0",
      create: async (o) => ({
        instanceId: o.binding.instanceId,
        alive: true,
        ready: async () => {},
        activate: async () => {},
        invoke: async () => {
          dispatched++;
          return null;
        },
        deliverEvent: async () => {
          dispatched++;
          return null;
        },
        cancel: async () => {},
        stop: () => {},
        close: async () => {},
      }),
    });
    const session = await hostApi.createFoundationSession(
      registry,
      { id: "org.example.checkpoint", version: "1.0.0" },
      {
        ...options(),
        assertActive: async () => {
          checks++;
          if (revoked) throw Error("fixture revoked");
        },
      },
    );
    sessions.push(session);
    await session.ready();
    await session.activate();
    revoked = true;
    const before = checks;
    await expect(
      operation === "invoke"
        ? session.invoke("commands", "check", {}, context())
        : session.deliverEvent("update", {}, context()),
    ).rejects.toThrow("fixture revoked");
    expect(checks).toBeGreaterThan(before);
    expect(dispatched).toBe(0);
  },
);

it("rechecks the required async host checkpoint after awaiting a policy gate", async () => {
  let revoked = false,
    dispatched = 0;
  const registry = new hostApi.FoundationRegistry();
  registry.register({
    provider: {
      ...hostApi.OFFICIAL_FOUNDATION_PROVIDER,
      id: "org.example.gated",
    },
    version: "1.0.0",
    create: async (o) => ({
      instanceId: o.binding.instanceId,
      alive: true,
      ready: async () => {},
      activate: async () => {},
      invoke: async () => {
        dispatched++;
        return null;
      },
      deliverEvent: async () => null,
      cancel: async () => {},
      stop: () => {},
      close: async () => {},
    }),
  });
  const session = await hostApi.createFoundationSession(
    registry,
    { id: "org.example.gated", version: "1.0.0" },
    {
      ...options(),
      assertActive: async () => {
        if (revoked) throw Error("fixture revoked");
      },
      beforeInvoke: async () => {
        revoked = true;
        return undefined;
      },
    },
  );
  sessions.push(session);
  await session.ready();
  await session.activate();
  await expect(
    session.invoke("commands", "check", {}, context()),
  ).rejects.toThrow("fixture revoked");
  expect(dispatched).toBe(0);
});
