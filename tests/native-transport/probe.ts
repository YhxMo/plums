import { invokeExperimental as invoke } from "../fixtures/native-invoke";
const owner = "probe.alpha";
let sequence = 0;
type Failure = { code: string; outcome: string };
const checks: string[] = [];
function assert(value: unknown, label: string): asserts value {
  if (!value) throw Error(label);
}
async function prepare(binding: string, body = "synthetic") {
  const id = `request-${++sequence}`;
  await invoke("probe_prepare", { owner, id, binding, body });
  return id;
}
async function request(binding: string, body = "synthetic") {
  const id = await prepare(binding, body);
  return invoke("probe_execute", { owner, id });
}
async function rejects(work: Promise<unknown>, code: string, outcome: string) {
  const result = await work.then(
    () => null,
    (error) => error as Failure,
  );
  assert(
    result?.code === code && result.outcome === outcome,
    `expected ${code}/${outcome}: ${JSON.stringify(result)}`,
  );
}
async function stats() {
  return JSON.parse((await request("stats")).body) as Record<string, number>;
}
async function until(work: () => Promise<boolean>) {
  const start = performance.now();
  while (!(await work())) {
    assert(performance.now() - start < 600, "dispatch not observed");
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function run() {
  const platform = await invoke("probe_info");
  try {
    await rejects(
      invoke("probe_prepare", {
        owner,
        id: "denied",
        binding: "echo",
        body: "x",
      }),
      "denied",
      "not-dispatched",
    );
    checks.push("ungranted-rejected");
    await invoke("probe_grant", { owner, allow: true });
    assert((await request("echo", "plum")).body === "echo:plum", "echo");
    checks.push("native-loopback-success");
    await rejects(
      invoke("probe_prepare", {
        owner,
        id: "bad",
        binding: "http://example.invalid",
        body: "x",
      }),
      "denied",
      "not-dispatched",
    );
    await rejects(
      invoke("probe_prepare", {
        owner,
        id: "big",
        binding: "echo",
        body: "x".repeat(4097),
      }),
      "denied",
      "not-dispatched",
    );
    checks.push("target-and-request-limit-rejected");
    const before = (await stats())["/echo"];
    const reserved = await prepare("echo");
    await rejects(
      invoke("probe_cancel", { owner: "probe.beta", id: reserved }),
      "denied",
      "not-dispatched",
    );
    await invoke("probe_cancel", { owner, id: reserved });
    await rejects(
      invoke("probe_execute", { owner, id: reserved }),
      "denied",
      "not-dispatched",
    );
    assert((await stats())["/echo"] === before, "pre-cancel dispatched");
    checks.push("cross-owner-and-pre-dispatch-cancel");
    for (const binding of ["delay", "slow"]) {
      const start = performance.now();
      await rejects(request(binding), "timeout", "unknown");
      assert(performance.now() - start < 1800, "timeout bound");
      checks.push(`${binding}-total-timeout`);
    }
    for (const operation of ["cancel", "revoke"]) {
      const before = (await stats())["/delay"] ?? 0;
      const id = await prepare("delay");
      const result = invoke("probe_execute", { owner, id }).then(
        () => null,
        (error) => error as Failure,
      );
      await until(async () => ((await stats())["/delay"] ?? 0) > before);
      const start = performance.now();
      if (operation === "cancel") await invoke("probe_cancel", { owner, id });
      else {
        await invoke("probe_grant", { owner, allow: false });
        await invoke("probe_grant", { owner, allow: true });
      }
      const error = await result;
      assert(
        error?.code === "cancelled" && error.outcome === "unknown",
        operation,
      );
      assert(performance.now() - start < 500, "cancel wait");
      await invoke("probe_grant", { owner, allow: true });
      checks.push(`inflight-${operation}-after-server-receipt`);
    }
    await rejects(request("redirect"), "redirect", "unknown");
    assert(!(await stats())["/should-not-hit"], "followed redirect");
    checks.push("redirect-not-followed");
    for (const binding of ["oversize", "chunked"]) {
      await rejects(request(binding), "limit", "unknown");
      checks.push(`${binding}-response-limit`);
    }
    const end = await invoke("probe_info");
    assert(end.pending === 0, "pending leak");
    checks.push("zero-pending");
    const report = { passed: true, platform, checks };
    await request("report", JSON.stringify(report));
    document.querySelector("#result")!.textContent = JSON.stringify(
      report,
      null,
      2,
    );
  } catch (error) {
    const report = { passed: false, platform, checks, error: String(error) };
    document.querySelector("#result")!.textContent = JSON.stringify(
      report,
      null,
      2,
    );
    try {
      await invoke("probe_grant", { owner, allow: true });
      await request("report", JSON.stringify(report));
    } catch {
      /* The report is best effort; the page already shows the result. */
    }
  }
}
void run();
