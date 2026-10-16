import { Host } from "../../modules/extension-host/host";
import {
  migrateState,
  restorePreviousState,
  type ExtensionContext,
  type Platform,
  type StoredState,
} from "../../modules/sdk";
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function assert(v: unknown, label: string): asserts v {
  if (!v) throw Error(label);
}
export async function runRestoreScenario(platform: Platform) {
  const host = new Host(platform);
  let ctx!: ExtensionContext;
  const checks: string[] = [];
  host.install({
    manifest: {
      id: "restore.sample",
      version: "2",
      apiVersion: 1,
      capabilities: ["state.read", "state.write"],
    },
    activate(context) {
      ctx = context;
    },
  });
  await host.grant("restore.sample", ["state.read", "state.write"]);
  await host.start("restore.sample");
  const read = () => ctx.platform("state.read") as Promise<StoredState | null>;
  const seed = async (value: unknown) =>
    ctx.platform("state.write", {
      revision: (await read())?.revision ?? 0,
      value,
    }) as Promise<StoredState>;
  const valid = (data: unknown) =>
    typeof (data as { label?: unknown })?.label === "string";
  try {
    const original = await seed({ version: 1, data: { label: "plum" } });
    const upgraded = await migrateState(ctx, {
      from: 1,
      to: 2,
      migrate: (d) => ({ labels: [(d as { label: string }).label] }),
      validate: (d) => Array.isArray((d as { labels?: unknown }).labels),
    });
    const plan = {
      revision: upgraded.revision,
      from: 2,
      to: 1,
      validate: valid,
    };
    let failed = false;
    try {
      await restorePreviousState(ctx, { ...plan, revision: original.revision });
    } catch {
      failed = true;
    }
    assert(
      failed && equal(await read(), upgraded),
      "stale confirmation preserved",
    );
    checks.push("stale-confirmation-does-not-write");
    failed = false;
    try {
      await restorePreviousState(ctx, { ...plan, validate: () => false });
    } catch {
      failed = true;
    }
    assert(failed && equal(await read(), upgraded), "invalid schema preserved");
    checks.push("business-validation-rejection-preserves-target");
    const cancel = new AbortController();
    failed = false;
    try {
      await restorePreviousState(
        ctx,
        {
          ...plan,
          validate: () => {
            cancel.abort();
            return true;
          },
        },
        cancel.signal,
      );
    } catch {
      failed = true;
    }
    assert(
      failed && equal(await read(), upgraded),
      "pre-dispatch cancellation",
    );
    checks.push("cancel-before-dispatch-preserves-target");
    const restored = await restorePreviousState(ctx, plan);
    assert(
      equal(restored.value, {
        version: 1,
        data: { label: "plum" },
        previous: upgraded,
      }),
      "restore retains replaced target",
    );
    assert(equal(await read(), restored), "readback restored");
    checks.push("restore-and-retain-upgraded-state-one-commit");
    failed = false;
    try {
      await restorePreviousState(ctx, plan);
    } catch {
      failed = true;
    }
    assert(failed && equal(await read(), restored), "no blind retry");
    checks.push("repeated-confirmation-rejected");
    await host.stop("restore.sample");
    await host.start("restore.sample");
    assert(equal(await read(), restored), "reactivation reads restored state");
    checks.push("reactivation-retains-restored-and-upgraded-values");
    const bad = await seed({ version: 2, data: { labels: ["plum"] } });
    failed = false;
    try {
      await restorePreviousState(ctx, { ...plan, revision: bad.revision });
    } catch {
      failed = true;
    }
    assert(failed && equal(await read(), bad), "missing snapshot preserved");
    checks.push("missing-snapshot-refuses-restore");
    const large = await seed({
      version: 2,
      data: { labels: ["x".repeat(24000)] },
      previous: {
        revision: original.revision,
        value: { version: 1, data: { label: "y".repeat(24000) } },
      },
    });
    failed = false;
    try {
      await restorePreviousState(ctx, { ...plan, revision: large.revision });
    } catch (error) {
      failed = (error as { outcome?: string }).outcome === "not-committed";
    }
    assert(
      failed && equal(await read(), large),
      "capacity refusal preserves both snapshots",
    );
    checks.push("backup-growth-capacity-rejection-preserves-state");
    // Keep the successful restored value available for external file verification.
    const final = await seed(restored.value);
    return {
      passed: true,
      checks,
      platform: platform.kind,
      final,
      limitations:
        "Explicit data snapshot restore only; no package rollback or crash-during-commit guarantee",
    };
  } finally {
    await host.stop("restore.sample");
  }
}
