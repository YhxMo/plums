import { invokeExperimental as invoke } from "../fixtures/native-invoke";
import { Host } from "../../modules/extension-host/host";
import { ExperimentPlatform } from "../host-transport/platform";
import { createEchoProbe } from "../fixtures/author-echo-probe.mjs";

const owner = "probe.alpha";
const checks: { name: string; detail: unknown }[] = [];
let seq = 0;
function assert(value: unknown, label: string): asserts value {
  if (!value) throw Error(label);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function rejected(p: Promise<unknown>, outcome = "unknown") {
  const e = await p.then(
    () => null,
    (e) => e,
  );
  assert(e?.outcome === outcome, `expected ${outcome}: ${JSON.stringify(e)}`);
}
const info = () => invoke("probe_info");
const fault = (
  faults: import("../../src/native/experimental.generated").ExperimentalCommands["probe_faults"]["args"]["faults"],
) => invoke("probe_faults", { owner, faults });
const prepare = (id: string) =>
  invoke("probe_prepare", { owner, id, binding: "echo", body: "synthetic" });
async function observe(binding: string, body = "synthetic") {
  const args = { owner: "probe.beta", id: `observer-${++seq}` };
  await invoke("probe_prepare", { ...args, binding, body });
  return invoke("probe_execute", args);
}
async function hits() {
  return JSON.parse((await observe("stats")).body) as Record<string, number>;
}
async function run() {
  const platform = await info();
  await invoke("probe_grant", { owner: "probe.beta", allow: true });
  const host = new Host(
    await ExperimentPlatform.connect((name, args) => invoke(name, args)),
  );
  let service:
    | {
        request(
          body: string,
          binding?: string,
          signal?: AbortSignal,
        ): Promise<string>;
      }
    | undefined;
  host.install(createEchoProbe());
  host.install({
    manifest: {
      id: "probe.reader",
      version: "1",
      apiVersion: 1,
      requires: { "probe.alpha.echo": 1 },
    },
    activate(ctx) {
      service = ctx.use("probe.alpha.echo");
    },
  });
  await host.grant(owner, ["credential.request"]);
  await host.start(owner);
  await host.start("probe.reader");
  assert(service, "service unavailable");
  const echo = service;
  try {
    const initial = (await hits())["/echo"] ?? 0;
    for (const [name, flags, pending] of [
      ["prepare-before-failure", { prepare_before: true }, 0],
      ["prepare-receipt-lost-cancel-confirmed", { prepare_receipt: true }, 0],
      [
        "prepare-and-cancel-receipts-lost",
        { prepare_receipt: true, cancel_receipt: true },
        0,
      ],
      [
        "prepare-receipt-lost-cancel-before-failure",
        { prepare_receipt: true, cancel_before: true },
        1,
      ],
    ] as const) {
      await fault(flags);
      await rejected(echo.request("synthetic"));
      const immediate = await info();
      assert(immediate.pending === pending, `${name} immediate pending`);
      assert(host.inspect(owner).tasks === 0, "host task leaked");
      if (pending) await wait(1100);
      const recovered = await info();
      assert(recovered.pending === 0, `${name} recovery`);
      assert(((await hits())["/echo"] ?? 0) === initial, "unexpected dispatch");
      checks.push({
        name,
        detail: {
          immediate: immediate.pending,
          afterNextObservation: recovered.pending,
          outcome: "unknown",
          dispatched: false,
        },
      });
    }
    await fault({ prepare_receipt: true, cancel_before: true });
    await rejected(prepare("expired"));
    await rejected(
      invoke("probe_cancel", { owner: "probe.beta", id: "expired" }),
      "not-dispatched",
    );
    assert((await info()).pending === 1, "cross owner removed reservation");
    await wait(1100);
    await rejected(
      invoke("probe_execute", { owner, id: "expired" }),
      "not-dispatched",
    );
    assert((await info()).pending === 0, "expired reservation retained");
    assert(
      ((await hits())["/echo"] ?? 0) === initial,
      "expired request dispatched",
    );
    checks.push({
      name: "expired-execute-and-cross-owner-refused",
      detail: { pending: (await info()).pending },
    });
    for (let i = 0; i < 16; i++) await prepare(`capacity-${i}`);
    await rejected(prepare("overflow"), "not-dispatched");
    assert((await info()).pending === 16, "capacity not observed");
    await wait(1100);
    assert(
      (await echo.request("recovered")) === "echo:recovered",
      "capacity recovery output",
    );
    assert((await info()).pending === 0, "capacity leaked");
    checks.push({
      name: "capacity-limit-and-next-prepare-recovery",
      detail: { limit: 16, output: "echo:recovered" },
    });
    const before = (await hits())["/echo"] ?? 0;
    await fault({ execute_receipt: true });
    await rejected(echo.request("receipt-lost"));
    assert(
      ((await hits())["/echo"] ?? 0) === before + 1,
      "lost execute receipt did not dispatch",
    );
    assert((await info()).pending === 0, "execute receipt leaked");
    checks.push({
      name: "execute-receipt-lost-after-side-effect",
      detail: { outcome: "unknown", dispatchDelta: 1 },
    });
    for (const mode of ["cancel_before", "cancel_receipt"]) {
      const before = (await hits())["/delay"] ?? 0;
      await fault({ [mode]: true });
      const c = new AbortController();
      const started = performance.now();
      const request = rejected(echo.request("inflight", "slow", c.signal));
      while (((await hits())["/delay"] ?? 0) === before) {
        assert(performance.now() - started < 600, "dispatch deadline");
        await wait(20);
      }
      c.abort();
      await request;
      const elapsed = performance.now() - started;
      assert(elapsed < 1800, "cleanup deadline");
      assert(
        (await info()).pending === 0 && host.inspect(owner).tasks === 0,
        "inflight leak",
      );
      checks.push({
        name: `inflight-${mode}`,
        detail: {
          outcome: "unknown",
          dispatched: true,
          elapsedMs: Math.round(elapsed),
          pending: 0,
        },
      });
    }
    await host.stop(owner);
    await host.uninstall(owner);
    await host.stop("probe.reader");
    await host.uninstall("probe.reader");
    assert(
      host.ids().length === 0 && (await info()).pending === 0,
      "final leak",
    );
    const report = { passed: true, platform, checks };
    document.querySelector("#result")!.textContent = JSON.stringify(
      report,
      null,
      2,
    );
    await observe("report", JSON.stringify(report));
  } catch (e) {
    const report = { passed: false, platform, checks, error: String(e) };
    document.querySelector("#result")!.textContent = JSON.stringify(
      report,
      null,
      2,
    );
    await observe("report", JSON.stringify(report));
  }
}
void run();
