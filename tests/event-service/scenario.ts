import { Host } from "../../modules/extension-host/host";
import type { ExtensionContext, Platform } from "../../modules/sdk";
import { createEventWorker } from "../fixtures/event-worker";
type Worker = {
  inspect(): {
    received: number;
    done: number;
    cancelled: number;
    failed: number;
    busy: boolean;
  };
  readAgain(): Promise<unknown>;
};
type Receipt = { id: string; status: string };
function assert(value: unknown, label: string): asserts value {
  if (!value) throw Error(label);
}
async function until(test: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!test()) {
    assert(Date.now() < deadline, "condition timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
export async function runEventScenario(platform: Platform) {
  const host = new Host(platform);
  const checks: string[] = [];
  const receipts: Receipt[] = [];
  let bus!: ExtensionContext;
  let worker: Worker | undefined;
  host.install(createEventWorker());
  host.install({
    manifest: { id: "event.observer", version: "1", apiVersion: 1 },
    activate(ctx) {
      bus = ctx;
      ctx.on("event.receipt", (r) => receipts.push(r as Receipt));
    },
  });
  host.install({
    manifest: {
      id: "event.reader",
      version: "1",
      apiVersion: 1,
      requires: { "event.worker": 1 },
    },
    activate(ctx) {
      worker = ctx.use("event.worker");
      ctx.onDispose(() => {
        worker = undefined;
      });
    },
  });
  await host.start("event.observer");
  await host.start("event.reader");
  await host.start("event.worker");
  const send = (id: string, hold = false) =>
    bus.emit("event.submit", { id, hold });
  const has = (id: string, status: string) =>
    receipts.some((r) => r.id === id && r.status === status);
  const stopped = () => {
    const s = host.inspect("event.worker");
    assert(s.tasks === 0 && s.resources === 0, "stopped resources");
  };
  try {
    assert(host.views().length === 0, "no registered views");
    assert(
      host.inspect("event.worker").status === "waiting",
      "permission wait",
    );
    send("denied");
    assert(!receipts.length, "ungranted ignored");
    checks.push("no-view-and-ungranted-wait");
    await host.grant("event.worker", ["state.read"]);
    assert(worker, "reader active");
    send("normal");
    await until(() => has("normal", "done"));
    await until(() => host.inspect("event.worker").tasks === 0);
    assert(worker.inspect().done === 1, "normal completion");
    checks.push("event-task-platform-read-without-view");
    const first = worker;
    send("held", true);
    await until(() => has("held", "started"));
    assert(host.inspect("event.worker").tasks === 1, "tracked task");
    send("overflow");
    assert(has("overflow", "busy"), "capacity diagnostic");
    checks.push("one-inflight-job-rejects-overflow");
    await host.stop("event.worker");
    stopped();
    assert(
      first.inspect().cancelled === 1 && !has("held", "done"),
      "cancelled not success",
    );
    const count = receipts.length;
    const stoppedReceived = first.inspect().received;
    send("paused");
    assert(
      receipts.length === count && first.inspect().received === stoppedReceived,
      "no listener after stop",
    );
    let rejected = false;
    try {
      await first.readAgain();
    } catch {
      rejected = true;
    }
    assert(rejected, "old service capability rejected");
    checks.push("stop-cancels-and-old-reference-rejected");
    await host.grant("event.worker", ["state.read"]);
    assert(
      host.inspect("event.worker").status === "disabled",
      "grant does not start disabled",
    );
    await host.start("event.worker");
    assert(worker && worker !== first, "restored fresh reader");
    send("resumed");
    await until(() => has("resumed", "done"));
    assert(
      receipts.filter((r) => r.id === "resumed").length === 1 &&
        worker.inspect().received === 1,
      "single fresh subscription",
    );
    checks.push("explicit-start-restores-one-fresh-subscription");
    const second = worker;
    send("revoke", true);
    await until(() => has("revoke", "started"));
    await host.grant("event.worker", []);
    stopped();
    assert(
      host.inspect("event.worker").status === "waiting" &&
        host.inspect("event.worker").desired,
      "revoked waits",
    );
    assert(
      second.inspect().cancelled === 1 && !has("revoke", "done"),
      "revoke cancels",
    );
    const revokedReceived = second.inspect().received;
    send("while-revoked");
    assert(
      second.inspect().received === revokedReceived,
      "revoked listener removed",
    );
    assert(!has("while-revoked", "done"), "no revoked work");
    await host.grant("event.worker", ["state.read"]);
    send("regranted");
    await until(() => has("regranted", "done"));
    assert(
      receipts.filter((r) => r.id === "regranted").length === 1 &&
        worker !== second &&
        worker!.inspect().received === 1,
      "single after regrant",
    );
    rejected = false;
    try {
      await second.readAgain();
    } catch {
      rejected = true;
    }
    assert(rejected, "regrant cannot revive old service");
    const third = worker!;
    checks.push("revoke-cancels-and-regrant-recovers");
    await host.stop("event.worker");
    await host.uninstall("event.worker");
    assert(!host.ids().includes("event.worker"), "uninstalled");
    const uninstalledReceived = third.inspect().received;
    send("uninstalled");
    assert(
      third.inspect().received === uninstalledReceived,
      "uninstalled listener removed",
    );
    rejected = false;
    try {
      await third.readAgain();
    } catch {
      rejected = true;
    }
    assert(rejected, "uninstalled reference rejected");
    assert(!has("uninstalled", "done"), "uninstalled ignores");
    checks.push("uninstall-removes-event-service");
    let dirtyCalls = 0;
    host.install({
      manifest: { id: "event.dirty", version: "1", apiVersion: 1 },
      activate(ctx) {
        ctx.on("event.submit", () => dirtyCalls++);
        ctx.onDispose(() => {
          throw Error("synthetic cleanup failure");
        });
      },
    });
    await host.start("event.dirty");
    let failed = false;
    try {
      await host.stop("event.dirty");
    } catch {
      failed = true;
    }
    assert(
      failed && host.inspect("event.dirty").status === "cleanup-failed",
      "cleanup failure visible",
    );
    send("dirty");
    assert(dirtyCalls === 0, "dirty listener inactive");
    failed = false;
    try {
      await host.start("event.dirty");
    } catch {
      failed = true;
    }
    assert(failed, "dirty cannot restart");
    assert(
      host.ids().includes("event.observer") && host.views().length === 0,
      "management query remains accessible without views",
    );
    checks.push("cleanup-failure-latched-management-query-accessible");
    return {
      passed: true,
      checks,
      receipts,
      platform: platform.kind,
      limitations:
        "Foreground process only; no business views mounted; bounded capacity belongs to sample, not Host quota",
    };
  } finally {
    for (const id of host.ids().reverse()) {
      if (host.inspect(id).status !== "cleanup-failed") await host.stop(id);
    }
  }
}
