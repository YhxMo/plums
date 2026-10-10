import { afterEach, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { fixture } from "./common-fixture.js";
import { FoundationRegistry } from "../src/foundation-factory.js";
import {
  OFFICIAL_FOUNDATION_REFERENCE,
  OFFICIAL_FOUNDATION_PROVIDER,
} from "../src/official-foundation.js";
import type {
  HostFoundationSession,
  FoundationSessionOptions,
} from "../src/foundation-runtime.js";
import type { DesktopHost } from "../src/host.js";

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
  const f = await fixture("controlled-node");
  hosts.push(f.host);
  dirs.push(f.dir);
  return f;
}

it("reports factory-owned cleanup failure when shutdown invalidates a not-yet-returned session", async () => {
  const f = await setup();
  hosts.splice(hosts.indexOf(f.host), 1);
  let release!: () => void, entered!: () => void, releaseOwned!: () => void;
  const ownedCleanup = new Promise<void>((resolve) => {
    releaseOwned = resolve;
  });
  const closeOwned = vi.fn(async () => {
    await ownedCleanup;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entering = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const stop = vi.fn(),
    close = vi.fn(async () => {
      throw Error("private cleanup failure");
    });
  const dispatch = vi.fn(async () => null);
  const registry = new FoundationRegistry();
  registry.register({
    provider: OFFICIAL_FOUNDATION_PROVIDER,
    version: "1.0.0",
    selection: f.a.foundation!.selection,
    create: async (options) => {
      const owned = options.actor.componentId === "provider";
      if (!owned) {
        entered();
        await gate;
      }
      return {
        instanceId: options.binding.instanceId,
        alive: true,
        ready: async () => {},
        activate: async () => {},
        invoke: dispatch,
        deliverEvent: async () => null,
        cancel: async () => {},
        stop: owned ? () => {} : stop,
        close: owned ? closeOwned : close,
      };
    },
  });
  // Trusted fixture injection; components have no access to the registry.
  (f.host as unknown as { foundations: FoundationRegistry }).foundations =
    registry;
  await f.host.invoke(f.a.instanceId, "provider", "provider", "tools", "test", {
    operation: "echo",
    input: 0,
  });
  dispatch.mockClear();
  const invocation = f.host.invoke(
    f.a.instanceId,
    "consumer",
    "consumer",
    "commands",
    "run",
    { value: 1 },
  );
  const failedInvocation = expect(invocation).rejects.toMatchObject({
    details: { reason: "FOUNDATION_CLEANUP_FAILED" },
  });
  try {
    await entering;
    const closing = f.host.close();
    let shutdownSettled = false;
    void closing.then(
      () => {
        shutdownSettled = true;
      },
      () => {
        shutdownSettled = true;
      },
    );
    const failedShutdown = expect(closing).rejects.toMatchObject({
      details: { reason: "FOUNDATION_CLEANUP_FAILED" },
    });
    release();
    await failedInvocation;
    await expect.poll(() => closeOwned.mock.calls.length).toBe(1);
    expect(shutdownSettled).toBe(false);
    releaseOwned();
    await failedShutdown;
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
    await expect(f.host.close()).rejects.toMatchObject({
      details: { reason: "FOUNDATION_CLEANUP_FAILED" },
    });
    await expect(
      registry.settleCleanup(f.b.instanceId),
    ).resolves.toBeUndefined();
    await expect(registry.settleCleanup(f.a.instanceId)).rejects.toMatchObject({
      details: { reason: "FOUNDATION_CLEANUP_FAILED" },
    });
  } finally {
    release();
    releaseOwned();
    await f.host.close().catch(() => {});
  }
});

it("Host.close waits for a pending public factory and prevents it from publishing a late instance", async () => {
  const f = await setup();
  const original = FoundationRegistry.prototype.create;
  let release!: () => void, observed!: FoundationSessionOptions;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let entered!: () => void;
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  const spy = vi
    .spyOn(FoundationRegistry.prototype, "create")
    .mockImplementation(async function (reference, options) {
      observed = options;
      entered();
      await gate;
      return original.call(this, reference, options);
    });
  const invocation = f.host.invoke(
    f.a.instanceId,
    "provider",
    "provider",
    "tools",
    "test",
    { operation: "echo", input: 1 },
  );
  const rejected = expect(invocation).rejects.toBeDefined();
  try {
    await entering;
    let finished = false;
    const closing = f.host.close().then(() => {
      finished = true;
    });
    await expect
      .poll(() => {
        try {
          observed.assertCurrent();
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
    expect(finished).toBe(false);
    release();
    await closing;
    await rejected;
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    release();
    spy.mockRestore();
  }
});

it("routes the official controlled and isolate components of two Agents through one public factory and waits only for the stopped Agent", async () => {
  const f = await setup();
  const owned: {
    session: HostFoundationSession;
    options: FoundationSessionOptions;
  }[] = [];
  let release!: () => void;
  const cleanup = new Promise<void>((r) => {
    release = r;
  });
  const original = FoundationRegistry.prototype.create;
  const spy = vi
    .spyOn(FoundationRegistry.prototype, "create")
    .mockImplementation(async function (reference, options) {
      expect(reference).toEqual({
        ...OFFICIAL_FOUNDATION_REFERENCE,
        digest:
          options.actor.agentId === f.a.instanceId
            ? f.a.foundation!.selection.digest
            : f.b.foundation!.selection.digest,
      });
      const session = await original.call(this, reference, options);
      // Expose only the public interface, with no Runtime controller, mode or transport.
      const facade: HostFoundationSession = {
        instanceId: session.instanceId,
        get alive() {
          return session.alive;
        },
        ready: () => session.ready(),
        activate: () => session.activate(),
        invoke: (...a) => session.invoke(...a),
        deliverEvent: (...a) => session.deliverEvent(...a),
        cancel: () => session.cancel(),
        stop: () => session.stop(),
        close: async () => {
          if (options.actor.agentId === f.a.instanceId) await cleanup;
          await session.close();
        },
      };
      owned.push({ session: facade, options });
      return facade;
    });
  const invoke = (id: string, value: number) =>
    f.host.invoke(id, "consumer", "consumer", "commands", "run", { value });
  try {
    const [a, b] = await Promise.all([
      invoke(f.a.instanceId, 1),
      invoke(f.b.instanceId, 2),
    ]);
    expect(a).toMatchObject({
      outcome: { ok: true, value: { value: { value: 1 } } },
    });
    expect(b).toMatchObject({
      outcome: { ok: true, value: { value: { value: 2 } } },
    });
    const as = owned.filter((o) => o.options.actor.agentId === f.a.instanceId);
    const bs = owned.filter((o) => o.options.actor.agentId === f.b.instanceId);
    expect(as.map((o) => o.options.actor.componentId).sort()).toEqual([
      "consumer",
      "provider",
    ]);
    expect(bs.map((o) => o.options.actor.componentId).sort()).toEqual([
      "consumer",
      "provider",
    ]);
    expect(new Set(owned.map((o) => o.session.instanceId)).size).toBe(4);
    expect(as[0]!.options.actor.installationId).not.toBe(
      bs[0]!.options.actor.installationId,
    );
    let finished = false;
    const stopping = f.host.disable(f.a.instanceId, "provider").then(() => {
      finished = true;
    });
    await expect.poll(() => as.every((o) => !o.session.alive)).toBe(true);
    expect(finished).toBe(false);
    expect(await invoke(f.b.instanceId, 3)).toMatchObject({
      outcome: { ok: true, value: { value: { value: 3 } } },
    });
    expect(bs.every((o) => o.session.alive)).toBe(true);
    release();
    await stopping;
    f.host.closeFrontend(f.frontend.context.sessionId);
    await f.host.close();
    expect(owned.every((o) => !o.session.alive)).toBe(true);
  } finally {
    release();
    spy.mockRestore();
  }
}, 20000);

it("retains a failed public-session cleanup for awaited shutdown instead of silently marking Host.close successful", async () => {
  const f = await setup();
  const original = FoundationRegistry.prototype.create;
  const closed: string[] = [];
  const spy = vi
    .spyOn(FoundationRegistry.prototype, "create")
    .mockImplementation(async function (reference, options) {
      const session = await original.call(this, reference, options);
      return {
        instanceId: session.instanceId,
        get alive() {
          return session.alive;
        },
        ready: () => session.ready(),
        activate: () => session.activate(),
        invoke: (...a) => session.invoke(...a),
        deliverEvent: (...a) => session.deliverEvent(...a),
        cancel: () => session.cancel(),
        stop: () => session.stop(),
        close: async () => {
          await session.close();
          closed.push(options.actor.agentId);
          if (options.actor.agentId === f.a.instanceId)
            throw Error("fixture cleanup failed");
        },
      };
    });
  await Promise.all([
    f.host.invoke(f.a.instanceId, "provider", "provider", "tools", "test", {
      operation: "echo",
      input: 1,
    }),
    f.host.invoke(f.b.instanceId, "provider", "provider", "tools", "test", {
      operation: "echo",
      input: 2,
    }),
  ]);
  f.host.closeFrontend(f.frontend.context.sessionId);
  await expect(f.host.close()).rejects.toThrow("fixture cleanup failed");
  expect(closed).toContain(f.a.instanceId);
  expect(closed).toContain(f.b.instanceId);
  await expect(f.host.close()).rejects.toThrow("fixture cleanup failed");
  hosts.splice(hosts.indexOf(f.host), 1);
  spy.mockRestore();
}, 20000);

it("reopening while a session closes keeps the new owner and still excludes another host", async () => {
  const f = await setup();
  let release!: () => void,
    entered!: () => void,
    blocking = true;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    reached = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    original = FoundationRegistry.prototype.create;
  vi.spyOn(FoundationRegistry.prototype, "create").mockImplementation(
    async function (reference, options) {
      const session = await original.call(this, reference, options);
      const close = session.close.bind(session);
      session.close = async () => {
        if (blocking && options.actor.agentId === f.a.instanceId) {
          entered();
          await gate;
        }
        await close();
      };
      return session;
    },
  );
  try {
    await f.host.invoke(
      f.a.instanceId,
      "provider",
      "provider",
      "tools",
      "test",
      { operation: "echo", input: 1 },
    );
    const stopping = f.host.stopSession(f.a.instanceId);
    await reached;
    const reopening = f.host.foundationStatus(f.a.instanceId);
    void reopening.catch(() => {});
    blocking = false;
    release();
    await stopping;
    expect(await reopening).toEqual(f.a.foundation);
    await expect(
      f.host.invoke(f.a.instanceId, "provider", "provider", "tools", "test", {
        operation: "echo",
        input: 2,
      }),
    ).resolves.toEqual({ value: 2 });
    const { DesktopHost } = await import("../src/host.js");
    const { MemorySecretStore } = await import("@plumsjs/core");
    const other = new DesktopHost({
      dataDir: f.dir,
      nodePath: process.execPath,
      confirm: { ask: async () => true },
      secretStore: () => new MemorySecretStore(),
    });
    hosts.push(other);
    await other.initialize();
    await expect(
      other.setFoundationEnabled(f.a.instanceId, false),
    ).rejects.toMatchObject({ details: { reason: "FOUNDATION_BUSY" } });
  } finally {
    blocking = false;
    release();
  }
});
