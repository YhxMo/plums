import { expect, test } from "vitest";
import { mountViewTree, type ViewNode } from "../modules/sdk/view-tree";
function root(parent?: HTMLElement) {
  const children = new Set<HTMLElement>();
  const value = {
    contains: (child: HTMLElement) => children.has(child),
    children,
  } as unknown as HTMLElement;
  if (parent)
    (parent as unknown as { children: Set<HTMLElement> }).children.add(value);
  return value;
}
test("nested mounts ready and reverse cleanup", async () => {
  const r = root();
  const child = root(r);
  const log: string[] = [];
  const tree = mountViewTree(r, {
    id: "parent",
    async mount(_r, s) {
      s.onDispose(() => {
        log.push("parent");
      });
      await s.mount(
        {
          id: "child",
          mount(_r, c) {
            c.onDispose(() => {
              log.push("child");
            });
          },
        },
        child,
      );
    },
  });
  await tree.ready;
  await tree.close();
  await tree.close();
  expect(log).toEqual(["child", "parent"]);
});
test("cycle and outside roots reject and release prior effects", async () => {
  for (const outside of [false, true]) {
    const r = root();
    const c = outside ? root() : root(r);
    let closed = 0;
    const tree = mountViewTree(r, {
      id: "same",
      async mount(_r, s) {
        s.onDispose(() => {
          closed++;
        });
        await s.mount({ id: "same", mount() {} }, c);
      },
    });
    await expect(tree.ready).rejects.toThrow(outside ? "outside" : "cycle");
    await tree.close();
    expect(closed).toBe(1);
  }
});
test("occupied roots conflict without cleaning existing tree", async () => {
  const r = root();
  let n = 0;
  const a = mountViewTree(r, {
    id: "a",
    mount(_r, s) {
      s.onDispose(() => {
        n++;
      });
    },
  });
  await a.ready;
  const b = mountViewTree(r, { id: "b", mount() {} });
  await expect(b.ready).rejects.toThrow("conflict");
  expect(n).toBe(0);
  await a.close();
  const c = mountViewTree(r, { id: "c", mount() {} });
  await c.ready;
  await c.close();
});
test("unawaited child failure is observed and cleaned before ready rejects", async () => {
  const r = root(),
    c = root(r);
  let cleaned = false;
  const tree = mountViewTree(r, {
    id: "p",
    mount(_r, s) {
      void s.mount(
        {
          id: "c",
          mount(_r, s) {
            s.onDispose(async () => {
              await Promise.resolve();
              cleaned = true;
            });
            throw Error("mount failed");
          },
        },
        c,
      );
    },
  });
  await expect(tree.ready).rejects.toThrow("mount failed");
  expect(cleaned).toBe(true);
  await tree.close();
});
test("cleanup failure stays latched and never retries effects", async () => {
  const r = root();
  let n = 0;
  const tree = mountViewTree(r, {
    id: "p",
    mount(_r, s) {
      s.onDispose(() => {
        n++;
        throw Error("release");
      });
    },
  });
  await tree.ready;
  await expect(tree.close()).rejects.toThrow("cleanup failed");
  await expect(tree.close()).rejects.toThrow("cleanup failed");
  expect(n).toBe(1);
  const conflict = mountViewTree(r, { id: "x", mount() {} });
  await expect(conflict.ready).rejects.toThrow("conflict");
});
test("closing during mount allows late cleanup registration, blocks new child and readiness", async () => {
  const r = root();
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  let cleaned = false;
  let childRejected = false;
  const tree = mountViewTree(r, {
    id: "p",
    async mount(_r, s) {
      entered();
      await new Promise<void>((r) =>
        s.signal.addEventListener("abort", () => r(), { once: true }),
      );
      s.onDispose(() => {
        cleaned = true;
      });
      try {
        await s.mount({ id: "c", mount() {} }, root(r));
      } catch {
        childRejected = true;
      }
    },
  });
  const readiness = expect(tree.ready).rejects.toThrow("closed");
  await started;
  await tree.close();
  await readiness;
  expect(cleaned && childRejected).toBe(true);
});
test("abort handler can close reentrantly without duplicate disposal", async () => {
  const r = root();
  let n = 0;
  const tree = mountViewTree(r, {
    id: "p",
    mount(_r, s) {
      s.onDispose(() => {
        n++;
      });
      s.signal.addEventListener("abort", () => {
        void tree.close();
      });
    },
  });
  await tree.ready;
  await tree.close();
  expect(n).toBe(1);
});

test("parent failure aborts unawaited waiting child before rollback", async () => {
  const r = root(),
    c = root(r);
  let disposed = false;
  const tree = mountViewTree(r, {
    id: "p",
    async mount(_r, s) {
      void s.mount(
        {
          id: "c",
          async mount(_r, t) {
            t.onDispose(() => {
              disposed = true;
            });
            await new Promise<void>((resolve) =>
              t.signal.addEventListener("abort", () => resolve(), {
                once: true,
              }),
            );
          },
        },
        c,
      );
      await Promise.resolve();
      throw Error("parent");
    },
  });
  await expect(tree.ready).rejects.toThrow("parent");
  expect(disposed).toBe(true);
  await tree.close();
});
test("scope retained after mount completion cannot create untracked children", async () => {
  const r = root();
  let saved!: import("../modules/sdk/view-tree").ViewTreeScope;
  const tree = mountViewTree(r, {
    id: "p",
    mount(_r, s) {
      saved = s;
    },
  });
  await tree.ready;
  expect(() => saved.mount({ id: "c", mount() {} }, root(r))).toThrow(
    "registration closed",
  );
  await tree.close();
});
