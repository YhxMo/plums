import { expect, test } from "@playwright/test";

test("G5 routed page closes its input listeners and restores initiating focus", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/modules/sdk/index.ts";
    const { createPageRouter } = await import(path);
    const root = document.createElement("div");
    document.body.append(root);
    let keys = 0;
    const router = createPageRouter();
    await router.register({
      id: "list",
      route: "list",
      label: "List",
      priority: 0,
      node: {
        id: "list",
        mount(
          target: HTMLElement,
          scope: { onDispose: (fn: () => void) => void },
        ) {
          const button = document.createElement("button");
          button.dataset.pageFocus = "open-detail";
          button.textContent = "Open";
          target.append(button);
          const onKey = () => {
            keys++;
          };
          document.addEventListener("keydown", onKey);
          scope.onDispose(() => document.removeEventListener("keydown", onKey));
        },
      },
    });
    await router.register({
      id: "detail",
      route: "detail",
      label: "Detail",
      priority: 0,
      node: {
        id: "detail",
        mount: (target: HTMLElement) => {
          target.textContent = "Detail";
        },
      },
    });
    await router.mount(root);
    root.querySelector("button")!.focus();
    await router.navigate("detail");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    const afterLeave = keys;
    await router.back();
    const restored = (document.activeElement as HTMLElement)?.dataset.pageFocus;
    await router.close();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    root.remove();
    return { afterLeave, afterClose: keys, restored };
  });
  expect(result).toEqual({
    afterLeave: 0,
    afterClose: 0,
    restored: "open-detail",
  });
});

test("mounted nested page contributions release before conflict fallback and retain cleanup failures", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/modules/sdk/index.ts";
    const { createPageRouter } = await import(path);
    const root = document.createElement("div");
    document.body.append(root);
    const events: string[] = [];
    const router = createPageRouter();
    await router.register({
      id: "base",
      route: "list",
      label: "Base",
      priority: 0,
      node: {
        id: "base",
        mount(target: HTMLElement) {
          target.textContent = "Base";
        },
      },
    });
    await router.mount(root);
    const remove = await router.register({
      id: "addon",
      route: "list",
      label: "Addon",
      priority: 5,
      node: {
        id: "addon",
        async mount(
          target: HTMLElement,
          scope: {
            onDispose: (fn: () => void) => void;
            mount: (node: unknown, target: HTMLElement) => Promise<void>;
          },
        ) {
          const child = document.createElement("div");
          target.append(child);
          scope.onDispose(() => {
            events.push("parent");
            child.remove();
          });
          await scope.mount(
            {
              id: "nested",
              mount(
                target: HTMLElement,
                childScope: { onDispose: (fn: () => Promise<void>) => void },
              ) {
                target.textContent = "Nested";
                childScope.onDispose(async () => {
                  await Promise.resolve();
                  events.push("child");
                });
              },
            },
            child,
          );
        },
      },
    });
    const nested = root.textContent;
    await remove();
    const fallback = root.textContent;
    const sequence = [...events];
    await router.register({
      id: "broken",
      route: "broken",
      label: "Broken",
      priority: 0,
      node: {
        id: "broken",
        mount(
          target: HTMLElement,
          scope: { onDispose: (fn: () => void) => void },
        ) {
          target.textContent = "Broken cleanup";
          scope.onDispose(() => {
            throw Error("child cleanup failed");
          });
        },
      },
    });
    await router.navigate("broken");
    let rejected = false;
    try {
      await router.navigate("list");
    } catch {
      rejected = true;
    }
    const retained = root.textContent;
    await router.close().catch(() => {});
    root.remove();
    return { nested, fallback, sequence, rejected, retained };
  });
  expect(result).toEqual({
    nested: "Nested",
    fallback: "Base",
    sequence: ["child", "parent"],
    rejected: true,
    retained: "Broken cleanup",
  });
});

test("failed dynamic mount restores the previous contribution and its navigation snapshot", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/modules/sdk/index.ts";
    const { createPageRouter } = await import(path);
    const root = document.createElement("div");
    document.body.append(root);
    const router = createPageRouter();
    await router.register({
      id: "base",
      route: "list",
      label: "Base",
      priority: 0,
      node: {
        id: "base",
        mount(target: HTMLElement) {
          target.textContent = "Base";
        },
      },
    });
    await router.mount(root);
    await router
      .register({
        id: "bad",
        route: "list",
        label: "Bad",
        priority: 10,
        node: {
          id: "bad",
          mount() {
            throw Error("mount failed");
          },
        },
      })
      .catch(() => {});
    const snapshot = router.snapshot().entries[0].id;
    const restored = root.textContent;
    await router.close();
    root.remove();
    return { snapshot, restored };
  });
  expect(result).toEqual({ snapshot: "base", restored: "Base" });
});

test("closing interrupts a cooperative asynchronous page mount", async ({
  page,
}) => {
  await page.goto("/");
  const stopped = await page.evaluate(async () => {
    const path = "/modules/sdk/index.ts";
    const { createPageRouter } = await import(path);
    const root = document.createElement("div");
    document.body.append(root);
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const router = createPageRouter();
    await router.register({
      id: "slow",
      route: "slow",
      label: "Slow",
      priority: 0,
      node: {
        id: "slow",
        async mount(_target: HTMLElement, scope: { signal: AbortSignal }) {
          started();
          await new Promise<void>((resolve) =>
            scope.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        },
      },
    });
    const mounting = router.mount(root).catch(() => {});
    await ready;
    const closed = router.close();
    const result = await Promise.race([
      closed.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    if (result) await mounting;
    root.remove();
    return result;
  });
  expect(stopped).toBe(true);
});

test("detach requested before tree creation prevents a new asynchronous mount", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/modules/sdk/index.ts";
    const { createPageRouter } = await import(path);
    const root = document.createElement("div");
    document.body.append(root);
    let mounts = 0;
    const router = createPageRouter();
    await router.register({
      id: "slow",
      route: "slow",
      label: "Slow",
      priority: 0,
      node: {
        id: "slow",
        async mount(_target: HTMLElement, scope: { signal: AbortSignal }) {
          mounts++;
          await new Promise<void>((resolve) =>
            scope.signal.addEventListener("abort", () => resolve(), {
              once: true,
            }),
          );
        },
      },
    });
    const mounting = router.mount(root).catch(() => {});
    await Promise.resolve();
    const detached = router.detach();
    const finished = await Promise.race([
      detached.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
    ]);
    await router.close();
    await Promise.all([mounting, detached]);
    root.remove();
    return { finished, mounts };
  });
  expect(result).toEqual({ finished: true, mounts: 0 });
});
