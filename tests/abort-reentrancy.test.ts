import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
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
  manifest: { id, version: "1", apiVersion: 1, ...extra },
  activate,
});
const platform: Platform = {
  kind: "browser",
  available: () => true,
  grant: async () => {},
  call: async () => ({ ok: true }),
};
const rootView = (ctx: ExtensionContext) =>
  ctx.view({
    id: "root",
    label: "Root",
    mount: () => () => {
      throw new Error("root release failed");
    },
  });

it("blocks the reviewed synchronous cancellation notice through a healthy event service", async () => {
  const host = new Host(platform);
  let calls = 0,
    notifications = 0,
    disposed = false;
  let consumer!: ExtensionContext;
  host.install(
    definition(
      "bus",
      (ctx) =>
        ctx.provide("bus", 1, () => {
          notifications++;
          ctx.emit("tick", null);
        }),
      { provides: { bus: 1 } },
    ),
  );
  host.install(
    definition(
      "root",
      (ctx) => {
        const notify = ctx.use<() => void>("bus");
        ctx.signal.addEventListener("abort", notify, { once: true });
        ctx.provide("source", 1, () => {
          calls++;
        });
        rootView(ctx);
      },
      { requires: { bus: 1 }, provides: { source: 1 } },
    ),
  );
  host.install(
    definition(
      "consumer",
      (ctx) => {
        consumer = ctx;
        ctx.on("tick", ctx.use<() => void>("source"));
        ctx.onDispose(() => {
          disposed = true;
        });
      },
      { requires: { source: 1 } },
    ),
  );
  for (const id of ["bus", "root", "consumer"]) await host.start(id);
  try {
    expect(host.mountView("root", {} as HTMLElement)).toThrow(
      "root release failed",
    );
    await host.start("bus");
    expect(notifications).toBe(1);
    expect(calls).toBe(0);
    expect(consumer.signal.aborted).toBe(true);
    expect(disposed).toBe(true);
    expect(host.inspect("consumer").status).toBe("waiting");
    expect(host.inspect("root").status).toBe("cleanup-failed");
    expect(host.inspect("bus").status).toBe("active");
  } finally {
    await host.stop("bus").catch(() => {});
  }
});

for (const action of ["release-failure", "stop", "revoke"] as const)
  it(`closes a diamond graph before ${action} abort notices and all SDK entry attempts`, async () => {
    let platformCalls = 0,
      serviceCalls = 0,
      notifications = 0,
      probes = 0,
      taskBodies = 0;
    const host = new Host({
      ...platform,
      call: async () => {
        platformCalls++;
        return null;
      },
    });
    const contexts = new Map<string, ExtensionContext>();
    const attempts: {
      id: string;
      signalAborted: boolean;
      rejected: boolean[];
    }[] = [];
    const platformResults: Promise<unknown>[] = [];
    const submittedTasks: Promise<unknown>[] = [];
    let invalidating = false;
    let notify!: () => void;
    const rejected = (run: () => unknown) => {
      try {
        run();
        return false;
      } catch (error) {
        return error instanceof Error && error.message === "Extension stopped";
      }
    };
    host.install(
      definition(
        "bus",
        (ctx) => {
          notify = () => {
            notifications++;
            ctx.emit("tick", null);
          };
          ctx.provide("bus", 1, notify);
          ctx.on("probe", () => {
            probes++;
          });
          ctx.on("tick", () => {
            if (!invalidating) return;
            for (const [id, target] of contexts) {
              const signalAborted = target.signal.aborted;
              const denied = [
                rejected(() => target.use("bus")),
                rejected(() => target.provide(`late.${id}`, 1, {})),
                rejected(() => target.onDispose(() => {})),
                rejected(() => target.on("late", () => {})),
                rejected(() =>
                  target.view({
                    id: `late.${id}`,
                    label: id,
                    mount: () => () => {},
                  }),
                ),
                rejected(() => {
                  const task = target.task(async () => {
                    taskBodies++;
                  });
                  void task.catch(() => {});
                  submittedTasks.push(task);
                }),
              ];
              target.emit("probe", null);
              const call = target.platform("platform.info");
              void call.catch(() => {});
              platformResults.push(call);
              attempts.push({ id, signalAborted, rejected: denied });
            }
          });
        },
        { provides: { bus: 1 } },
      ),
    );
    for (const id of ["root", "left", "right", "joint"]) {
      const requires = {
        bus: 1,
        ...(id === "root"
          ? {}
          : id === "joint"
            ? { left: 1, right: 1 }
            : { source: 1 }),
      };
      const provides = {
        [`late.${id}`]: 1,
        ...(id === "root" ? { source: 1 } : id === "joint" ? {} : { [id]: 1 }),
      };
      host.install(
        definition(
          id,
          (ctx) => {
            contexts.set(id, ctx);
            const service =
              id === "root"
                ? () => {
                    serviceCalls++;
                  }
                : ctx.use<() => void>(id === "joint" ? "left" : "source");
            if (id !== "joint")
              ctx.provide(id === "root" ? "source" : id, 1, service);
            ctx.on("tick", () => service());
            const publish = ctx.use<() => void>("bus");
            ctx.signal.addEventListener("abort", publish, { once: true });
            if (id === "root") rootView(ctx);
          },
          { requires, provides, capabilities: ["platform.info"] },
        ),
      );
    }
    await host.start("bus");
    for (const id of ["root", "left", "right", "joint"]) {
      await host.grant(id, ["platform.info"]);
      await host.start(id);
    }
    notify();
    expect(serviceCalls).toBe(4);
    serviceCalls = 0;
    notifications = 0;
    invalidating = true;
    try {
      if (action === "release-failure")
        expect(host.mountView("root", {} as HTMLElement)).toThrow(
          "root release failed",
        );
      else if (action === "stop") await host.stop("root");
      else await host.grant("root", []);
      await host.start("bus");
      const results = await Promise.allSettled(platformResults);
      await Promise.allSettled(submittedTasks);
      expect(notifications).toBe(4);
      expect(attempts.some((attempt) => !attempt.signalAborted)).toBe(true);
      expect(serviceCalls).toBe(0);
      expect(attempts.every((attempt) => attempt.rejected.every(Boolean))).toBe(
        true,
      );
      expect(probes).toBe(0);
      expect(taskBodies).toBe(0);
      expect(platformCalls).toBe(0);
      expect(results.every((result) => result.status === "rejected")).toBe(
        true,
      );
      for (const id of ["left", "right", "joint"]) {
        expect(contexts.get(id)!.signal.aborted).toBe(true);
        expect(host.inspect(id)).toMatchObject({
          status: "waiting",
          resources: 0,
          tasks: 0,
        });
      }
      expect(host.inspect("root").status).toBe(
        action === "release-failure"
          ? "cleanup-failed"
          : action === "stop"
            ? "disabled"
            : "waiting",
      );
      expect(host.inspect("bus").status).toBe("active");
    } finally {
      await host.stop("bus").catch(() => {});
    }
  });

it("does not enter a queued task body after its scope was invalidated synchronously", async () => {
  const host = new Host(platform);
  let notify!: () => void, close!: () => void | Promise<void>;
  let task!: Promise<unknown>,
    taskBodies = 0;
  host.install(
    definition("bus", (ctx) => {
      notify = () => ctx.emit("queue", null);
    }),
  );
  host.install(
    definition(
      "root",
      (ctx) => {
        ctx.provide("source", 1, {});
        rootView(ctx);
      },
      { provides: { source: 1 } },
    ),
  );
  host.install(
    definition(
      "consumer",
      (ctx) => {
        ctx.on("queue", () => {
          task = ctx.task(async () => {
            taskBodies++;
          });
          void task.catch(() => {});
          try {
            close();
          } catch {
            /* Expected fixture release failure. */
          }
        });
      },
      { requires: { source: 1 } },
    ),
  );
  for (const id of ["bus", "root", "consumer"]) await host.start(id);
  close = host.mountView("root", {} as HTMLElement);
  try {
    notify();
    await expect(task).rejects.toThrow("Extension stopped");
    await host.start("bus");
    expect(taskBodies).toBe(0);
    expect(host.inspect("consumer")).toMatchObject({
      status: "waiting",
      resources: 0,
      tasks: 0,
    });
  } finally {
    await host.stop("root").catch(() => {});
  }
});

it("allows legitimate SDK work and event delivery during activation", async () => {
  const host = new Host(platform);
  let received = 0,
    ran = 0;
  host.install(
    definition("bus", (ctx) => ctx.provide("bus", 1, {}), {
      provides: { bus: 1 },
    }),
  );
  host.install(
    definition(
      "activation",
      async (ctx) => {
        expect(host.inspect("activation").status).not.toBe("active");
        expect(ctx.use("bus")).toEqual({});
        ctx.on("ready", () => {
          received++;
        });
        ctx.emit("ready", null);
        ctx.provide("result", 1, {});
        ctx.view({
          id: "activation",
          label: "Activation",
          mount: () => () => {},
        });
        await ctx.task(async () => {
          ran++;
        });
        await expect(ctx.platform("platform.info")).resolves.toEqual({
          ok: true,
        });
      },
      {
        requires: { bus: 1 },
        provides: { result: 1 },
        capabilities: ["platform.info"],
      },
    ),
  );
  await host.start("bus");
  await host.grant("activation", ["platform.info"]);
  await host.start("activation");
  expect(received).toBe(1);
  expect(ran).toBe(1);
  expect(host.inspect("activation").status).toBe("active");
  await host.stop("bus");
});

for (const action of ["stop", "revoke"] as const) {
  it(`closes the whole graph before ${action} notices and asynchronous cleanup`, async () => {
    const host = new Host(platform);
    let notify!: () => void;
    let calls = 0;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    host.install(
      definition("notifier", (ctx) => {
        notify = () => ctx.emit("tick", null);
      }),
    );
    host.install(
      definition(
        "root",
        (ctx) => {
          ctx.provide("source", 1, {});
        },
        { provides: { source: 1 }, capabilities: ["platform.info"] },
      ),
    );
    for (const id of ["left", "right"]) {
      host.install(
        definition(
          id,
          (ctx) => {
            ctx.use("source");
            ctx.on("tick", () => {
              calls++;
            });
            ctx.signal.addEventListener("abort", notify, { once: true });
            if (id === "left")
              ctx.onDispose(async () => {
                entered();
                await held;
              });
          },
          { requires: { source: 1 } },
        ),
      );
    }
    await host.start("notifier");
    await host.grant("root", ["platform.info"]);
    for (const id of ["root", "left", "right"]) await host.start(id);
    notify();
    expect(calls).toBe(2);
    calls = 0;
    const stopping =
      action === "stop" ? host.stop("root") : host.grant("root", []);
    try {
      await entering;
      notify();
      expect(calls).toBe(0);
      expect(host.inspect("right").status).toBe("stopping");
    } finally {
      release();
      await stopping;
      await host.stop("notifier");
    }
    for (const id of ["left", "right"])
      expect(host.inspect(id)).toMatchObject({
        status: "waiting",
        resources: 0,
        tasks: 0,
      });
    await host.grant("root", ["platform.info"]);
    await host.start("root");
    expect(host.inspect("right").status).toBe("active");
    await host.stop("root");
  });
}
