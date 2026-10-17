import { expect, test, vi } from "vitest";
import * as SDK from "../modules/sdk";
import { Host } from "../modules/extension-host/host";

const page = (id: string, route = id, priority = 0) => ({
  id,
  route,
  label: id,
  priority,
  node: { id, mount: () => {} },
});

test("G1 routes change and back returns to the previous extension page", async () => {
  const router = SDK.createPageRouter();
  await router.register(page("list"));
  await router.register(page("edit"));
  await router.navigate("edit");
  expect(router.snapshot().route).toBe("edit");
  await router.back();
  expect(router.snapshot().route).toBe("list");
  await router.close();
});

test("G2 unknown saved route is preserved; failed preference write keeps current page", async () => {
  const save = vi.fn(async () => {
    throw Error("write rejected");
  });
  const router = SDK.createPageRouter({ initialRoute: "missing", save });
  await router.register(page("list"));
  await router.register(page("edit"));
  expect(router.snapshot()).toMatchObject({
    route: "list",
    missing: "missing",
  });
  expect(save).not.toHaveBeenCalled();
  await expect(router.navigate("edit")).rejects.toThrow("write rejected");
  expect(router.snapshot().route).toBe("list");
  await router.close();
});

test("G3 any active extension can open public shell management; stale context rejects", async () => {
  const open = vi.fn(async () => {});
  const host = new Host({
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: async () => null,
  });
  host.connectShell({
    open,
    readPage: () => undefined,
    savePage: async () => {},
  });
  let context!: SDK.ExtensionContext;
  host.install({
    manifest: { id: "third.party", version: "1", apiVersion: 1 },
    activate: (ctx) => {
      context = ctx;
    },
  });
  await host.start("third.party");
  await context.shell.open("extensions");
  expect(open).toHaveBeenCalledWith("extensions", "third.party");
  await host.stop("third.party");
  await expect(context.shell.open("extensions")).rejects.toThrow(
    "Extension stopped",
  );
});

test("G3b readPage without a connected shell bridge reports no preference", async () => {
  const host = new Host({
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: async () => null,
  });
  let context!: SDK.ExtensionContext;
  host.install({
    manifest: { id: "third.party", version: "1", apiVersion: 1 },
    activate: (ctx) => {
      context = ctx;
    },
  });
  await host.start("third.party");
  expect(context.shell.readPage("view")).toBeUndefined();
  await expect(context.shell.savePage("view", "route")).rejects.toThrow(
    "Shell controls unavailable",
  );
  await expect(context.shell.open("settings")).rejects.toThrow(
    "Shell controls unavailable",
  );
  await host.stop("third.party");
});

test("G4 page contributions can be added and removed while running with deterministic conflict recovery", async () => {
  const router = SDK.createPageRouter();
  await router.register(page("base", "list", 0));
  const remove = await router.register(page("addon", "list", 10));
  expect(router.snapshot().entries[0].id).toBe("addon");
  expect(router.snapshot().conflicts).toHaveLength(1);
  await remove();
  expect(router.snapshot().entries[0].id).toBe("base");
  expect(router.snapshot().conflicts).toHaveLength(0);
  await router.close();
});

test("G6 navigation waits for in-flight operation cancellation before saving the next page", async () => {
  let release!: () => void;
  const beforeLeave = vi
    .fn(async () => {})
    .mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
  const save = vi.fn(async () => {});
  const router = SDK.createPageRouter({ beforeLeave, save });
  await router.register(page("list"));
  await router.register(page("edit"));
  const pending = router.navigate("edit");
  await vi.waitFor(() => expect(beforeLeave).toHaveBeenCalled());
  expect(save).not.toHaveBeenCalled();
  expect(router.snapshot().route).toBe("list");
  release();
  await pending;
  expect(save).toHaveBeenCalledWith("edit");
  expect(router.snapshot().route).toBe("edit");
  await router.close();
});

test("explicitly selecting a fallback page replaces the missing preference; closed back rejects", async () => {
  const save = vi.fn(async () => {});
  const router = SDK.createPageRouter({ initialRoute: "removed", save });
  await router.register(page("list"));
  await router.navigate("list");
  expect(save).toHaveBeenCalledWith("list");
  expect(router.snapshot().missing).toBeUndefined();
  await router.close();
  await expect(router.back()).rejects.toThrow("closed");
});

test("extension lifetime abort synchronously closes page registration and navigation", async () => {
  const lifetime = new AbortController();
  const router = SDK.createPageRouter({ signal: lifetime.signal });
  await router.register(page("list"));
  lifetime.abort();
  await expect(router.register(page("late"))).rejects.toThrow("closed");
  await expect(router.navigate("list")).rejects.toThrow("closed");
  await router.close();
});
