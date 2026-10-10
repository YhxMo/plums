import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { validatePackage } from "../packages/core/dist/index.js";
import {
  desktopContribution,
  parseCommonEnvelope,
  parseCommonDeclaration,
  checkProtocolCompatibility,
} from "../packages/sdk/dist/index.js";

export const SUITE_VERSION = "1.0.0";
/** Project runtime evidence is separate from common/SDK evidence and cannot be green
 * merely because a fail-closed admission decision behaves correctly. */
export async function runProjectConformance({ nodePath } = {}) {
  const { ProjectSandbox } = await import(
    "../packages/host/dist/project-sandbox.js"
  );
  const sandbox = new ProjectSandbox(nodePath);
  try {
    const result = await sandbox.inspect();
    return {
      reportVersion: "1.0",
      suiteVersion: SUITE_VERSION,
      profile: "project",
      status: result.status === "skipped" ? "skipped" : "failed",
      projectAvailable: false,
      boundaryStatus: result.status,
      reason: result.reason,
      platform: result.platform,
      arch: result.arch,
      profileDigest: result.profileDigest,
      probeDigest: result.probeDigest,
      cleanupCompleted: result.cleanupCompleted,
      knownRisks: result.knownRisks,
      cases: [
        ...result.checks,
        {
          id: "project-runtime-admission",
          status: result.status === "skipped" ? "skipped" : "failed",
        },
      ],
    };
  } finally {
    await sandbox.close();
  }
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cases = [];
const test = (id, layer, run) => cases.push({ id, layer, run });
const success = (result) => {
  assert.equal(result.kind, "result");
  assert.equal(result.executionState, "completed");
  assert.equal(result.outcome.ok, true);
  return result.outcome.value;
};
const rejected = async (fn, reasons) => {
  try {
    await fn();
  } catch (error) {
    assert.ok(reasons.includes(error.details?.reason ?? error.code));
    return;
  }
  assert.fail("Expected rejection");
};
const invoke = async (client, operation, input = null, options) =>
  (
    await client.sdk.invoke(
      (await client.sdk.binding("backend")).handle,
      operation,
      input,
      options,
    )
  ).result;
const resource = async (client, slot) =>
  (await client.sdk.resources.list()).find((b) => b.requirementId === slot);
const waitRunning = async (client, call) => {
  for (let i = 0; i < 400; i++) {
    const s = await client.sdk.tasks.status(call.taskId);
    if (s.status.executionState === "unknown") return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("Provider did not start");
};

test("S01-structure-is-not-authority", "structure", async () => {
  const wire = {
    commonVersion: "1.4",
    kind: "invoke",
    callId: "probe",
    binding: "untrusted",
    operation: "echo",
    input: null,
    future: { kept: true },
  };
  assert.deepEqual(parseCommonEnvelope(wire), wire);
  assert.throws(() =>
    parseCommonEnvelope({ ...wire, input: { forbidden: undefined } }),
  );
  assert.throws(() =>
    parseCommonDeclaration({
      commonVersion: "1.0",
      features: [],
      runtime: "isolate",
      resources: [0, 1].map(() => ({
        id: "same",
        permissionId: "p",
        operations: ["read"],
      })),
    }),
  );
  const need = {
    id: "slot",
    protocol: "org.plums.conformance.probe",
    range: "^1.0.0",
    features: ["probe"],
  };
  const provided = {
    id: "p",
    protocol: need.protocol,
    version: "1.0.0",
    features: ["probe"],
    contribution: { kind: "tools", name: "probe" },
  };
  assert.equal(checkProtocolCompatibility(need, provided).compatible, true);
  assert.equal(
    checkProtocolCompatibility(need, { ...provided, version: "2.0.0" })
      .compatible,
    false,
  );
  assert.equal(
    checkProtocolCompatibility(need, { ...provided, features: [] }).compatible,
    false,
  );
});
test("H01-explicit-selection", "host-behavior", async (s) => {
  const c = await s.client();
  assert.equal(await c.sdk.binding("backend"), null);
  await rejected(
    () => c.sdk.binding("undeclared"),
    ["PROTOCOL_REQUIREMENT_NOT_DECLARED"],
  );
  const candidates = await c.sdk.discover("backend");
  assert.equal(candidates.length, 2);
  assert.ok(
    candidates.every(
      (b) => b.evidence === "declared" && b.protocolVersion === "1.0.0",
    ),
  );
  await rejected(
    () => c.sdk.invoke(candidates[0].handle, "echo", null),
    ["STALE_BINDING", "UNBOUND"],
  );
  await s.choose("a", "screen-one", "provider-one");
  success(await invoke(await s.client(), "echo", { probe: true }));
});
test("H02-two-agents-same-artifact", "host-behavior", async (s) => {
  const [a, b] = await Promise.all([s.client("a"), s.client("b")]);
  const bindings = await Promise.all([
    a.sdk.binding("backend"),
    b.sdk.binding("backend"),
  ]);
  assert.equal(
    bindings[0].provider.artifactDigest,
    bindings[1].provider.artifactDigest,
  );
  assert.notEqual(
    bindings[0].provider.installId,
    bindings[1].provider.installId,
  );
  const values = (
    await Promise.all([
      invoke(a, "echo", { actor: { agentId: s.metadata.agents.b } }),
      invoke(b, "echo", { actor: { agentId: s.metadata.agents.a } }),
    ])
  ).map(success);
  assert.equal(values[0].count, 1);
  assert.equal(values[1].count, 1);
  assert.equal(values[0].context.agentId, s.metadata.agents.a);
  assert.equal(values[1].context.agentId, s.metadata.agents.b);
  assert.notEqual(
    bindings[0].provider.instanceId,
    bindings[1].provider.instanceId,
  );
  await a.close();
  success(await invoke(b, "echo", null));
});
test(
  "H03-provider-replacement-and-runtime-consumer",
  "host-behavior",
  async (s) => {
    const original = await s.artifact("a", "screen-one"),
      c = await s.client(),
      old = (await c.sdk.binding("backend")).handle;
    const one = success(
      await s.runtimeCall("a", {
        operation: "echo",
        input: { value: "transport" },
      }),
    );
    assert.equal(one.implementation, "one");
    await s.choose("a", "screen-one", "provider-two");
    await rejected(
      () => c.sdk.invoke(old, "echo", null),
      [
        "STALE_BINDING",
        "NOT_AUTHORIZED",
        "PANEL_HANDLE_INVALID",
        "PANEL_SESSION_CLOSED",
        "PANEL_HANDLE_STALE",
      ],
    );
    const two = success(
      await s.runtimeCall("a", {
        operation: "echo",
        input: { value: "transport" },
      }),
    );
    assert.equal(two.implementation, "two");
    assert.deepEqual(two.input, one.input);
    assert.equal(await s.artifact("a", "screen-one"), original);
  },
);
test(
  "H04-independent-ui-and-owner-bound-handles",
  "host-behavior",
  async (s) => {
    const [a, b] = await s.views();
    assert.notEqual(a.context.handle, b.context.handle);
    assert.notEqual(a.context.componentId, b.context.componentId);
    const handle = (await a.sdk.binding("backend")).handle;
    await rejected(() => b.sdk.invoke(handle, "echo", null), ["STALE_BINDING"]);
    assert.equal(success(await invoke(a, "echo")).implementation, "one");
    assert.equal(success(await invoke(b, "echo")).implementation, "one");
    assert.deepEqual(Object.keys(a.sdk.policy), ["status"]);
  },
);
test("H05-event-order-replay-no-reexecution", "host-behavior", async (s) => {
  const c = await s.client(),
    call = await c.sdk.invoke(
      (await c.sdk.binding("backend")).handle,
      "events",
      { count: 3 },
    );
  const events = [];
  for await (const e of call.events) {
    parseCommonEnvelope(e);
    events.push(e);
  }
  assert.deepEqual(
    events.map((e) => e.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    events.map((e) => e.data.index),
    [0, 1, 2],
  );
  const result = await call.result,
    count = success(result).count;
  assert.equal(result.sequence, 4);
  const attached = await c.sdk.attach(call.taskId, 0),
    replayed = [];
  for await (const e of attached.events) replayed.push(e);
  assert.deepEqual(replayed, events);
  assert.deepEqual(await attached.result, result);
  assert.equal(success(await invoke(c, "echo")).count, count + 1);
});
test(
  "H09-contribution-schema-and-execution-state",
  "host-behavior",
  async (s) => {
    const c = await s.client();
    const invalidInput = await invoke(c, "undeclared-operation", null);
    assert.equal(invalidInput.outcome.ok, false);
    assert.equal(invalidInput.executionState, "not_started");
    assert.equal(success(await invoke(c, "echo")).count, 1);
    const invalidOutput = await invoke(c, "bad-output", null);
    assert.equal(invalidOutput.outcome.error.code, "PROVIDER_FAILED");
    assert.equal(invalidOutput.executionState, "completed");
    assert.equal(success(await invoke(c, "echo")).count, 3);
  },
);
test(
  "H08-bounded-replay-terminal-and-restart-no-body",
  "host-behavior",
  async (s) => {
    const c = await s.client(),
      info = await c.raw("invoke", {
        binding: (await c.sdk.binding("backend")).handle,
        operation: "events",
        input: { count: 300 },
      });
    let snapshot;
    for (let i = 0; i < 400; i++) {
      snapshot = await c.sdk.tasks.status(info.taskId);
      if (snapshot.result) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(snapshot.result.outcome.ok, false);
    assert.equal(snapshot.result.outcome.error.code, "LIMIT_EXCEEDED");
    assert.equal(snapshot.result.executionState, "unknown");
    await rejected(
      () => c.raw("poll", { taskId: info.taskId, afterSequence: -1 }),
      ["REPLAY_GAP"],
    );
    assert.equal(
      (await c.sdk.tasks.status(info.taskId)).result.outcome.error.code,
      "LIMIT_EXCEEDED",
    );
    await s.restart();
    const fresh = await s.client(),
      recovered = await fresh.sdk.tasks.status(info.taskId);
    assert.equal(recovered.result, undefined);
    assert.equal(recovered.status.executionState, "unknown");
    await rejected(
      () => fresh.raw("poll", { taskId: info.taskId, afterSequence: -1 }),
      ["REPLAY_GAP"],
    );
  },
);
test("H06-cancel-and-cross-agent-task-denial", "host-behavior", async (s) => {
  const a = await s.client("a"),
    b = await s.client("b"),
    call = await a.sdk.invoke(
      (await a.sdk.binding("backend")).handle,
      "hold",
      null,
    );
  await waitRunning(a, call);
  await rejected(() => b.sdk.tasks.status(call.taskId), ["NOT_AUTHORIZED"]);
  await call.cancel();
  const result = await call.result;
  assert.equal(result.executionState, "unknown");
  assert.equal(result.outcome.error.code, "CANCELLED");
  assert.equal((await a.sdk.tasks.status(call.taskId)).status.state, "stopped");
  await call.cancel();
});
test("H07-background-close-reopen", "host-behavior", async (s) => {
  const first = await s.client();
  await rejected(
    () => first.sdk.tasks.create({ lifetime: "agent" }),
    ["NOT_AUTHORIZED"],
  );
  await s.background("a");
  const a = await s.client(),
    task = await a.sdk.tasks.create({ lifetime: "agent" });
  const call = await a.sdk.invoke(
    (await a.sdk.binding("backend")).handle,
    "hold",
    null,
    { taskId: task.taskId },
  );
  await waitRunning(a, call);
  await a.close();
  const fresh = await s.client();
  assert.equal(
    (await fresh.sdk.tasks.status(task.taskId)).status.state,
    "running",
  );
  const attached = await fresh.sdk.attach(task.taskId, 0);
  await attached.cancel();
  assert.equal((await attached.result).executionState, "unknown");
});
test(
  "R01-shared-private-cas-tombstone-recovery",
  "host-behavior",
  async (s) => {
    await s.grantResources("a");
    await s.grantResources("b");
    const a = await s.client("a"),
      b = await s.client("b"),
      shared = await resource(a, "shared"),
      peer = await resource(b, "shared");
    assert.equal(shared.resourceId, peer.resourceId);
    const concurrent = await Promise.allSettled([
      a.sdk.resources.write(shared.binding, "race", "0", { value: "a" }),
      b.sdk.resources.write(peer.binding, "race", "0", { value: "b" }),
    ]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    const conflict = concurrent.find((r) => r.status === "rejected").reason;
    assert.equal(conflict.details?.reason, "RESOURCE_CONFLICT");
    const current = await a.sdk.resources.read(shared.binding, "race");
    assert.deepEqual(await b.sdk.resources.read(peer.binding, "race"), current);
    const privateA = await resource(a, "private"),
      privateB = await resource(b, "private");
    assert.notEqual(privateA.resourceId, privateB.resourceId);
    await a.sdk.resources.write(privateA.binding, "own", "0", "a");
    await b.sdk.resources.write(privateB.binding, "own", "0", "b");
    assert.equal(
      (await a.sdk.resources.read(privateA.binding, "own")).value,
      "a",
    );
    assert.equal(
      (await b.sdk.resources.read(privateB.binding, "own")).value,
      "b",
    );
    const deleted = await a.sdk.resources.delete(
      shared.binding,
      "race",
      current.revision,
    );
    await rejected(
      () =>
        b.sdk.resources.write(peer.binding, "race", current.revision, "stale"),
      ["RESOURCE_CONFLICT"],
    );
    await s.restart();
    await s.grantResources("a");
    const fresh = await s.client(),
      restored = await resource(fresh, "shared");
    assert.deepEqual(await fresh.sdk.resources.read(restored.binding, "race"), {
      exists: false,
      revision: deleted.revision,
    });
    assert.equal(
      (
        await fresh.sdk.resources.read(
          (await resource(fresh, "private")).binding,
          "own",
        )
      ).value,
      "a",
    );
  },
);
test(
  "R02-runtime-resources-and-revocation-isolation",
  "host-behavior",
  async (s) => {
    await s.grantResources("a");
    await s.grantResources("b");
    const a = await s.client("a"),
      b = await s.client("b"),
      shared = await resource(a, "shared"),
      peer = await resource(b, "shared");
    success(
      await s.runtimeCall("a", {
        operation: "resource",
        input: {
          action: "write",
          slot: "shared",
          key: "bridge",
          revision: "0",
          value: { synthetic: true },
        },
      }),
    );
    assert.deepEqual(
      (await b.sdk.resources.read(peer.binding, "bridge")).value,
      { synthetic: true },
    );
    await s.revokeShared("a");
    await rejected(
      () => a.sdk.resources.read(shared.binding, "bridge"),
      [
        "STALE_BINDING",
        "NOT_AUTHORIZED",
        "PANEL_HANDLE_INVALID",
        "PANEL_SESSION_CLOSED",
        "PANEL_HANDLE_STALE",
      ],
    );
    assert.equal(
      (await b.sdk.resources.read(peer.binding, "bridge")).exists,
      true,
    );
  },
);
test("R03-cross-process-cas-and-durable-winner", "host-behavior", async (s) => {
  await s.grantResources("a");
  const a = await s.client(),
    binding = await resource(a, "shared");
  const race = await s.processRace(a, binding.binding);
  assert.equal(race.independentProcess, true);
  const rows = [race.parent, race.peer];
  assert.equal(rows.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    rows.find((r) => r.status === "rejected").reason,
    "RESOURCE_CONFLICT",
  );
  const snapshot = await a.sdk.resources.read(binding.binding, "process-race");
  assert.equal(
    snapshot.value,
    race.parent.status === "fulfilled" ? "parent" : "child",
  );
  await s.restart();
  await s.grantResources("a");
  const fresh = await s.client();
  assert.deepEqual(
    await fresh.sdk.resources.read(
      (await resource(fresh, "shared")).binding,
      "process-race",
    ),
    snapshot,
  );
});
test(
  "P01-four-policies-real-file-and-tool-path",
  "host-behavior",
  async (s) => {
    let current;
    for (const [mode, expected] of [
      ["allow", true],
      ["deny", false],
      ["confirm", true],
      ["custom", true],
    ]) {
      await s.policy("a", mode);
      s.confirm(true);
      const c = (current = await s.client()),
        result = await invoke(c, "file", { path: "allowed.txt" });
      assert.equal(result.outcome.ok, expected);
      if (expected)
        assert.deepEqual(success(result).data, [
          ...Buffer.from("fixture-file"),
        ]);
      else assert.equal(result.outcome.error.code, "NOT_AUTHORIZED");
      if (mode === "confirm") assert.ok(s.confirmationCount() > 0);
      else assert.equal(s.confirmationCount(), 0);
    }
    const c = current;
    assert.equal(
      (await invoke(c, "file", { path: "blocked.txt" })).outcome.error.code,
      "NOT_AUTHORIZED",
    );
    await s.policy("a", "confirm");
    s.confirm("true");
    assert.equal(
      (await invoke(await s.client(), "file", { path: "allowed.txt" })).outcome
        .ok,
      false,
    );
    const encoded = s.audit();
    for (const value of ["fixture-file", "allowed.txt", s.dataDir])
      assert.ok(!encoded.includes(value));
  },
);
test(
  "P02-selected-maximum-and-restart-zero-lease",
  "host-behavior",
  async (s) => {
    await s.policy("a", "allow", (row) => row.category === "tool");
    assert.equal(
      (await invoke(await s.client(), "file", { path: "allowed.txt" })).outcome
        .error.code,
      "NOT_AUTHORIZED",
    );
    await s.restart();
    const c = await s.client(),
      state = await c.sdk.policy.status();
    assert.equal(state.selected.providerId, "policy-allow");
    assert.equal(state.active, null);
    assert.equal(
      (await invoke(c, "file", { path: "allowed.txt" })).outcome.ok,
      false,
    );
  },
);
test(
  "E01-four-policies-real-controlled-command",
  "execution-boundary",
  async (s) => {
    for (const [mode, expected] of [
      ["allow", true],
      ["deny", false],
      ["confirm", true],
      ["custom", false],
    ]) {
      await s.policy("a", mode);
      s.confirm(true);
      const r = await invoke(await s.client(), "exec", {
        args: ["literal $(echo forbidden)"],
      });
      assert.equal(r.outcome.ok, expected);
      if (expected) {
        const value = success(r);
        assert.equal(value.result.exitCode, 0);
        assert.equal(value.result.stdout, "literal $(echo forbidden)\n");
      } else {
        assert.equal(r.outcome.error.code, "NOT_AUTHORIZED");
        assert.equal(r.executionState, "unknown");
      }
      assert.equal(s.confirmationCount(), mode === "confirm" ? 1 : 0);
    }
    await s.policy("a", "confirm");
    s.confirm("true");
    const denied = await invoke(await s.client(), "exec", {
      args: ["unconfirmed"],
    });
    assert.equal(denied.outcome.error.code, "NOT_AUTHORIZED");
    assert.equal(denied.executionState, "unknown");
    assert.equal(s.confirmationCount(), 1);
  },
);
test("E02-direct-runtime-boundary", "execution-boundary", async (s) => {
  const server = createServer((socket) => socket.end());
  let connections = 0;
  server.on("connection", () => connections++);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const c = await s.client(),
      before = await s.file("a"),
      v = success(
        await invoke(c, "probe", {
          path: path.join(s.workPath("a"), "allowed.txt"),
          port: server.address().port,
        }),
      );
    if (s.metadata.runtime === "controlled-node")
      assert.deepEqual(v, {
        read: false,
        write: false,
        spawned: false,
        network: false,
      });
    else assert.deepEqual(v, { node: "undefined", require: "undefined" });
    assert.equal(connections, 0);
    assert.equal(await s.file("a"), before);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

export const PLATFORM_CASE_IDS = Object.freeze(cases.map((entry) => entry.id));

/** Adapter code is trusted test code. A passing report never upgrades a runtime binding's evidence. */
export async function runPlatformConformance(
  adapter,
  { caseIds, timeoutMs = 30000 } = {},
) {
  const selected = caseIds
    ? cases.filter((c) => caseIds.includes(c.id))
    : cases;
  if (
    !selected.length ||
    (caseIds && selected.length !== new Set(caseIds).size)
  )
    throw Error("Unknown conformance case");
  const report = {
    reportVersion: "1.0",
    suiteVersion: SUITE_VERSION,
    suiteDigest: digest(await readFile(fileURLToPath(import.meta.url))),
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    provenance:
      adapter.provenance === "internal-fixture"
        ? "internal-fixture"
        : "adapter-supplied-unverified",
    thirdPartyAuthorVerified: false,
    coverage: caseIds ? "partial" : "complete",
    cases: [],
    artifacts: [],
    limitations: [
      "Adapter assertions are test observations, not business protocol certification.",
      "Host bridge profile does not launch an Electron renderer.",
      "External adapter and its provenance require independent review.",
      "No Windows, Linux, Intel or earlier macOS support claim.",
    ],
  };
  for (const c of selected) {
    let scenario, timer;
    const row = { id: c.id, layer: c.layer, status: "failed" };
    try {
      row.phase = "setup";
      if (c.layer !== "structure") {
        scenario = await adapter.scenario({
          unbound: c.id === "H01-explicit-selection",
        });
        assert.ok(
          ["isolate", "controlled-node"].includes(scenario.metadata.runtime),
        );
        const entries = Object.entries(scenario.metadata.artifacts);
        assert.ok(entries.length);
        for (const [, hash] of entries) assert.match(hash, /^[a-f0-9]{64}$/);
        report.artifacts.push({
          caseId: c.id,
          runtime: scenario.metadata.runtime,
          digests: entries.map(([, hash]) => hash).sort(),
        });
      }
      row.phase = "check";
      const running = c.run(scenario);
      await Promise.race([
        running,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(Error(), { code: "CASE_TIMEOUT" })),
            timeoutMs,
          );
        }),
      ]);
      row.status = "passed";
      delete row.phase;
    } catch (error) {
      // Never print assertion values, adapter messages, business output or physical paths.
      row.failure = {
        checkLine:
          Number(error.stack?.match(/platform-conformance\.mjs:(\d+)/)?.[1]) ||
          null,
        code:
          error.code === "ERR_ASSERTION"
            ? "ASSERTION_FAILED"
            : error.code === "CASE_TIMEOUT"
              ? "CASE_TIMEOUT"
              : "ADAPTER_OR_HOST_FAILED",
      };
    } finally {
      clearTimeout(timer);
      try {
        await scenario?.close();
      } catch {
        row.status = "failed";
        row.phase = "cleanup";
        row.failure = { code: "CLEANUP_FAILED" };
      }
    }
    report.cases.push(row);
  }
  report.status = report.cases.every((c) => c.status === "passed")
    ? "passed"
    : "failed";
  return report;
}
export async function inspectPlatformPackage(file) {
  const bytes = await readFile(file),
    contents = await validatePackage(bytes),
    declaration = desktopContribution(contents.manifest, contents.files);
  return {
    reportVersion: "1.0",
    suiteVersion: SUITE_VERSION,
    artifactDigest: digest(bytes),
    layer: "structure",
    status: "passed",
    sdkVersion: declaration?.sdkVersion ?? null,
    commonVersion: declaration?.common?.commonVersion ?? null,
    evidence: "declared",
    behaviorVerified: false,
    thirdPartyAuthorVerified: false,
  };
}
async function main(args) {
  let runtime = "isolate",
    adapterFile,
    packageFile,
    out,
    nodePath;
  try {
    for (let i = 0; i < args.length; i++) {
      const key = args[i],
        value = args[++i];
      if (
        !value ||
        !["--runtime", "--adapter", "--package", "--out", "--node"].includes(
          key,
        )
      )
        throw Error("Invalid arguments");
      if (key === "--runtime") runtime = value;
      if (key === "--adapter") adapterFile = path.resolve(value);
      if (key === "--package") packageFile = path.resolve(value);
      if (key === "--out") out = path.resolve(value);
      if (key === "--node") nodePath = path.resolve(value);
    }
    if (packageFile && adapterFile) throw Error("Conflicting profiles");
    if (runtime === "project" && (packageFile || adapterFile))
      throw Error("Conflicting profiles");
    let report;
    if (runtime === "project")
      report = await runProjectConformance({ nodePath });
    else if (packageFile) report = await inspectPlatformPackage(packageFile);
    else {
      const module = await import(
        pathToFileURL(
          adapterFile ??
            path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              "platform-conformance-host.mjs",
            ),
        ).href
      );
      const adapter = await module.open({ runtime, nodePath });
      // A caller cannot label an external module as an internal or independently verified author.
      report = await runPlatformConformance({
        ...adapter,
        provenance: adapterFile
          ? "adapter-supplied-unverified"
          : "internal-fixture",
      });
      report.adapterDigest = digest(
        await readFile(
          adapterFile ??
            fileURLToPath(
              new URL("./platform-conformance-host.mjs", import.meta.url),
            ),
        ),
      );
    }
    if (out) {
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "passed") process.exitCode = 1;
  } catch {
    const report = {
      reportVersion: "1.0",
      suiteVersion: SUITE_VERSION,
      status: "failed",
      failure: { code: "INPUT_OR_ADAPTER_FAILED" },
    };
    if (out) {
      try {
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, JSON.stringify(report, null, 2) + "\n");
      } catch {
        report.failure.code = "REPORT_WRITE_FAILED";
      }
    }
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
