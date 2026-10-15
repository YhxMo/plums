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
  call: async () => null,
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  asyncUnmount: boolean,
  consumerCleanup?: "reject" | "timeout",
) {
  const host = new Host(platform, 40);
  const contexts = new Map<string, ExtensionContext>();
  const disposed = new Set<string>();
  const unmounted = new Set<string>();
  const activations = new Map<string, number>();
  let calls = 0,
    releases = 0;
  host.install(
    definition(
      "provider",
      (ctx) => {
        contexts.set(ctx.id, ctx);
        ctx.provide("source", 1, () => {
          calls++;
        });
        ctx.view({
          id: "provider",
          label: "Provider",
          mount: () => () => {
            releases++;
            if (asyncUnmount)
              return Promise.reject(new Error("provider release failed"));
            throw new Error("provider release failed");
          },
        });
      },
      { provides: { source: 1 } },
    ),
  );
  for (const id of ["middle", "leaf", "sibling"]) {
    const dependency = id === "leaf" ? "relay" : "source";
    host.install(
      definition(
        id,
        (ctx) => {
          contexts.set(id, ctx);
          activations.set(id, (activations.get(id) ?? 0) + 1);
          const service = ctx.use<() => void>(dependency);
          if (id === "middle") ctx.provide("relay", 1, service);
          ctx.on("tick", service);
          void ctx.task(
            (signal) =>
              new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else
                  signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  });
              }),
          );
          ctx.view({
            id,
            label: id,
            mount: () => () => {
              unmounted.add(id);
            },
          });
          ctx.onDispose(() => {
            disposed.add(id);
            if (id === "middle" && consumerCleanup === "reject")
              return Promise.reject(new Error("consumer release failed"));
            if (id === "middle" && consumerCleanup === "timeout")
              return new Promise<void>(() => {});
          });
        },
        {
          requires: { [dependency]: 1 },
          ...(id === "middle" ? { provides: { relay: 1 } } : {}),
        },
      ),
    );
  }
  host.install(
    definition("emitter", (ctx) => {
      contexts.set(ctx.id, ctx);
    }),
  );
  for (const id of ["leaf", "middle", "sibling", "provider", "emitter"])
    await host.start(id);
  const close = host.mountView("provider", {} as HTMLElement);
  for (const id of ["middle", "leaf", "sibling"])
    host.mountView(id, {} as HTMLElement);
  return {
    host,
    contexts,
    disposed,
    unmounted,
    activations,
    close,
    calls: () => calls,
    releases: () => releases,
  };
}

it.each([false, true])(
  "invalidates the complete dependency chain before queued cleanup (async unmount: %s)",
  async (asyncUnmount) => {
    const f = await fixture(asyncUnmount);
    const entered = deferred(),
      gate = deferred();
    f.host.install(
      definition("blocker", async () => {
        entered.resolve();
        await gate.promise;
      }),
    );
    const blocking = f.host.start("blocker");
    await entered.promise;
    try {
      if (asyncUnmount)
        await expect(Promise.resolve(f.close())).rejects.toThrow(
          "provider release failed",
        );
      else expect(f.close).toThrow("provider release failed");
      const immediate = ["middle", "leaf", "sibling"].map((id) => ({
        id,
        aborted: f.contexts.get(id)!.signal.aborted,
        status: f.host.inspect(id).status,
      }));
      f.contexts.get("emitter")!.emit("tick", null);
      const immediateCalls = f.calls();
      let taskRejected = false,
        mountRejected = false;
      try {
        f.contexts.get("leaf")!.task(async () => {});
      } catch {
        taskRejected = true;
      }
      try {
        f.host.mountView("leaf", {} as HTMLElement);
      } catch {
        mountRejected = true;
      }
      gate.resolve();
      await blocking;
      await f.host.start("emitter");
      f.contexts.get("emitter")!.emit("tick", null);
      expect(
        immediate.every((item) => item.aborted && item.status !== "active"),
      ).toBe(true);
      expect(immediateCalls).toBe(0);
      expect(taskRejected).toBe(true);
      expect(mountRejected).toBe(true);
      for (const id of ["middle", "leaf", "sibling"]) {
        expect(f.host.inspect(id)).toMatchObject({
          status: "waiting",
          resources: 0,
          tasks: 0,
        });
        expect(f.disposed.has(id)).toBe(true);
        expect(f.unmounted.has(id)).toBe(true);
      }
      expect(f.calls()).toBe(0);
      expect(f.host.views()).toEqual([]);
      expect(f.host.inspect("provider").status).toBe("cleanup-failed");
      await expect(f.host.stop("provider")).rejects.toThrow(
        "provider release failed",
      );
      await expect(f.host.start("provider")).rejects.toThrow("restart");
      expect(f.releases()).toBe(1);
    } finally {
      gate.resolve();
      await blocking;
      await f.host.stop("provider").catch(() => {});
    }
  },
);

it.each(["reject", "timeout"] as const)(
  "preserves failed consumer cleanup and never revives its downstream chain (%s)",
  async (cleanup) => {
    const f = await fixture(false, cleanup);
    try {
      expect(f.close).toThrow("provider release failed");
      await f.host.start("emitter");
      for (const id of ["middle", "leaf", "sibling"])
        expect(f.contexts.get(id)!.signal.aborted).toBe(true);
      expect(f.host.inspect("middle").status).toBe("cleanup-failed");
      expect(f.host.inspect("middle").error).toMatch(
        cleanup === "reject" ? /consumer release failed/ : /timeout/,
      );
      expect(f.host.inspect("leaf")).toMatchObject({
        status: "waiting",
        resources: 0,
        tasks: 0,
      });
      expect(f.host.inspect("sibling")).toMatchObject({
        status: "waiting",
        resources: 0,
        tasks: 0,
      });
      f.contexts.get("emitter")!.emit("tick", null);
      expect(f.calls()).toBe(0);
      f.host.install(
        definition("replacement", (ctx) => ctx.provide("source", 1, () => {}), {
          provides: { source: 1 },
        }),
      );
      await f.host.start("replacement");
      expect(f.host.inspect("provider").status).toBe("cleanup-failed");
      expect(f.host.inspect("middle").status).toBe("cleanup-failed");
      expect(f.host.inspect("leaf").status).toBe("waiting");
      expect(f.host.inspect("sibling").status).toBe("active");
      expect(f.activations.get("middle")).toBe(1);
      expect(f.activations.get("leaf")).toBe(1);
      await expect(f.host.start("middle")).rejects.toThrow("restart");
      await expect(f.host.stop("provider")).rejects.toThrow();
      expect(f.releases()).toBe(1);
    } finally {
      await f.host.stop("provider").catch(() => {});
      if (f.host.ids().includes("replacement"))
        await f.host.stop("replacement").catch(() => {});
    }
  },
);
