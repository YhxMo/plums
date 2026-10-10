import { afterEach, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createCore, RecordingEgressSink } from "@plums/core";
import { callbackFixture, callbackActors } from "./local-callback-fixture.js";

const fixtures: Pick<
  Awaited<ReturnType<typeof callbackFixture>>,
  "host" | "dir"
>[] = [];
async function fixture(options: Parameters<typeof callbackFixture>[0] = {}) {
  const f = await callbackFixture(options, (host, dir) =>
    fixtures.push({ host, dir }),
  );
  return f;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
const success = {
  kind: "result",
  executionState: "completed",
  outcome: { ok: true },
};

it("runs a real local protocol callback through common and resources with every trusted parent actor", async () => {
  const f = await fixture();
  const value = { text: "private-callback-record" };
  const written = await f.run({ op: "write", value });
  expect(written).toMatchObject(success);
  expect(await f.run({ op: "read" })).toMatchObject({
    ...success,
    outcome: { ok: true, value: { exists: true, value } },
  });
  expect(await f.direct({ op: "read" })).toMatchObject({ exists: true, value });
  expect(
    f.audit.find(
      (e) =>
        e.kind === "resource" && e.phase === "allow" && e.operation === "write",
    ),
  ).toMatchObject({
    extensionId: "store",
    callerIds: callbackActors.slice(0, -1),
    executionState: "not_started",
  });
  expect(f.confirm.ask).not.toHaveBeenCalled();
  expect(JSON.stringify(f.audit)).not.toMatch(/private-callback-record|forged/);
  expect(JSON.stringify(f.audit)).not.toContain(f.dir);
});

it.each(["caller", "engine-demo", "middle"])(
  "cannot replace missing resource permission of %s using self-reported parent context",
  async (omitPermission) => {
    const f = await fixture({ omitPermission });
    expect(await f.run({ op: "write", value: "forbidden" })).toMatchObject({
      outcome: { ok: false },
    });
    expect(await f.direct({ op: "read" })).toEqual({
      exists: false,
      revision: "0",
    });
    expect(
      f.audit.filter(
        (e) =>
          e.kind === "resource" &&
          e.phase === "allow" &&
          e.operation === "write",
      ),
    ).toHaveLength(0);
    expect(f.confirm.ask).not.toHaveBeenCalled();
  },
);

it.each([
  { qualification: "caller" },
  { qualification: "middle" },
  { rangeOmit: "engine-demo" },
  { rangeReadOnly: true },
])(
  "intersects resource qualifications and the ordinary maximum in a local callback: %j",
  async (options) => {
    const f = await fixture(options);
    expect(await f.run({ op: "write", value: "forbidden" })).toMatchObject({
      outcome: { ok: false },
    });
    expect(await f.direct({ op: "read" })).toEqual({
      exists: false,
      revision: "0",
    });
    expect(f.confirm.ask).not.toHaveBeenCalled();
  },
);

it("binds resource handles to the real ordinary or local runtime, even for the same component", async () => {
  const f = await fixture();
  const ordinary = await f.direct({ op: "handle" });
  expect(
    await f.run({ op: "write", binding: ordinary, value: "forbidden" }),
  ).toMatchObject({ outcome: { ok: false, error: { code: "STALE_BINDING" } } });
  const local = (await f.run({ op: "handle" })) as {
    outcome: { value: string };
  };
  expect(local).toMatchObject(success);
  await expect(
    f.direct({ op: "write", binding: local.outcome.value, value: "forbidden" }),
  ).rejects.toMatchObject({
    details: { reason: "STALE_BINDING", executionState: "not_started" },
  });
  expect(await f.direct({ op: "read" })).toEqual({
    exists: false,
    revision: "0",
  });
});

it("keeps a non-local policy lease, complete chain, resource maximum and bounded deadline on common callbacks", async () => {
  const f = await fixture({
    policy: `if(c.category==='local')return decision('confirm');if(c.actors.map(a=>a.componentId).join(',')!=='caller,engine-demo,middle,store'||c.deadline>c.maximum.expiresAt||c.deadline>Date.now()+120000||c.maximum.selection.some(v=>v.category==='local'))throw Error('bad context');return decision('allow');`,
  });
  expect(await f.run({ op: "write", value: "policy-record" })).toMatchObject(
    success,
  );
  expect(
    f.audit
      .filter((e) => e.phase === "policy" && e.outcome === "allowed")
      .some(
        (e) =>
          e.extensionId === "store" &&
          JSON.stringify(e.callerIds) ===
            JSON.stringify(callbackActors.slice(0, -1)),
      ),
  ).toBe(true);
  expect(f.confirm.ask).not.toHaveBeenCalled();
});

it.each([
  { noPolicyLease: true },
  { policyOmit: "caller" },
  { policy: `return decision(c.category==='local'?'allow':'deny');` },
])(
  "local authorization cannot replace a non-local policy lease or decision: %j",
  async (options) => {
    const f = await fixture({
      policy: `return decision('allow');`,
      ...options,
    });
    expect(await f.run({ op: "fs" })).toMatchObject({ outcome: { ok: false } });
    expect(f.fs.records).toHaveLength(0);
    expect(f.confirm.ask).not.toHaveBeenCalled();
  },
);

it("cancels a local common child without a parent taskId and prevents a late fs confirmation", async () => {
  const f = await fixture(),
    abort = new AbortController();
  let entered!: () => void, release!: (value: boolean) => void;
  const ready = new Promise<void>((r) => {
    entered = r;
  });
  f.confirm.ask.mockImplementation(
    () =>
      new Promise<boolean>((r) => {
        release = r;
        entered();
      }),
  );
  const running = f.run({ op: "fs" }, abort.signal);
  const refused = expect(running).rejects.toBeDefined();
  await ready;
  const tasks = (await f.host.commonTasks(f.id)).filter(
    (t) => t.description.owner.componentId === "middle",
  );
  expect(tasks).toHaveLength(1);
  abort.abort();
  release(true);
  await refused;
  await expect
    .poll(
      async () =>
        (await f.host.commonTasks(f.id)).find(
          (t) => t.description.taskId === tasks[0]!.description.taskId,
        )?.snapshot.status.state,
    )
    .toBe("stopped");
  expect(f.fs.records).toHaveLength(0);
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "running" },
  );
});

it("cancels a nested local common child when its parent common task is cancelled", async () => {
  const f = await fixture();
  const parent = (await f.run({
    op: "hang",
    common: true,
    parentDetached: true,
  })) as { taskId: string };
  await expect
    .poll(
      async () =>
        (await f.host.commonTasks(f.id)).find(
          (t) => t.description.owner.componentId === "middle",
        )?.snapshot.status.state,
      { timeout: 8000 },
    )
    .toBe("running");
  await f.host.stopCommonTask(f.id, parent.taskId);
  await expect
    .poll(async () =>
      (await f.host.commonTasks(f.id))
        .filter((t) => callbackActors.includes(t.description.owner.componentId))
        .every((t) => t.snapshot.status.state === "stopped"),
    )
    .toBe(true);
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "running" },
  );
});

it("does not let a background child outlive the local parent request that created it", async () => {
  const f = await fixture();
  await f.host.setComponentBackground(f.id, "middle", true);
  expect(
    await f.run({ op: "hang", background: true, detached: true }),
  ).toHaveProperty("taskId");
  await expect
    .poll(
      async () =>
        (await f.host.commonTasks(f.id)).find(
          (t) => t.description.owner.componentId === "middle",
        )?.snapshot.status.state,
    )
    .toBe("stopped");
  expect(f.confirm.ask).not.toHaveBeenCalled();
});

it("uses ordinary single confirmation for local resource access outside a reusable range", async () => {
  const f = await fixture({ noRange: true });
  f.confirm.ask.mockResolvedValueOnce(false);
  expect(await f.run({ op: "write", value: "rejected-record" })).toMatchObject({
    outcome: { ok: false, error: { code: "NOT_AUTHORIZED" } },
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(1);
  expect(await f.run({ op: "read" })).toMatchObject({
    ...success,
    outcome: { ok: true, value: { exists: false, revision: "0" } },
  });
  expect(f.confirm.ask).toHaveBeenCalledTimes(2);
});

it("does not commit a local resource write confirmed after its parent cancels", async () => {
  const f = await fixture({ noRange: true }),
    abort = new AbortController();
  let entered!: () => void, release!: (value: boolean) => void;
  const ready = new Promise<void>((resolve) => (entered = resolve));
  f.confirm.ask.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve;
        entered();
      }),
  );
  const running = f.run(
      { op: "write", value: "late-confirm-record" },
      abort.signal,
    ),
    refused = expect(running).rejects.toBeDefined();
  await ready;
  abort.abort();
  release(true);
  await refused;
  f.confirm.ask.mockResolvedValue(true);
  expect(await f.direct({ op: "read" })).toEqual({
    exists: false,
    revision: "0",
  });
  expect(
    f.audit.filter(
      (event) =>
        event.kind === "resource" &&
        event.operation === "write" &&
        event.phase === "allow",
    ),
  ).toHaveLength(0);
});

it("rechecks the upstream lifecycle after a local resource allow audit before its transaction", async () => {
  const f = await fixture();
  const other = createCore({
    dataDir: path.join(f.dir, "instances", f.id, "core"),
    secrets: f.options.secretStore(f.id),
    egress: new RecordingEgressSink(),
  });
  let changed = false;
  try {
    f.setAudit(async (e) => {
      if (
        e.kind === "resource" &&
        e.phase === "allow" &&
        e.operation === "write"
      ) {
        await other.disable("caller");
        await other.enable("caller");
        changed = true;
      }
    });
    await f
      .run({ op: "write", value: "uncommitted-record" })
      .catch(() => undefined);
    expect(changed).toBe(true);
    expect(await f.direct({ op: "read" })).toEqual({
      exists: false,
      revision: "0",
    });
    expect(
      f.audit.filter(
        (e) =>
          e.kind === "resource" &&
          e.phase === "result" &&
          e.operation === "write",
      ),
    ).toHaveLength(0);
  } finally {
    other.close();
  }
});

it("cancels a resource commit suspended in audit when the native parent request aborts", async () => {
  const f = await fixture(),
    abort = new AbortController();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => {
      entered = r;
    }),
    blocked = new Promise<void>((r) => {
      release = r;
    });
  f.setAudit(async (e) => {
    if (
      e.kind === "resource" &&
      e.phase === "allow" &&
      e.operation === "write"
    ) {
      entered();
      await blocked;
    }
  });
  const running = f.run(
      { op: "write", value: "late-private-record" },
      abort.signal,
    ),
    refused = expect(running).rejects.toBeDefined();
  await ready;
  abort.abort();
  release();
  await refused;
  await expect
    .poll(
      async () =>
        (await f.host.commonTasks(f.id)).find(
          (t) => t.description.owner.componentId === "middle",
        )?.snapshot.status.state,
      { timeout: 8000 },
    )
    .toBe("stopped");
  expect(await f.direct({ op: "read" })).toEqual({
    exists: false,
    revision: "0",
  });
  expect(JSON.stringify(f.audit)).not.toContain("late-private-record");
});

it("expires a nested local callback at its original common task deadline", async () => {
  const f = await fixture();
  // Prepare the process first so the short deadline measures work, not startup.
  expect(await f.run({ op: "list" })).toMatchObject(success);
  const result = await f.run({ op: "hang", common: true, timeoutMs: 1000 });
  expect(result).toMatchObject({
    outcome: { ok: false, error: { code: "DEADLINE_EXCEEDED" } },
  });
  await expect
    .poll(
      async () =>
        (await f.host.commonTasks(f.id))
          .filter((t) => t.description.owner.componentId === "middle")
          .at(-1)?.snapshot.status.state,
      { timeout: 8000 },
    )
    .toBe("stopped");
  expect(await f.host.engineStatus(f.id, "engine-demo", "local")).toMatchObject(
    { state: "running" },
  );
});

it("rejects a malformed non-local decision on the native common callback without falling back", async () => {
  const f = await fixture({
    policy: `if(c.category==='local')return decision('allow');return {...decision('allow'),operationFingerprint:'0'.repeat(64)};`,
  });
  expect(await f.run({ op: "fs" })).toMatchObject({
    outcome: { ok: false, error: { code: "POLICY_UNAVAILABLE" } },
  });
  expect(f.fs.records).toHaveLength(0);
  expect(f.confirm.ask).not.toHaveBeenCalled();
});

it("rechecks the actual local authorization after a resource allow audit, without relying on process self-report", async () => {
  const f = await fixture();
  const other = createCore({
    dataDir: path.join(f.dir, "instances", f.id, "core"),
    instanceId: f.id,
    secrets: f.options.secretStore(f.id),
    egress: new RecordingEgressSink(),
  });
  let revoked = false;
  try {
    f.setAudit(async (e) => {
      if (
        e.kind === "resource" &&
        e.phase === "allow" &&
        e.operation === "write"
      ) {
        await other.revokeEngineTrust("engine-demo", "local");
        revoked = true;
      }
    });
    await f
      .run({ op: "write", value: "revoked-record" })
      .catch(() => undefined);
    expect(revoked).toBe(true);
    expect(await f.direct({ op: "read" })).toEqual({
      exists: false,
      revision: "0",
    });
    expect(
      f.audit.filter(
        (e) =>
          e.kind === "resource" &&
          e.phase === "result" &&
          e.operation === "write",
      ),
    ).toHaveLength(0);
  } finally {
    other.close();
  }
});

it("keeps a committed resource classified as completed when its result audit fails on a local common callback", async () => {
  const f = await fixture();
  f.setAudit(async (e) => {
    if (
      e.kind === "resource" &&
      e.phase === "result" &&
      e.operation === "write"
    )
      throw Error("private-audit-error");
  });
  const result = await f.run({
    op: "write",
    value: "committed-private-record",
  });
  expect(result).toMatchObject({
    kind: "result",
    executionState: "completed",
    outcome: { ok: false, error: { code: "PROVIDER_FAILED" } },
  });
  expect(await f.direct({ op: "read" })).toMatchObject({
    exists: true,
    value: "committed-private-record",
  });
  expect(
    f.audit.filter(
      (e) =>
        e.kind === "resource" && e.phase === "allow" && e.operation === "write",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(f.audit)).not.toMatch(
    /private-audit-error|committed-private-record/,
  );
});

it("carries the earlier parent tool policy deadline into a local request inside a longer common task", async () => {
  const f = await fixture({
    localContributionTools: true,
    policy: `if(c.category==='local'&&c.deadline>Date.now()+900000)throw Error('extended-parent-deadline');return decision(c.category==='local'?'confirm':'allow');`,
  });
  expect(
    await f.run({
      op: "write",
      value: "bounded-record",
      common: true,
      timeoutMs: 3600000,
    }),
  ).toMatchObject({ outcome: { ok: true, value: success } });
  expect(await f.direct({ op: "read" })).toMatchObject({
    exists: true,
    value: "bounded-record",
  });
  expect(f.confirm.ask).not.toHaveBeenCalled();
});
