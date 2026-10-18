import { describe, expect, it, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import { loadExtension } from "../modules/extension-host/definition";
import type {
  ExtensionContext,
  ExtensionDefinition,
  Platform,
} from "../modules/sdk";

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
  grant: vi.fn(async () => {}),
  call: vi.fn(async () => "ok"),
});

describe("M1 extension lifecycle contract", () => {
  it("waits for dependencies, then activates without load-order assumptions", async () => {
    const host = new Host(platform());
    let received = "";
    host.install(
      definition(
        "consumer",
        (ctx) => {
          received = ctx.use<string>("value");
        },
        { requires: { value: 1 } },
      ),
    );
    await host.start("consumer");
    expect(host.inspect("consumer").status).toBe("waiting");
    host.install(
      definition("provider", (ctx) => ctx.provide("value", 1, "ready"), {
        provides: { value: 1 },
      }),
    );
    await host.start("provider");
    expect(received).toBe("ready");
    expect(host.inspect("consumer").status).toBe("active");
  });

  it("stops consumers before a provider, then rebinds them to its replacement", async () => {
    const host = new Host(platform());
    const order: string[] = [];
    let value = "";
    for (const id of ["one", "two"])
      host.install(
        definition(
          id,
          (ctx) => {
            ctx.provide("value", 1, id);
            ctx.onDispose(() => {
              order.push(id);
            });
          },
          { provides: { value: 1 } },
        ),
      );
    host.install(
      definition(
        "consumer",
        (ctx) => {
          value = ctx.use<string>("value");
          ctx.onDispose(() => {
            order.push("consumer");
          });
        },
        { requires: { value: 1 } },
      ),
    );
    await host.start("consumer");
    await host.start("one");
    await host.stop("one");
    expect(order).toEqual(["consumer", "one"]);
    expect(host.inspect("consumer").status).toBe("waiting");
    await host.start("two");
    expect(value).toBe("two");
  });

  it("withdraws partial registrations when activation fails", async () => {
    const host = new Host(platform());
    const dispose = vi.fn();
    host.install(
      definition(
        "broken",
        (ctx) => {
          ctx.onDispose(dispose);
          ctx.provide("value", 1, 4);
          throw new Error("activation failure");
        },
        { provides: { value: 1 } },
      ),
    );
    await expect(host.start("broken")).rejects.toThrow("activation failure");
    expect(host.serviceNames()).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.inspect("broken").status).toBe("failed");
  });

  it("releases listeners on disable and does not duplicate them on restart", async () => {
    const host = new Host(platform());
    const listener = vi.fn();
    let emitter!: ExtensionContext;
    host.install(
      definition("emitter", (ctx) => {
        emitter = ctx;
      }),
    );
    host.install(
      definition("events", (ctx) => {
        ctx.on("tick", (data) => listener(data));
      }),
    );
    await host.start("emitter");
    await host.start("events");
    emitter.emit("tick", 1);
    await host.stop("events");
    emitter.emit("tick", 2);
    await host.start("events");
    emitter.emit("tick", 3);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(host.inspect("events").resources).toBe(1);
  });

  it("enforces capability declarations and grants on every cooperative call", async () => {
    const adapter = platform();
    const host = new Host(adapter);
    let context!: ExtensionContext;
    host.install(
      definition(
        "writer",
        (ctx) => {
          context = ctx;
        },
        { capabilities: ["state.write"] },
      ),
    );
    await host.start("writer");
    expect(host.inspect("writer").status).toBe("waiting");
    await host.grant("writer", ["state.write"]);
    await context.platform("state.write", "data");
    await expect(context.platform("undeclared")).rejects.toThrow(
      "not declared",
    );
    await host.grant("writer", []);
    await expect(context.platform("state.write")).rejects.toThrow();
    expect(adapter.call).toHaveBeenCalledTimes(1);
  });

  it("cancels tracked work before finishing disable", async () => {
    const host = new Host(platform());
    let context!: ExtensionContext;
    host.install(
      definition("worker", (ctx) => {
        context = ctx;
      }),
    );
    await host.start("worker");
    const task = context.task(
      (signal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
    );
    expect(host.inspect("worker").tasks).toBe(1);
    await host.stop("worker");
    await task;
    expect(host.inspect("worker").tasks).toBe(0);
    expect(host.inspect("worker").status).toBe("disabled");
  });

  it("reports cleanup failure and continues remaining disposers", async () => {
    const host = new Host(platform());
    const released = vi.fn();
    host.install(
      definition("broken-cleanup", (ctx) => {
        ctx.onDispose(released);
        ctx.onDispose(() => {
          throw new Error("cleanup failure");
        });
      }),
    );
    await host.start("broken-cleanup");
    await expect(host.stop("broken-cleanup")).rejects.toThrow(
      "cleanup failure",
    );
    expect(released).toHaveBeenCalledOnce();
    expect(host.inspect("broken-cleanup").status).toBe("cleanup-failed");
    await expect(host.start("broken-cleanup")).rejects.toThrow("restart");
  });

  it("does not hang forever on uncooperative tasks", async () => {
    const host = new Host(platform(), 20);
    let context!: ExtensionContext;
    host.install(
      definition("stuck", (ctx) => {
        context = ctx;
      }),
    );
    await host.start("stuck");
    void context.task(() => new Promise(() => {}));
    await expect(host.stop("stuck")).rejects.toThrow("timeout");
    expect(host.inspect("stuck").status).toBe("cleanup-failed");
  });

  it("reports a retryable activation timeout separately from cleanup", async () => {
    const host = new Host(platform(), 20);
    let calls = 0;
    host.install(
      definition("slow-activate", () => {
        calls++;
        return calls === 1 ? new Promise<void>(() => {}) : undefined;
      }),
    );
    await expect(host.start("slow-activate")).rejects.toThrow(
      "activation timeout",
    );
    expect(host.inspect("slow-activate").status).toBe("failed");
    await host.start("slow-activate");
    expect(host.inspect("slow-activate").status).toBe("active");
    expect(calls).toBe(2);
  });

  it("rejects incompatible service versions and duplicate providers", async () => {
    const host = new Host(platform());
    host.install(definition("consumer", () => {}, { requires: { value: 2 } }));
    await host.start("consumer");
    host.install(
      definition("one", (ctx) => ctx.provide("value", 1, 1), {
        provides: { value: 1 },
      }),
    );
    await host.start("one");
    expect(host.inspect("consumer").status).toBe("waiting");
    host.install(
      definition("two", (ctx) => ctx.provide("value", 1, 2), {
        provides: { value: 1 },
      }),
    );
    await expect(host.start("two")).rejects.toThrow("already provided");
  });

  it("mounts framework-independent views and releases the mounted instance once", async () => {
    const host = new Host(platform());
    const unmount = vi.fn();
    host.install(
      definition("layout", (ctx) =>
        ctx.view({ id: "layout", label: "Layout", mount: () => unmount }),
      ),
    );
    await host.start("layout");
    const close = host.mountView("layout", {} as HTMLElement);
    await host.stop("layout");
    close();
    expect(unmount).toHaveBeenCalledOnce();
    expect(host.views()).toEqual([]);
  });

  it("loads a previously unknown ESM extension without a core edit", async () => {
    const code =
      'export default {manifest:{id:"external",version:"1.0.0",apiVersion:1,provides:{novel:1}},activate(ctx){ctx.provide("novel",1,"unknown")}}';
    const imported = await loadExtension(
      "data:text/javascript," + encodeURIComponent(code),
      "external",
    );
    const host = new Host(platform());
    host.install(imported);
    await host.start("external");
    expect(host.serviceNames()).toEqual(["novel"]);
  });

  it("rejects an identity mismatch with an otherwise compatible SDK version", async () => {
    const code =
      'export default {manifest:{id:"other",version:"1.0.0",apiVersion:1},activate(){}}';
    await expect(
      loadExtension(
        "data:text/javascript," + encodeURIComponent(code),
        "expected",
      ),
    ).rejects.toThrow("identity");
  });

  it("rejects an unsupported SDK version with a matching identity", async () => {
    const code =
      'export default {manifest:{id:"expected",version:"1.0.0",apiVersion:99},activate(){}}';
    await expect(
      loadExtension(
        "data:text/javascript," + encodeURIComponent(code),
        "expected",
      ),
    ).rejects.toThrow("SDK version");
  });

  it("diagnoses cycles without executing either activation", async () => {
    const host = new Host(platform());
    const activate = vi.fn();
    host.install(
      definition("a", activate, { requires: { b: 1 }, provides: { a: 1 } }),
    );
    host.install(
      definition("b", activate, { requires: { a: 1 }, provides: { b: 1 } }),
    );
    await host.start("a");
    await host.start("b");
    expect(host.inspect("a").error).toContain("cycle");
    expect(activate).not.toHaveBeenCalled();
  });

  it("rejects new registrations through a stale extension context", async () => {
    const host = new Host(platform());
    let context!: ExtensionContext;
    host.install(
      definition(
        "stale",
        (ctx) => {
          context = ctx;
        },
        { provides: { value: 1 } },
      ),
    );
    await host.start("stale");
    await host.stop("stale");
    expect(() => context.provide("value", 1, "late")).toThrow("stopped");
    expect(host.serviceNames()).toEqual([]);
  });
});
