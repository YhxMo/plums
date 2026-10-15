import { Host } from "../../modules/extension-host/host";
import { PlatformAdapter } from "../../src/platform";
import type { StateMigration, StoredState } from "../../modules/sdk";
import {
  createMigrationProbe,
  oldValue,
} from "../fixtures/author-migration-probe";
type Service = {
  read(): Promise<StoredState | null>;
  seed(value: unknown): Promise<unknown>;
  migrate(
    signal?: AbortSignal,
    override?: Partial<StateMigration>,
  ): Promise<StoredState>;
};
const checks: string[] = [];
const platform = new PlatformAdapter();
const host = new Host(platform);
const result = (value: unknown) => {
  document.querySelector("#result")!.textContent = JSON.stringify(
    value,
    null,
    2,
  );
};
function assert(v: unknown, label: string): asserts v {
  if (!v) throw Error(label);
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
async function rejected(p: Promise<unknown>, outcome?: string) {
  const e = await p.then(
    () => null,
    (e) => e,
  );
  assert(e, "unexpected success");
  if (outcome) assert(e.outcome === outcome, "wrong outcome");
}
async function install(id: string, version = "2") {
  let service: Service | undefined;
  host.install(createMigrationProbe(id, version));
  const reader = id + ".reader";
  host.install({
    manifest: {
      id: reader,
      version: "1",
      apiVersion: 1,
      requires: { [id + ".state"]: 1 },
    },
    activate(ctx) {
      service = ctx.use(id + ".state");
    },
  });
  await host.grant(id, ["state.read", "state.write"]);
  await host.start(id);
  await host.start(reader);
  assert(service, "service missing");
  return service;
}
async function run() {
  try {
    const interrupted = await install("migration.interrupt");
    const prior = await interrupted.read();
    const restarting = prior !== null;
    if (restarting) {
      assert(equal(prior.value, oldValue), "interrupted original changed");
      const recovered = await interrupted.migrate();
      assert(
        equal((recovered.value as { previous: unknown }).previous, prior),
        "restart backup differs",
      );
      checks.push("killed-during-conversion-original-retained-and-recovered");
      const blocked = await install("migration.blocked");
      const blockedBefore = await blocked.read();
      assert(
        equal(blockedBefore?.value, oldValue),
        "failed original changed across restart",
      );
      const repaired = await blocked.migrate();
      assert(
        equal(
          (repaired.value as { previous: unknown }).previous,
          blockedBefore,
        ),
        "write failure recovery lost backup",
      );
      checks.push("native-write-refusal-recovery-after-obstruction-removed");
      const persisted = await install("migration.sample");
      const target = await persisted.read();
      assert(
        equal((target?.value as { data: unknown }).data, { labels: ["plum"] }),
        "target not persisted",
      );
      assert(
        equal(await persisted.migrate(), target),
        "cold target reentry wrote",
      );
      checks.push("target-and-backup-survive-cold-restart-without-rewrite");
      result({ passed: true, phase: "restarted", checks, recovered });
      return;
    }
    await interrupted.seed(oldValue);
    let s = await install("migration.sample", "1");
    await s.seed(oldValue);
    const source = await s.read();
    await host.stop("migration.sample");
    await host.uninstall("migration.sample");
    host.install(createMigrationProbe("migration.sample", "2"));
    await host.grant("migration.sample", ["state.read", "state.write"]);
    await host.start("migration.sample");
    // A fresh consumer avoids retaining the v1 service after uninstall.
    await host.stop("migration.sample.reader");
    await host.uninstall("migration.sample.reader");
    host.install({
      manifest: {
        id: "migration.reader.v2",
        version: "1",
        apiVersion: 1,
        requires: { "migration.sample.state": 1 },
      },
      activate(ctx) {
        s = ctx.use("migration.sample.state");
      },
    });
    await host.start("migration.reader.v2");
    const target = await s.migrate();
    assert(
      equal(target.value, {
        version: 2,
        data: { labels: ["plum"] },
        previous: source,
      }),
      "target or backup differs",
    );
    assert(equal(await s.migrate(), target), "target reentry wrote");
    checks.push("v1-uninstall-v2-install-migrates-once-with-original");
    for (const [name, value, override] of [
      ["unsupported-version", { version: 99, data: {} }, {}],
      ["invalid-source", { version: 1, data: { label: 3 } }, {}],
      [
        "conversion-throws",
        oldValue,
        {
          migrate: () => {
            throw Error("synthetic failure");
          },
        },
      ],
      ["invalid-target", oldValue, { migrate: () => ({ labels: [3] }) }],
      ["backup-limit", { version: 1, data: { label: "x".repeat(34000) } }, {}],
    ] as const) {
      await s.seed(value);
      const before = await s.read();
      await rejected(s.migrate(undefined, override));
      assert(equal(await s.read(), before), name + " changed original");
      checks.push(name + "-preserves-original");
    }
    await s.seed(oldValue);
    const before = await s.read();
    const c = new AbortController();
    await rejected(
      s.migrate(c.signal, {
        migrate: () => {
          c.abort();
          return { labels: ["plum"] };
        },
      }),
    );
    assert(equal(await s.read(), before), "cancel changed original");
    checks.push("cancel-before-write-preserves-original");
    const concurrent = { version: 1, data: { label: "concurrent" } };
    await rejected(
      s.migrate(undefined, {
        migrate: async () => {
          await s.seed(concurrent);
          return { labels: ["plum"] };
        },
      }),
      "not-committed",
    );
    assert(
      equal((await s.read())?.value, concurrent),
      "conflict overwrote writer",
    );
    checks.push("revision-conflict-preserves-concurrent-writer");
    const blocked = await install("migration.blocked");
    const blockedBefore = await blocked.read();
    assert(
      equal(blockedBefore?.value, oldValue),
      "preseed blocked original missing",
    );
    await rejected(blocked.migrate(), "not-committed");
    assert(
      equal(await blocked.read(), blockedBefore),
      "filesystem refusal changed original",
    );
    checks.push("native-pending-path-refusal-preserves-original");
    const other = await install("migration.other");
    await other.seed({ version: 1, data: { label: "other" } });
    const otherBefore = await other.read();
    await s.seed(oldValue);
    await s.migrate();
    assert(equal(await other.read(), otherBefore), "cross owner changed");
    checks.push("other-owner-preserved");
    const stopped = await install("migration.stop");
    await stopped.seed(oldValue);
    const stopBefore = await stopped.read();
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const operation = stopped.migrate(undefined, {
      migrate: async (_data, signal) => {
        entered();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return { labels: ["plum"] };
      },
    });
    const failure = rejected(operation);
    await started;
    await host.stop("migration.stop");
    await failure;
    // Read through the platform under the same test owner after stop; no stale service call.
    assert(
      equal(
        await platform.call("extension.migration.stop", "state.read"),
        stopBefore,
      ),
      "stop changed original",
    );
    checks.push("host-stop-during-conversion-preserves-original");
    const interruptedOriginal = await interrupted.read();
    await interrupted.migrate(undefined, {
      migrate: async () => {
        result({
          passed: true,
          phase: "paused-before-write",
          checks,
          interruptedOriginal,
        });
        return new Promise(() => {});
      },
    });
  } catch (error) {
    result({ passed: false, checks, error: String(error) });
  }
}
void run();
