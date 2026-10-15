import { invoke } from "@tauri-apps/api/core";
import { Host } from "../../modules/extension-host/host";
import { ExperimentPlatform } from "./platform";
import { createEchoProbe } from "../fixtures/author-echo-probe.mjs";
type Echo = {
  request(
    body: string,
    binding?: "text" | "slow",
    signal?: AbortSignal,
  ): Promise<string>;
};
const id = "probe.alpha";
const observer = "probe.beta";
const checks: string[] = [];
let sequence = 0;
function assert(value: unknown, label: string): asserts value {
  if (!value) throw Error(label);
}
async function observe(binding: string, body = "synthetic") {
  const requestId = `observer-${++sequence}`;
  await invoke("probe_prepare", {
    owner: observer,
    id: requestId,
    binding,
    body,
  });
  return invoke<{ body: string }>("probe_execute", {
    owner: observer,
    id: requestId,
  });
}
async function hits() {
  return JSON.parse((await observe("stats")).body) as Record<string, number>;
}
async function until(work: () => Promise<boolean>) {
  const start = performance.now();
  while (!(await work())) {
    assert(performance.now() - start < 600, "dispatch not seen");
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function rejected(work: Promise<unknown>) {
  const result = await work.then(
    () => null,
    (error) => error,
  );
  assert(result !== null, "unexpected success");
  return result;
}
async function run() {
  const platformInfo = await invoke("probe_info");
  await invoke("probe_grant", { owner: observer, allow: true });
  const platform = await ExperimentPlatform.connect((command, args) =>
    invoke(command, args),
  );
  const host = new Host(platform);
  let service: Echo | undefined;
  const getService = () => service;
  host.install(createEchoProbe());
  host.install({
    manifest: {
      id: "probe.reader",
      version: "1",
      apiVersion: 1,
      requires: { "probe.alpha.echo": 1 },
    },
    activate(ctx) {
      service = ctx.use<Echo>("probe.alpha.echo");
      ctx.onDispose(() => {
        service = undefined;
      });
    },
  });
  try {
    await host.start(id);
    await host.start("probe.reader");
    assert(
      host.inspect(id).status === "waiting" && !service,
      "unauthorized activated",
    );
    checks.push("ungranted-extension-waits");
    await host.grant(id, ["credential.request"]);
    const initial = getService();
    assert(initial, "missing service");
    assert((await initial.request("plum")) === "echo:plum", "output");
    checks.push("independent-extension-public-output");
    const before = (await hits())["/echo"];
    const bad = await rejected(
      platform.call("extension.probe.alpha", "credential.request", {
        version: 1,
        binding: "text",
        body: "x",
        owner: "probe.beta",
      }),
    );
    assert(bad.outcome === "not-dispatched", "owner outcome");
    assert((await hits())["/echo"] === before, "spoof dispatched");
    checks.push("payload-owner-refused");
    await rejected(host.uninstall(id));
    assert(host.ids().includes(id), "active uninstall removed");
    checks.push("active-uninstall-refused");
    for (const action of ["abort", "stop", "uninstall", "revoke"]) {
      if (host.inspect(id).status !== "active") {
        await host.grant(id, ["credential.request"]);
        await host.start(id);
      }
      const retained = getService();
      assert(retained, "service not restored");
      const before = (await hits())["/delay"] ?? 0;
      const c = new AbortController();
      const result = retained.request("synthetic", "slow", c.signal).then(
        () => null,
        (error) => error,
      );
      await until(async () => ((await hits())["/delay"] ?? 0) > before);
      assert(host.inspect(id).tasks === 1, "request not tracked");
      if (action === "abort") c.abort();
      else if (action === "revoke") await host.grant(id, []);
      else {
        await host.stop(id);
        if (action === "uninstall") await host.uninstall(id);
      }
      const error = await result;
      assert(error?.outcome === "unknown", "inflight outcome");
      if (action !== "uninstall")
        assert(host.inspect(id).tasks === 0, "task leaked");
      if (action !== "abort") {
        await rejected(retained.request("stale"));
        assert(!service, "consumer retained registration");
        if (action === "uninstall") {
          assert(!host.ids().includes(id), "uninstall retained");
          host.install(createEchoProbe());
          await host.start(id);
          assert(
            host.inspect(id).status === "waiting" && !service,
            "reinstall inherited grant",
          );
        } else assert(host.inspect(id).resources === 0, "resource leaked");
      }
      const native = await invoke<{ pending: number }>("probe_info");
      assert(native.pending === 0, "native reservation leaked");
      checks.push(`public-${action}-cancels-inflight`);
    }
    await host.grant(id, ["credential.request"]);
    const restored = getService();
    assert(restored, "missing restart");
    assert(
      (await restored.request("restored")) === "echo:restored",
      "restart output",
    );
    checks.push("fresh-activation-restores-output");
    await host.stop(id);
    await host.uninstall(id);
    await host.stop("probe.reader");
    await host.uninstall("probe.reader");
    assert(
      host.ids().length === 0 && host.serviceNames().length === 0,
      "host leak",
    );
    checks.push("all-registrations-removed");
    const report = { passed: true, platform: platformInfo, checks };
    await observe("report", JSON.stringify(report));
    document.querySelector("#result")!.textContent = JSON.stringify(
      report,
      null,
      2,
    );
  } catch (error) {
    const report = {
      passed: false,
      platform: platformInfo,
      checks,
      error: String(error),
    };
    document.querySelector("#result")!.textContent = JSON.stringify(
      report,
      null,
      2,
    );
    await observe("report", JSON.stringify(report));
  }
}
void run();
