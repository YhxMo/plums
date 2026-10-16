import assert from "node:assert/strict";
import { test } from "vitest";
import type {
  AuthorContext,
  Dispose,
  PageContribution,
} from "../extensions/examples/local-proof-types.js";
import {
  analyzeText,
  createTextService,
} from "../extensions/examples/local-text-node.js";
import { createPageManager } from "../extensions/examples/local-proof-pages.js";

function context() {
  const controller = new AbortController();
  const disposers: Dispose[] = [];
  const ctx: AuthorContext = {
    id: "example.author-test",
    signal: controller.signal,
    onDispose(dispose) {
      disposers.push(dispose);
    },
    use() {
      throw Error("unexpected service access");
    },
    provide() {
      throw Error("unexpected service publication");
    },
  };
  return {
    controller,
    disposers,
    ctx,
  };
}
const nodeFor = (spec: { id: string }) => ({
  id: `${spec.id}.test`,
  mount() {},
});

// This is a public page-register contract double, not a Host or router emulator.
function registrationFixture() {
  const owner = context();
  const entries = new Map<string, PageContribution>();
  const removed: string[] = [];
  const pages = {
    async register(contribution: PageContribution) {
      assert.equal(
        entries.has(contribution.id),
        false,
        "duplicate page registration",
      );
      entries.set(contribution.id, contribution);
      return async () => {
        entries.delete(contribution.id);
        removed.push(contribution.id);
      };
    },
  };
  const manager = createPageManager(owner.ctx, pages, nodeFor);
  return { ...owner, entries, removed, pages, manager };
}

test("sample, emoji, paragraphs and line-numbered findings", () => {
  assert.deepEqual(analyzeText("你好 A😀\nTODO  \n\n待补"), {
    codePoints: 16,
    nonWhitespace: 10,
    nonEmptyLines: 3,
    paragraphs: 2,
    issues: [
      { line: 2, kind: "trailing", message: "行尾有空格或制表符" },
      { line: 2, kind: "placeholder", message: "含 TODO / TBD / 待补标记" },
      { line: 4, kind: "placeholder", message: "含 TODO / TBD / 待补标记" },
    ],
  });
  assert.equal(analyzeText("").paragraphs, 0);
  assert.equal(analyzeText(" \t\r\n\r\n").nonEmptyLines, 0);
  assert.equal(
    analyzeText("one\r\none\r\n\r\none").issues.filter(
      (issue) => issue.kind === "duplicate",
    ).length,
    1,
  );
  assert.equal(analyzeText("<img src=x onerror=alert(1)>").issues.length, 0);
});

test("service rejects use after disposal and exposes a fixed node contract", () => {
  const owner = context();
  const service = createTextService(owner.ctx);
  assert.equal(service.createNode("editor").id, "example.local-text.editor");
  assert.deepEqual(service.diagnostics(), {
    mounts: 0,
    disposals: 0,
    activeNodes: 0,
    subscriptions: 0,
  });
  owner.disposers[0]();
  assert.throws(() => service.createNode("editor"), /已停止/);
});

test("repeated rapid adds serialize and dynamically remove without duplicate IDs", async () => {
  const f = registrationFixture();
  await f.manager.add("main");
  await Promise.all([
    f.manager.add("z"),
    f.manager.add("z"),
    f.manager.add("a"),
    f.manager.add("priority"),
  ]);
  assert.equal(f.entries.size, 4);
  assert.equal(f.manager.snapshot().busy, false);
  assert.equal(f.entries.get("example.local-proof.priority")!.priority, 10);
  assert.equal(
    f.entries.get("example.local-proof.z")!.route,
    "local-proof-review",
  );
  assert.equal(
    f.entries.get("example.local-proof.a")!.route,
    "local-proof-review",
  );
  await f.manager.remove("priority");
  await f.manager.remove("a");
  await f.manager.remove("z");
  assert.equal(f.entries.size, 1);
  await f.manager.add("z");
  await f.manager.close();
  assert.equal(f.entries.size, 0);
  await assert.rejects(f.manager.add("z"), /已停止/);
});

test("disposal waits for a dispatched register, then removes its late handle", async () => {
  const owner = context();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let removed = 0;
  const manager = createPageManager(
    owner.ctx,
    {
      async register() {
        await gate;
        return async () => {
          removed++;
        };
      },
    },
    nodeFor,
  );
  const pending = manager.add("main");
  await Promise.resolve(); // enter the dispatched register
  owner.controller.abort();
  const closing = owner.disposers[0]();
  release();
  await pending;
  await closing;
  assert.equal(removed, 1);
});

test("registration error is visible and retry succeeds", async () => {
  const f = registrationFixture();
  const register = f.pages.register;
  f.pages.register = async () => {
    throw Error("contract refusal");
  };
  await assert.rejects(f.manager.add("main"), /contract refusal/);
  assert.match(f.manager.snapshot().error, /contract refusal/);
  assert.equal(f.entries.size, 0);
  f.pages.register = register;
  await f.manager.add("main");
  assert.equal(f.manager.snapshot().error, "");
  await f.manager.close();
});

test("all removals are attempted; cleanup rejection is retained", async () => {
  const owner = context();
  const attempted: string[] = [];
  const manager = createPageManager(
    owner.ctx,
    {
      async register(page) {
        return async () => {
          attempted.push(page.id);
          if (page.id.endsWith(".a")) throw Error("cleanup refusal");
        };
      },
    },
    nodeFor,
  );
  await manager.add("main");
  await manager.add("a");
  const closing = manager.close();
  assert.equal(manager.close(), closing);
  await assert.rejects(closing, /页面贡献清理失败/);
  assert.equal(attempted.length, 2);
});

test("failed UI removal remains failed at shutdown without retrying its disposer", async () => {
  const owner = context();
  let attempts = 0;
  const manager = createPageManager(
    owner.ctx,
    {
      async register() {
        return async () => {
          attempts++;
          throw Error("failed disposal");
        };
      },
    },
    nodeFor,
  );
  await manager.add("main");
  await assert.rejects(manager.remove("main"), /failed disposal/);
  assert.equal(manager.snapshot().blocked, true);
  await assert.rejects(manager.add("a"), /failed disposal/);
  await assert.rejects(manager.close(), /页面贡献清理失败/);
  assert.equal(attempts, 1);
});
