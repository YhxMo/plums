import { afterEach, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fixture as commonFixture } from "./common-fixture.js";
import { addPolicy, select, grant } from "./policy-fixture.js";
import { DesktopHost } from "../src/host.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(body?: string) {
  const f = await commonFixture(
    "isolate",
    `export function activate(s){s.register('tools','test',async v=>{return s.capability('files',{kind:'fs',operation:'read',path:v.input.path});});s.register('commands','direct',async v=>s.capability('files',{kind:'fs',operation:'read',path:v.path}));}`,
    [
      {
        id: "files",
        kind: "fs",
        target: "agent-data",
        operations: ["read"],
        reason: "Internal fixture file",
      },
    ],
    [{ name: "direct", title: "Direct fixture" }],
  );
  hosts.push(f.host);
  dirs.push(f.dir);
  for (const id of ["allow", "deny", "confirm", "custom"])
    await addPolicy(f.host, f.a.instanceId, id);
  if (body) await addPolicy(f.host, f.a.instanceId, "other", body);
  const files = path.join(f.dir, "instances", f.a.instanceId, "agent-data");
  await mkdir(files, { recursive: true });
  await writeFile(path.join(files, "allowed.txt"), "fixture-file");
  await writeFile(path.join(files, "denied.txt"), "second-file");
  const run = (file = "allowed.txt") =>
    f.host.invoke(f.a.instanceId, "consumer", "consumer", "commands", "run", {
      path: file,
    });
  const direct = (file = "allowed.txt") =>
    f.host.invoke(f.a.instanceId, "provider", "provider", "tools", "test", {
      operation: "read",
      input: { path: file },
    });
  const single = () =>
    f.host.invoke(
      f.a.instanceId,
      "provider",
      "provider",
      "commands",
      "direct",
      { path: "allowed.txt" },
    );
  return { ...f, run, direct, single, files };
}
it("same consumer only changes the fixed policy binding for allow, deny, confirm and custom decisions", async () => {
  const f = await fixture();
  const answers: boolean[] = [],
    messages: string[] = [];
  f.options.confirm.ask = async (request) => {
    messages.push(request.message);
    return answers.shift() ?? true;
  };
  for (const [policy, ok] of [
    ["allow", true],
    ["deny", false],
    ["confirm", true],
    ["custom", true],
  ] as const) {
    await select(f.host, f.a.instanceId, policy);
    await grant(f.host, f.a.instanceId);
    const result = (await f.run()) as any;
    expect(result.outcome.ok).toBe(ok);
    if (ok)
      expect(result.outcome.value.data).toEqual([
        ...Buffer.from("fixture-file"),
      ]);
  }
  expect(
    messages.some(
      (m) =>
        m.includes("策略请求确认") &&
        m.includes("consumer → provider") &&
        m.includes("fs/read"),
    ),
  ).toBe(true);
  expect(((await f.run("denied.txt")) as any).outcome.error.code).toBe(
    "NOT_AUTHORIZED",
  );
  const encoded = JSON.stringify(f.audit);
  expect(encoded).not.toContain("fixture-file");
  expect(encoded).not.toContain("allowed.txt");
  expect(encoded).not.toContain(f.dir);
  expect(
    f.audit.some(
      (e) => e.phase === "policy" && e.assessmentId && e.modeGeneration,
    ),
  ).toBe(true);
});
it("policy allow cannot expand an unselected maximum and selected preference never falls back without a live lease", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "allow");
  await expect(f.direct()).rejects.toMatchObject({
    details: { reason: "POLICY_UNAVAILABLE", executionState: "not_started" },
  });
  await grant(f.host, f.a.instanceId, (row) => row.category === "tool");
  expect(((await f.run()) as any).outcome.error.code).toBe("NOT_AUTHORIZED");
  await expect(f.direct()).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED" },
  });
  await f.host.close();
  const restart = new DesktopHost(f.options);
  hosts.push(restart);
  await restart.initialize();
  expect((await restart.policyPlan(f.a.instanceId)).selected?.providerId).toBe(
    "policy-allow",
  );
  expect((await restart.policyPlan(f.a.instanceId)).active).toBe(null);
  await expect(
    restart.invoke(f.a.instanceId, "provider", "provider", "tools", "test", {
      operation: "read",
      input: { path: "allowed.txt" },
    }),
  ).rejects.toMatchObject({ details: { reason: "POLICY_UNAVAILABLE" } });
});
it.each([
  "return {...decision('allow'),operationFingerprint:'0'.repeat(64)};",
  "return {...decision('allow'),extra:true};",
  "throw Error('private-raw-failure');",
  "await s.capability('files',{kind:'fs',operation:'read',path:'allowed.txt'});return decision('allow');",
])(
  "failed policy confirms a single-use capability and refuses an extra gate: %s",
  async (body) => {
    const f = await fixture(body);
    await select(f.host, f.a.instanceId, "other");
    await grant(f.host, f.a.instanceId);
    let confirmations = 0;
    f.options.confirm.ask = async () => {
      confirmations++;
      return true;
    };
    expect(((await f.single()) as any).data).toEqual([
      ...Buffer.from("fixture-file"),
    ]);
    expect(confirmations).toBe(1);
    expect(
      f.audit.some(
        (e) =>
          e.phase === "policy" &&
          e.outcome === "failed" &&
          e.reason === "POLICY_FAILED",
      ),
    ).toBe(true);
    await expect(f.direct()).rejects.toMatchObject({
      details: { reason: "POLICY_UNAVAILABLE", executionState: "not_started" },
    });
    expect(JSON.stringify(f.audit)).not.toContain("private-raw-failure");
  },
);
it("only boolean true confirms; revocation during trusted confirmation prevents the actual read", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "confirm");
  await grant(f.host, f.a.instanceId);
  f.options.confirm.ask = async () => "true" as any;
  await expect(f.direct()).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED" },
  });
  let entered!: () => void, finish!: (v: boolean) => void;
  const waiting = new Promise<void>((r) => (entered = r));
  f.options.confirm.ask = async () => {
    entered();
    return new Promise<boolean>((r) => (finish = r));
  };
  let reads = 0;
  const read = f.options.fs.read.bind(f.options.fs);
  f.options.fs.read = async (r) => {
    reads++;
    return read(r);
  };
  const call = f.direct();
  void call.catch(() => {});
  await waiting;
  await f.host.revokePolicyScope(f.a.instanceId);
  finish(true);
  await expect(call).rejects.toBeDefined();
  expect(reads).toBe(0);
  expect((await f.host.policyPlan(f.a.instanceId)).active).toBe(null);
});
it("the production ten-second policy timeout falls back to trusted confirmation", async () => {
  const f = await fixture(
    "await new Promise(()=>{});return decision('allow');",
  );
  await select(f.host, f.a.instanceId, "other");
  await grant(f.host, f.a.instanceId);
  let confirmations = 0;
  f.options.confirm.ask = async () => {
    confirmations++;
    return true;
  };
  expect(((await f.single()) as any).data).toEqual([
    ...Buffer.from("fixture-file"),
  ]);
  expect(confirmations).toBe(1);
}, 16000);
it("an asynchronous policy audit cannot preserve a revoked decision", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "allow");
  await grant(f.host, f.a.instanceId);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => (entered = r));
  f.options.audit = async (_id, event) => {
    if (event.phase === "policy" && event.outcome === "allowed") {
      entered();
      await new Promise<void>((r) => (release = r));
    }
  };
  let reads = 0;
  const read = f.options.fs.read.bind(f.options.fs);
  f.options.fs.read = async (r) => {
    reads++;
    return read(r);
  };
  const call = f.direct();
  void call.catch(() => {});
  await waiting;
  const revocation = f.host.revokePolicyScope(f.a.instanceId);
  release();
  await revocation;
  await expect(call).rejects.toBeDefined();
  expect(reads).toBe(0);
});

it("the advertised one-off policy budget also cancels a waiting confirmation before file I/O", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "confirm");
  await grant(f.host, f.a.instanceId);
  // Start both providers before measuring cancellation of a pending confirmation.
  await f.direct();
  let confirmations = 0,
    reads = 0;
  f.options.confirm.ask = async () => {
    confirmations++;
    return new Promise<boolean>(() => {});
  };
  const read = f.options.fs.read.bind(f.options.fs);
  f.options.fs.read = async (r) => {
    reads++;
    return read(r);
  };
  const timeout = AbortSignal.timeout;
  // Accelerate only the production 120s one-off budget, never author configuration.
  const spy = vi
    .spyOn(AbortSignal, "timeout")
    .mockImplementation((ms) => timeout(ms > 119_000 ? 1000 : ms));
  try {
    await expect(f.direct()).rejects.toBeDefined();
    expect(confirmations).toBe(1);
    expect(reads).toBe(0);
  } finally {
    spy.mockRestore();
  }
});
it.runIf(process.platform === "darwin").each(["timer", "status"])(
  "policy lease expiry observed by %s stops its actual controlled instance and task while another Agent continues",
  async (observedBy) => {
    const { createCommonPlatformSdk } = await import("@plums/sdk");
    const f = await commonFixture(
      "controlled-node",
      `export function activate(s){s.register('tools','test',async()=>{await s.emit('ready',{pid:process.pid});await new Promise(()=>{});});}`,
    );
    hosts.push(f.host);
    dirs.push(f.dir);
    await addPolicy(f.host, f.a.instanceId, "allow");
    await select(f.host, f.a.instanceId, "allow");
    const timer = globalThis.setTimeout;
    let expireTimer: (() => void) | undefined;
    // Preserve the production lease; trigger its real timer callback after both instances are ready.
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: any,
      delay: any,
      ...args: any[]
    ) => {
      const handle = timer(fn, delay, ...args);
      if (delay === 900_000 && observedBy === "timer")
        expireTimer = () => {
          clearTimeout(handle);
          timer(fn, 0, ...args);
        };
      return handle;
    }) as any);
    try {
      await grant(f.host, f.a.instanceId);
    } finally {
      spy.mockRestore();
    }
    const front = await f.host.openFrontend(f.b.instanceId);
    if (!front) throw Error();
    const peer = createCommonPlatformSdk(
      (m, a) =>
        f.host.frontendCommon(
          front.context.sessionId,
          front.context.handle,
          m,
          a,
        ),
      f.sdk.resources,
    );
    const frontA = await f.host.openFrontend(f.a.instanceId);
    if (!frontA) throw Error();
    const owner = createCommonPlatformSdk(
      (m, a) =>
        f.host.frontendCommon(
          frontA.context.sessionId,
          frontA.context.handle,
          m,
          a,
        ),
      f.sdk.resources,
    );
    const a = await owner.binding("backend"),
      b = await peer.binding("backend");
    const first = await owner.invoke(a!.handle, "hang", null),
      second = await peer.invoke(b!.handle, "hang", null);
    const ae = await first.events[Symbol.asyncIterator]().next(),
      be = await second.events[Symbol.asyncIterator]().next();
    const ap = (ae.value.data as { pid: number }).pid,
      bp = (be.value.data as { pid: number }).pid;
    expect(ap).not.toBe(bp);
    if (observedBy === "timer") {
      expect(expireTimer).toBeTypeOf("function");
      expireTimer!();
    }
    if (observedBy === "status") {
      // Internal fixture advances only the monotonic expiry; production grant remains 15m.
      (f.host as any).policy.leases.get(f.a.instanceId).expires =
        performance.now() - 1;
      expect((await f.host.policyPlan(f.a.instanceId)).active).toBe(null);
    }
    await expect(first.result).rejects.toBeDefined(); // Expiry also closes this frontend bridge.
    await expect
      .poll(
        async () =>
          (await f.host.commonTasks(f.a.instanceId)).find(
            (t) => t.description.taskId === first.taskId,
          )?.snapshot.status.executionState,
      )
      .toBe("unknown");
    await expect
      .poll(() => {
        try {
          process.kill(ap, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
    expect((await f.host.policyPlan(f.a.instanceId)).active).toBe(null);
    await expect
      .poll(
        async () =>
          (await f.host.commonTasks(f.a.instanceId)).find(
            (t) => t.description.taskId === first.taskId,
          )?.snapshot.status.state,
      )
      .toBe("stopped");
    expect(() => process.kill(bp, 0)).not.toThrow();
    expect((await peer.tasks.status(second.taskId)).status.state).toBe(
      "running",
    );
    await second.cancel();
    await second.result;
    expect(() => process.kill(bp, 0)).toThrow();
  },
  20000,
);

it("renewing after observed expiry waits for the selected component cleanup before approving a new lease", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "allow");
  await grant(f.host, f.a.instanceId);
  expect(((await f.run()) as any).outcome.ok).toBe(true);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => (entered = r)),
    cleanup = new Promise<void>((r) => (release = r));
  const common = (f.host as any).common;
  const stop = common.stopComponents.bind(common);
  const spy = vi
    .spyOn(common, "stopComponents")
    .mockImplementation(async (s: any, packages: any) => {
      entered();
      await cleanup;
      return stop(s, packages);
    });
  try {
    (f.host as any).policy.leases.get(f.a.instanceId).expires =
      performance.now() - 1;
    const plan = await f.host.policyPlan(f.a.instanceId);
    await waiting;
    let approved = false;
    const renewal = f.host
      .grantPolicyScope(
        f.a.instanceId,
        plan.fingerprint,
        900_000,
        plan.available,
      )
      .then((v) => {
        approved = true;
        return v;
      });
    await new Promise<void>((r) => setImmediate(r));
    expect(approved).toBe(false);
    release();
    await renewal;
    expect((await f.host.policyPlan(f.a.instanceId)).active).not.toBe(null);
    expect(((await f.run()) as any).outcome.ok).toBe(true);
  } finally {
    release();
    spy.mockRestore();
  }
});
it("a live lease rejects replacement before an asynchronous plan can turn it into a new approval", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "allow");
  await grant(f.host, f.a.instanceId);
  const plan = await f.host.policyPlan(f.a.instanceId);
  const policy = (f.host as any).policy;
  const settle = policy.settled.bind(policy);
  let waited = false;
  const spy = vi
    .spyOn(policy, "settled")
    .mockImplementation(async (id: any) => {
      waited = true;
      policy.leases.get(id).expires = performance.now() - 1;
      await settle(id);
    });
  try {
    await expect(
      f.host.grantPolicyScope(
        f.a.instanceId,
        plan.fingerprint,
        900_000,
        plan.available,
      ),
    ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
    expect(waited).toBe(false);
    expect((await f.host.policyPlan(f.a.instanceId)).active).not.toBe(null);
  } finally {
    spy.mockRestore();
  }
});

it("host context and automatic audit bind tier, confirmation and provider identity", async () => {
  const f = await fixture(
    "return decision(c.tier==='sandbox'&&c.requiresConfirmation===true?'allow':'deny');",
  );
  const selected = (
    (await f.host.resources(f.a.instanceId)) as any
  ).record.components.find((p: any) => p.packageId === "policy-other");
  await select(f.host, f.a.instanceId, "other");
  await grant(f.host, f.a.instanceId);
  let confirmations = 0;
  f.options.confirm.ask = async () => {
    confirmations++;
    return false;
  };
  expect(((await f.single()) as any).data).toEqual([
    ...Buffer.from("fixture-file"),
  ]);
  expect(confirmations).toBe(0);
  expect(
    f.audit.findLast((e) => e.phase === "policy" && e.outcome === "allowed"),
  ).toMatchObject({
    providerId: "policy-other",
    artifactDigest: selected.digest,
    mode: "other",
    tier: "sandbox",
    reason: "POLICY_ALLOW",
    operationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});
it("a disabled provider falls back for a new single-use request without restoring its lease", async () => {
  const f = await fixture();
  await select(f.host, f.a.instanceId, "allow");
  await grant(f.host, f.a.instanceId);
  await f.host.disable(f.a.instanceId, "policy-allow");
  let confirmations = 0;
  f.options.confirm.ask = async () => {
    confirmations++;
    return true;
  };
  expect(((await f.single()) as any).data).toEqual([
    ...Buffer.from("fixture-file"),
  ]);
  expect(confirmations).toBe(1);
  expect((await f.host.policyPlan(f.a.instanceId)).active).toBe(null);
});
