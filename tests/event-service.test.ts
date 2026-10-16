import { expect, it } from "vitest";
import { runEventScenario } from "./event-service/scenario";
import type { Platform } from "../modules/sdk";
it("runs event work without business views through stop, revoke and restore", async () => {
  const grants = new Map<string, string[]>();
  let reads = 0;
  const platform: Platform = {
    kind: "browser",
    available: (c) => c === "state.read",
    async grant(owner, caps) {
      grants.set(owner, caps);
    },
    async call(owner, cap, _payload, signal) {
      signal?.throwIfAborted();
      if (!grants.get(owner)?.includes(cap)) throw Error("denied");
      reads++;
      return null;
    },
  };
  const report = await runEventScenario(platform);
  expect(report.passed).toBe(true);
  expect(report.checks).toHaveLength(8);
  expect(reads).toBe(5);
});

it("waits when capability is unavailable without activating or registering", async () => {
  const { Host } = await import("../modules/extension-host/host");
  const { createEventWorker } = await import("./fixtures/event-worker");
  const host = new Host({
    kind: "browser",
    available: () => false,
    async grant() {},
    async call() {
      throw Error("must not call");
    },
  });
  host.install(createEventWorker());
  await host.grant("event.worker", ["state.read"]);
  await host.start("event.worker");
  expect(host.inspect("event.worker")).toMatchObject({
    status: "waiting",
    resources: 0,
    tasks: 0,
  });
  expect(host.inspect("event.worker").error).toContain("unavailable");
  expect(host.views()).toEqual([]);
  await host.stop("event.worker");
});

it("reports a failed read and can process a later event without unhandled rejection", async () => {
  const { Host } = await import("../modules/extension-host/host");
  const { createEventWorker } = await import("./fixtures/event-worker");
  let fail = true;
  const receipts: unknown[] = [];
  let bus!: import("../modules/sdk").ExtensionContext;
  let worker!: import("./fixtures/event-worker").EventWorker;
  const host = new Host({
    kind: "browser",
    available: () => true,
    async grant() {},
    async call() {
      if (fail) throw Error("synthetic read failure");
      return null;
    },
  });
  host.install(createEventWorker());
  host.install({
    manifest: {
      id: "event.test",
      version: "1",
      apiVersion: 1,
      requires: { "event.worker": 1 },
    },
    activate(ctx) {
      bus = ctx;
      ctx.on("event.receipt", (receipt) => receipts.push(receipt));
      worker = ctx.use("event.worker");
    },
  });
  await host.grant("event.worker", ["state.read"]);
  await host.start("event.worker");
  await host.start("event.test");
  bus.emit("event.submit", { id: "failure" });
  await new Promise((r) => setTimeout(r, 0));
  expect(worker.inspect()).toMatchObject({ failed: 1, done: 0, busy: false });
  expect(receipts).toEqual([]);
  fail = false;
  bus.emit("event.submit", { id: "retry" });
  await new Promise((r) => setTimeout(r, 0));
  expect(worker.inspect()).toMatchObject({ failed: 1, done: 1, busy: false });
  await host.stop("event.worker");
  await host.stop("event.test");
});
