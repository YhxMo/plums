import { expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import { PlatformAdapter } from "../src/platform";
import { loadFolder } from "./fixtures/folders";

const workbench = await loadFolder("extensions/services/workbench");
const reverse = await loadFolder("extensions/services/reverse");
import type { ExtensionDefinition, Platform } from "../modules/sdk";
import type { Workbench } from "../extensions/contracts";

const definition = (
  id: string,
  activate: ExtensionDefinition["activate"],
  extra = {},
): ExtensionDefinition => ({
  manifest: { id, version: "1.0.0", apiVersion: 1, ...extra },
  activate,
});
const platform = (): Platform => ({
  kind: "browser",
  available: () => true,
  grant: async () => {},
  call: async () => null,
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function setup(adapter: Platform) {
  const host = new Host(adapter);
  let api!: Workbench;
  host.install(reverse);
  host.install(workbench);
  host.install(
    definition(
      "observer",
      (ctx) => {
        api = ctx.use<Workbench>("workbench");
      },
      { requires: { workbench: 1 } },
    ),
  );
  await host.start("transform.reverse");
  await host.grant("workbench", ["state.read", "state.write"]);
  await host.start("workbench");
  await host.start("observer");
  return { host, api };
}

it("propagates operation cancellation to a cooperative write before commit", async () => {
  const entered = deferred();
  const gate = deferred();
  let persisted = false;
  let receivedSignal: AbortSignal | undefined;
  const adapter: Platform = {
    ...platform(),
    call: async (_owner, cap, payload, signal) => {
      if (cap === "state.read") return null;
      receivedSignal = signal;
      entered.resolve();
      await gate.promise;
      signal?.throwIfAborted();
      persisted = true;
      return { revision: 1, value: (payload as { value: unknown }).value };
    },
  };
  const { host, api } = await setup(adapter);
  const operation = api.run("cancel fixture");
  await entered.promise;
  api.cancel();
  const abortedBeforeCommit = receivedSignal?.aborted;
  gate.resolve();
  await operation;
  expect(abortedBeforeCommit).toBe(true);
  expect(persisted).toBe(false);
  expect(api.snapshot().phase).toBe("cancelled");
  await host.stop("workbench");
});

it("reports a confirmed commit even if cancellation arrives before its receipt", async () => {
  const committed = deferred();
  const receipt = deferred();
  let persisted = false;
  const adapter: Platform = {
    ...platform(),
    call: async (_owner, cap, payload) => {
      if (cap === "state.read") return null;
      persisted = true;
      committed.resolve();
      await receipt.promise;
      return { revision: 1, value: (payload as { value: unknown }).value };
    },
  };
  const { host, api } = await setup(adapter);
  const operation = api.run("committed fixture");
  await committed.promise;
  api.cancel();
  receipt.resolve();
  await operation;
  expect(persisted).toBe(true);
  expect(api.snapshot().phase).toBe("saved");
  expect(api.snapshot().runs).toBe(1);
  await host.stop("workbench");
});

it("keeps an unconfirmed write outcome distinct from proven cancellation", async () => {
  const entered = deferred();
  const receipt = deferred();
  let writes = 0;
  const adapter: Platform = {
    ...platform(),
    call: async (_owner, cap) => {
      if (cap === "state.read") return null;
      writes++;
      entered.resolve();
      await receipt.promise;
      throw new Error("receipt unavailable");
    },
  };
  const { host, api } = await setup(adapter);
  const operation = api.run("unknown fixture");
  await entered.promise;
  api.cancel();
  receipt.resolve();
  await operation;
  expect(api.snapshot().phase).toBe("uncertain");
  await expect(api.run("do not blindly retry")).rejects.toThrow("未执行");
  expect(writes).toBe(1);
  await host.stop("workbench");
});

it("retries a transient activation failure after its completed cleanup", async () => {
  const host = new Host(platform());
  let fail = true;
  let activations = 0;
  host.install(
    definition("retry", () => {
      activations++;
      if (fail) throw new Error("transient failure");
    }),
  );
  await expect(host.start("retry")).rejects.toThrow("transient");
  expect(host.inspect("retry").error).toContain("transient");
  fail = false;
  await host.start("retry");
  expect(activations).toBe(2);
  expect(host.inspect("retry").status).toBe("active");
});

it("latches unmount failure during switching and never blindly repeats that cleanup", async () => {
  const host = new Host(platform());
  const unmount = vi.fn(() => {
    throw new Error("unmount failure");
  });
  host.install(
    definition("layout", (ctx) =>
      ctx.view({ id: "layout", label: "Fixture", mount: () => unmount }),
    ),
  );
  await host.start("layout");
  const close = host.mountView("layout", {} as HTMLElement);
  expect(close).toThrow("unmount failure");
  expect(host.inspect("layout").status).toBe("cleanup-failed");
  await expect(host.stop("layout")).rejects.toThrow("unmount failure");
  expect(host.inspect("layout").status).toBe("cleanup-failed");
  expect(host.inspect("layout").resources).toBeGreaterThan(0);
  expect(unmount).toHaveBeenCalledOnce();
  await expect(host.start("layout")).rejects.toThrow("restart");
});

it("tracks asynchronous unmount failures instead of losing their promise", async () => {
  const host = new Host(platform());
  const failure = Promise.reject(new Error("async unmount failure"));
  void failure.catch(() => {});
  const unmount = vi.fn(() => failure);
  host.install(
    definition("async-layout", (ctx) =>
      ctx.view({ id: "async-layout", label: "Async", mount: () => unmount }),
    ),
  );
  await host.start("async-layout");
  const close = host.mountView("async-layout", {} as HTMLElement);
  await expect(Promise.resolve(close())).rejects.toThrow(
    "async unmount failure",
  );
  await expect(host.stop("async-layout")).rejects.toThrow();
  expect(host.inspect("async-layout").status).toBe("cleanup-failed");
  expect(unmount).toHaveBeenCalledOnce();
});

it.each([
  "null",
  "false",
  "0",
  '""',
  '{"schema":99,"revision":1,"value":"future"}',
])("preserves malformed or unsupported browser state %s", async (raw) => {
  const values = new Map([["plums:sample", raw]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    const adapter = new PlatformAdapter();
    await adapter.grant("sample", ["state.read", "state.write"]);
    await expect(adapter.call("sample", "state.read")).rejects.toThrow();
    await expect(
      adapter.call("sample", "state.write", {
        revision: 0,
        value: "replacement",
      }),
    ).rejects.toThrow();
    expect(values.get("plums:sample")).toBe(raw);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps an extension with the shell-like identifier in a separate state namespace", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    const adapter = new PlatformAdapter();
    await adapter.grant("host.shell", ["state.read", "state.write"]);
    await adapter.call("host.shell", "state.write", {
      revision: 0,
      value: { layout: "board" },
    });
    const host = new Host(adapter);
    let extensionState: unknown;
    host.install(
      definition(
        "host.shell",
        async (ctx) => {
          extensionState = await ctx.platform("state.read");
          await ctx.platform("state.write", {
            revision: 0,
            value: "extension",
          });
        },
        { capabilities: ["state.read", "state.write"] },
      ),
    );
    await host.grant("host.shell", ["state.read", "state.write"]);
    await host.start("host.shell");
    expect(extensionState).toBeNull();
    expect(
      ((await adapter.call("host.shell", "state.read")) as { value: unknown })
        .value,
    ).toEqual({ layout: "board" });
  } finally {
    vi.unstubAllGlobals();
  }
});
