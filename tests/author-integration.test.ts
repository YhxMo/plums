import { describe, expect, it } from "vitest";
import { Host, loadExtension } from "../modules/extension-host/host";
import type {
  ExtensionContext,
  ExtensionDefinition,
  Platform,
} from "../modules/sdk";

const id = "author.batch-ledger";
const moduleUrl = new URL("./fixtures/author-batch-ledger.mjs", import.meta.url)
  .href;
type Snapshot = { total: number; accepted: number };

function fixture() {
  const platform: Platform = {
    kind: "browser",
    available: () => false,
    async grant() {},
    async call() {
      throw new Error("The author probe must not call platform capabilities");
    },
  };
  const host = new Host(platform);
  const receipts: unknown[] = [];
  let bus: ExtensionContext | undefined;
  let ledger: { snapshot(): Snapshot } | undefined;
  const pricing: ExtensionDefinition = {
    manifest: {
      id: "author.pricing",
      version: "1",
      apiVersion: 1,
      provides: { "author.unit-price": 1 },
    },
    activate(ctx) {
      ctx.provide("author.unit-price", 1, {
        price: (sku: string) => (sku === "plum" ? 7 : -1),
      });
    },
  };
  host.install({
    manifest: { id: "author.bus", version: "1", apiVersion: 1 },
    activate(ctx) {
      bus = ctx;
      ctx.on("author.batch-receipt", (receipt) => receipts.push(receipt));
      ctx.onDispose(() => {
        bus = undefined;
      });
    },
  });
  host.install({
    manifest: {
      id: "author.reader",
      version: "1",
      apiVersion: 1,
      requires: { "author.batch-total": 1 },
    },
    activate(ctx) {
      ledger = ctx.use("author.batch-total");
      ctx.onDispose(() => {
        ledger = undefined;
      });
    },
  });
  return {
    host,
    pricing,
    receipts,
    submit: (payload: unknown) => bus!.emit("author.batch-submit", payload),
    snapshot: () => ledger?.snapshot(),
  };
}

describe("independent public SDK author integration", () => {
  it("reports missing dependency and recovers when the declared provider starts", async () => {
    const f = fixture();
    try {
      f.host.install(await loadExtension(moduleUrl, id));
      await f.host.start(id);
      expect(f.host.inspect(id).status).toBe("waiting");
      expect(f.host.inspect(id).error).toContain("author.unit-price");
      expect(f.host.inspect(id).resources).toBe(0);
      expect(f.host.serviceNames()).not.toContain("author.batch-total");
      f.host.install(f.pricing);
      await f.host.start("author.pricing");
      expect(f.host.inspect(id).status).toBe("active");
      expect(f.host.serviceNames()).toContain("author.batch-total");
    } finally {
      for (const installed of f.host.ids().reverse())
        await f.host.stop(installed);
    }
  });

  it("runs new business contracts, releases registrations, restarts fresh and uninstalls", async () => {
    const f = fixture();
    try {
      f.host.install(await loadExtension(moduleUrl, id));
      expect(f.host.inspect(id).status).toBe("disabled");
      f.host.install(f.pricing);
      await f.host.start("author.pricing");
      await f.host.start("author.bus");
      await f.host.start(id);
      await f.host.start("author.reader");
      expect(f.snapshot()).toEqual({ total: 0, accepted: 0 });
      f.submit({ sku: "plum", quantity: 3 });
      f.submit({ sku: "plum", quantity: 2 });
      expect(f.snapshot()).toEqual({ total: 35, accepted: 2 });
      expect(f.receipts).toEqual([
        { sku: "plum", subtotal: 21, total: 21, accepted: 1 },
        { sku: "plum", subtotal: 14, total: 35, accepted: 2 },
      ]);
      for (const invalid of [
        null,
        { sku: "plum", quantity: -1 },
        { sku: "plum", quantity: 1.5 },
        { sku: "unknown", quantity: 1 },
        { sku: "plum", quantity: Number.MAX_SAFE_INTEGER },
      ])
        f.submit(invalid);
      expect(f.receipts).toHaveLength(2);
      expect(f.snapshot()).toEqual({ total: 35, accepted: 2 });

      await f.host.stop(id);
      expect(f.host.inspect(id)).toMatchObject({
        status: "disabled",
        resources: 0,
        tasks: 0,
      });
      expect(f.host.serviceNames()).not.toContain("author.batch-total");
      expect(f.host.inspect("author.reader").status).toBe("waiting");
      expect(f.snapshot()).toBeUndefined();
      f.submit({ sku: "plum", quantity: 10 });
      expect(f.receipts).toHaveLength(2);

      await f.host.start(id);
      expect(f.host.inspect(id).status).toBe("active");
      expect(f.snapshot()).toEqual({ total: 0, accepted: 0 });
      f.submit({ sku: "plum", quantity: 4 });
      expect(f.receipts).toHaveLength(3);
      expect(f.snapshot()).toEqual({ total: 28, accepted: 1 });

      await f.host.stop(id);
      await f.host.uninstall(id);
      expect(f.host.ids()).not.toContain(id);
      expect(() => f.host.inspect(id)).toThrow();
      expect(f.host.serviceNames()).not.toContain("author.batch-total");
      f.submit({ sku: "plum", quantity: 1 });
      expect(f.receipts).toHaveLength(3);
    } finally {
      for (const installed of f.host.ids().reverse())
        await f.host.stop(installed);
    }
  });
});
