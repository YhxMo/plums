import { it, expect, afterEach, vi } from "vitest";
import { DesktopHost } from "../src/host.js";
import {
  resourceFixture,
  allOps,
  providerManifest,
} from "./resource-fixture.js";
import { rm, stat } from "node:fs/promises";
import { fork } from "node:child_process";
import path from "node:path";
import { once } from "node:events";
const fixtures: Awaited<ReturnType<typeof resourceFixture>>[] = [];
const fixture = async (extra: Parameters<typeof resourceFixture>[0] = {}) => {
  const f = await resourceFixture(extra);
  fixtures.push(f);
  return f;
};
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it("runs the identical immutable artifact concurrently in two Agents with shared visibility and private ownership", async () => {
  const f = await fixture();
  await f.grant(f.a);
  await f.grant(f.b);
  const privateA = (await f.host.resourcePlan(f.a)).spaces.find(
    (s) => s.ownerAgentId === f.a,
  )!.id;
  const privateB = (await f.host.resourcePlan(f.b)).spaces.find(
    (s) => s.ownerAgentId === f.b,
  )!.id;
  const shared = await f.invoke(f.a, {
    op: "write",
    resourceId: f.shared,
    key: "records",
    expectedRevision: "0",
    value: { opaque: ["a", null] },
  });
  expect(
    await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "records" }),
  ).toEqual({
    exists: true,
    ...(shared as object),
    value: { opaque: ["a", null] },
  });
  await Promise.all([
    f.invoke(f.a, {
      op: "write",
      resourceId: privateA,
      key: "same",
      expectedRevision: "0",
      value: "A",
    }),
    f.invoke(f.b, {
      op: "write",
      resourceId: privateB,
      key: "same",
      expectedRevision: "0",
      value: "B",
    }),
  ]);
  expect(
    await f.invoke(f.a, { op: "read", resourceId: privateA, key: "same" }),
  ).toMatchObject({ value: "A" });
  expect(
    await f.invoke(f.b, { op: "read", resourceId: privateB, key: "same" }),
  ).toMatchObject({ value: "B" });
  const records = await f.host.listAgents();
  expect(records.map((r) => r.components?.[0]?.digest)).toEqual([
    f.artifact.digest,
    f.artifact.digest,
  ]);
  const privateHandle = await f.invoke(f.a, {
    op: "remember",
    resourceId: privateA,
  });
  await expect(
    f.invoke(f.b, {
      op: "read",
      binding: privateHandle,
      key: "same",
      agentId: f.a,
      namespace: "shared",
      fullAccess: true,
    }),
  ).rejects.toMatchObject({
    details: { reason: "STALE_BINDING", executionState: "not_started" },
  });
  await f.host.stopSession(f.a);
  expect(
    await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "records" }),
  ).toMatchObject({ exists: true });
  expect(
    (await stat(path.join(f.dir, "business-resources/resources.db"))).mode &
      0o777,
  ).toBe(0o600);
});
it("separately intersects Agent and component qualifications, exact operations, declarations and finite scopes", async () => {
  const f = await fixture();
  for (const component of ["", providerManifest.id]) {
    await f.host.setResourceQualification(
      f.a,
      (await f.host.resourcePlan(f.a)).fingerprint,
      f.shared,
      component,
      ["write"],
    );
    const list = (await f.invoke(f.a, { op: "list" })) as {
      resourceId: string;
      operations: string[];
    }[];
    expect(list.find((r) => r.resourceId === f.shared)?.operations).toEqual([
      "write",
    ]);
    await expect(
      f.invoke(f.a, { op: "read", resourceId: f.shared, key: "x" }),
    ).rejects.toBeDefined();
    await expect(
      f.invoke(f.a, {
        op: "delete",
        resourceId: f.shared,
        key: "x",
        expectedRevision: "0",
      }),
    ).rejects.toBeDefined();
    await f.host.setResourceQualification(
      f.a,
      (await f.host.resourcePlan(f.a)).fingerprint,
      f.shared,
      component,
      allOps,
    );
  }
  await f.grant(f.a, "task", ["read"]);
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "x",
      expectedRevision: "0",
      value: "forbidden",
    }),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
  await f.host.revokeResourceRange(f.a);
  const snapshot = await f.invoke(f.a, {
    op: "read",
    resourceId: f.shared,
    key: "x",
  });
  expect(snapshot).toEqual({ exists: false, revision: "0" });
});
it("uses one trusted full-access range for other-Agent business resources and retains ownership", async () => {
  const f = await fixture(),
    privateB = (await f.host.resourcePlan(f.b)).spaces.find(
      (s) => s.ownerAgentId === f.b,
    )!;
  await f.host.setResourceBinding(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    providerManifest.id,
    "private",
    privateB.id,
  );
  await expect(
    f.invoke(f.a, {
      op: "read",
      resourceId: privateB.id,
      key: "x",
      fullAccess: true,
    }),
  ).rejects.toBeDefined();
  await f.grant(f.a, "full-access");
  const written = (await f.invoke(f.a, {
    op: "write",
    resourceId: privateB.id,
    key: "x",
    expectedRevision: "0",
    value: null,
  })) as { revision: string };
  expect(
    await f.invoke(f.b, { op: "read", resourceId: privateB.id, key: "x" }),
  ).toEqual({ exists: true, ...written, value: null });
  const deleted = (await f.invoke(f.a, {
    op: "delete",
    resourceId: privateB.id,
    key: "x",
    expectedRevision: written.revision,
  })) as { revision: string };
  expect(
    await f.invoke(f.b, { op: "read", resourceId: privateB.id, key: "x" }),
  ).toEqual({ exists: false, ...deleted });
  expect(
    (await f.host.resourcePlan(f.a)).spaces.find((s) => s.id === privateB.id)
      ?.ownerAgentId,
  ).toBe(f.b);
  await f.host.revokeResourceRange(f.a);
  await expect(
    f.invoke(f.a, { op: "read", resourceId: privateB.id, key: "x" }),
  ).rejects.toBeDefined();
});
it("rejects stale handles, preserves referenced spaces, and does not reset content on rebind", async () => {
  const f = await fixture();
  const handle = await f.invoke(f.a, { op: "remember", resourceId: f.shared });
  await f.host.setResourceBinding(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    providerManifest.id,
    "shared",
    f.shared,
  );
  await expect(
    f.invoke(f.a, { op: "read", binding: handle, key: "x" }),
  ).rejects.toMatchObject({ details: { reason: "STALE_BINDING" } });
  await expect(
    f.host.removeResourceGroup(
      f.a,
      (await f.host.resourcePlan(f.a)).fingerprint,
      f.shared,
    ),
  ).rejects.toBeDefined();
  await f.host.setResourceBinding(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    providerManifest.id,
    "shared",
  );
  await f.grant(f.b);
  await f.invoke(f.b, {
    op: "write",
    resourceId: f.shared,
    key: "x",
    expectedRevision: "0",
    value: "survives",
  });
  await f.host.stopSession(f.a);
  expect(
    await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "x" }),
  ).toMatchObject({ value: "survives" });
});
it("reports one winner for same-process CAS and prevents tombstone ABA after restart", async () => {
  const f = await fixture();
  await f.grant(f.a);
  await f.grant(f.b);
  const results = await Promise.allSettled([
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "race",
      expectedRevision: "0",
      value: "A",
    }),
    f.invoke(f.b, {
      op: "write",
      resourceId: f.shared,
      key: "race",
      expectedRevision: "0",
      value: "B",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { details: { reason: "RESOURCE_CONFLICT" } },
  });
  const v = (await f.invoke(f.b, {
    op: "read",
    resourceId: f.shared,
    key: "race",
  })) as { revision: string };
  const tombstone = (await f.invoke(f.b, {
    op: "delete",
    resourceId: f.shared,
    key: "race",
    expectedRevision: v.revision,
  })) as { revision: string };
  await f.host.close();
  const reopened = new DesktopHost(f.options);
  f.host = reopened;
  await reopened.initialize();
  expect((await reopened.resourcePlan(f.b)).active).toBeUndefined();
  const invoke = (input: unknown) =>
    reopened.invoke(
      f.b,
      providerManifest.id,
      providerManifest.id,
      "commands",
      "records",
      input,
    );
  expect(
    await invoke({ op: "read", resourceId: f.shared, key: "race" }),
  ).toEqual({ exists: false, ...tombstone });
  await expect(
    invoke({
      op: "write",
      resourceId: f.shared,
      key: "race",
      expectedRevision: "0",
      value: "lost",
    }),
  ).rejects.toMatchObject({ details: { reason: "RESOURCE_CONFLICT" } });
});
it.each(["before-commit", "after-commit"] as const)(
  "recovers %s faults without falsely reporting retry-safe writes",
  async (phase) => {
    let fail = false;
    const f = await fixture({
      resourceCommitFault: (p) => {
        if (fail && p === phase) {
          fail = false;
          throw Error("synthetic private body");
        }
      },
    });
    await f.grant(f.a);
    fail = true;
    await expect(
      f.invoke(f.a, {
        op: "write",
        resourceId: f.shared,
        key: "fault",
        expectedRevision: "0",
        value: "committed",
      }),
    ).rejects.toMatchObject({
      details: {
        executionState: phase === "before-commit" ? "not_started" : "unknown",
        callId: expect.any(String),
      },
    });
    await f.host.close();
    f.host = new DesktopHost(f.options);
    await f.host.initialize();
    expect(
      await f.host.invoke(
        f.a,
        providerManifest.id,
        providerManifest.id,
        "commands",
        "records",
        { op: "read", resourceId: f.shared, key: "fault" },
      ),
    ).toMatchObject(
      phase === "before-commit"
        ? { exists: false, revision: "0" }
        : { exists: true, value: "committed" },
    );
    expect(JSON.stringify(await f.host.audit(f.a))).not.toContain(
      "synthetic private body",
    );
  },
);
function child(
  f: Awaited<ReturnType<typeof fixture>>,
  agentId: string,
  phase?: string,
) {
  const p = fork(
    path.join(process.cwd(), "packages/host/test/resource-child.mjs"),
    [],
    {
      execArgv: [],
      env: {
        PLUMS_FIXTURE_DIR: f.dir,
        PLUMS_FIXTURE_AGENT: agentId,
        PLUMS_FIXTURE_RESOURCE: f.shared,
        ...(phase === "audit-wait"
          ? { PLUMS_FIXTURE_AUDIT_WAIT: "1" }
          : phase
            ? { PLUMS_FIXTURE_FAULT: phase }
            : {}),
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  return p;
}
it("competes through two real SDK/host child processes with WAL CAS, then survives one consumer exiting", async () => {
  const f = await fixture();
  await f.host.close();
  const a = child(f, f.a),
    b = child(f, f.b);
  try {
    await Promise.all([once(a, "message"), once(b, "message")]);
    const responses = [once(a, "message"), once(b, "message")];
    a.send({ key: "process-race" });
    b.send({ key: "process-race" });
    const results = (await Promise.all(responses)).map((r) => r[0]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      reason: "RESOURCE_CONFLICT",
      executionState: "not_started",
    });
    a.send({ close: true });
    await once(a, "exit");
    const read = once(b, "message");
    b.send({ read: true, key: "process-race" });
    expect((await read)[0]).toMatchObject({
      ok: true,
      value: { exists: true },
    });
  } finally {
    a.kill();
    b.kill();
    await Promise.all([
      a.exitCode !== null ? Promise.resolve() : once(a, "exit"),
      b.exitCode !== null ? Promise.resolve() : once(b, "exit"),
    ]);
  }
});
it.each(["before-commit", "after-commit"])(
  "recovers an actual process crash at %s",
  async (phase) => {
    const f = await fixture();
    await f.host.close();
    const p = child(f, f.a, phase);
    await once(p, "message");
    const exited = once(p, "exit");
    p.send({ key: "crash" });
    expect((await exited)[0]).toBe(73);
    f.host = new DesktopHost(f.options);
    await f.host.initialize();
    expect(
      await f.host.invoke(
        f.b,
        providerManifest.id,
        providerManifest.id,
        "commands",
        "records",
        { op: "read", resourceId: f.shared, key: "crash" },
      ),
    ).toMatchObject(
      phase === "before-commit"
        ? { exists: false, revision: "0" }
        : { exists: true },
    );
  },
);
it("intersects the full real SDK caller chain and cannot enlarge a caller's resource declaration", async () => {
  const f = await fixture();
  const { createArchive } = await import("@plums/core");
  const manifest = {
    ...providerManifest,
    id: "records-consumer",
    name: "Consumer fixture",
    dependencies: [
      { id: providerManifest.id, kind: "extension", range: "^1.0.0" },
    ],
    permissions: [
      {
        kind: "resource",
        id: "read-records",
        target: "business",
        reason: "Read records",
        operations: ["read"],
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        common: {
          commonVersion: "1.0",
          features: ["resources-cas"],
          runtime: "isolate",
          resources: [
            {
              id: "caller-records",
              permissionId: "read-records",
              operations: ["read"],
            },
          ],
        },
        contributes: {
          commands: [{ name: "through", title: "Through provider" }],
        },
      },
    },
  };
  const preview = (await f.host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "main.js": Buffer.from(
        `export function activate(s){s.register('commands','through',i=>s.invoke('records-provider','commands','records',i));}`,
      ),
    }),
  )) as { token: string };
  const artifact = await f.host.importLibrary(preview.token);
  await f.host.addLibraryComponent(f.a, artifact.digest);
  await f.host.enable(f.a, "records-consumer");
  await f.host.setResourceQualification(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    f.shared,
    "records-consumer",
    ["read"],
  );
  await f.host.setResourceBinding(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    "records-consumer",
    "caller-records",
    f.shared,
  );
  const through = (input: unknown) =>
    f.host.invoke(
      f.a,
      "records-consumer",
      "records-consumer",
      "commands",
      "through",
      input,
    );
  expect(
    await through({ op: "read", resourceId: f.shared, key: "chain" }),
  ).toEqual({ exists: false, revision: "0" });
  await f.host.grantResourceRange(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    "full-access",
    900_000,
    [
      {
        componentId: providerManifest.id,
        resourceId: f.shared,
        operations: allOps,
      },
      {
        componentId: "records-consumer",
        resourceId: f.shared,
        operations: ["read"],
      },
    ],
  );
  expect(
    await through({ op: "read", resourceId: f.shared, key: "chain" }),
  ).toEqual({ exists: false, revision: "0" });
  await expect(
    through({
      op: "write",
      resourceId: f.shared,
      key: "chain",
      expectedRevision: "0",
      value: "caller-bypass",
    }),
  ).rejects.toBeDefined();
  expect(
    await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "chain" }),
  ).toEqual({ exists: false, revision: "0" });
  await f.host.setResourceQualification(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    f.shared,
    "records-consumer",
    [],
  );
  await expect(
    through({ op: "read", resourceId: f.shared, key: "chain" }),
  ).rejects.toBeDefined();
});
it.each(["qualification", "binding", "range", "disable"])(
  "blocks writes revoked during asynchronous allow audit by %s",
  async (change) => {
    let release: () => void = () => {},
      entered: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r)),
      waiting = new Promise<void>((r) => (entered = r));
    let hold = false;
    const events: any[] = [];
    const f = await fixture({
      audit: async (_id, event) => {
        events.push(event);
        if (hold && event.kind === "resource" && event.phase === "allow") {
          entered();
          await gate;
        }
      },
    });
    await f.grant(f.a);
    hold = true;
    const request = f
      .invoke(f.a, {
        op: "write",
        resourceId: f.shared,
        key: "wait",
        expectedRevision: "0",
        value: "uncommitted-private-content",
      })
      .catch((e) => e);
    await waiting;
    if (change === "qualification")
      await f.host.setResourceQualification(
        f.a,
        (await f.host.resourcePlan(f.a)).fingerprint,
        f.shared,
        providerManifest.id,
        [],
      );
    if (change === "binding")
      await f.host.setResourceBinding(
        f.a,
        (await f.host.resourcePlan(f.a)).fingerprint,
        providerManifest.id,
        "shared",
      );
    if (change === "range") await f.host.revokeResourceRange(f.a);
    if (change === "disable") await f.host.disable(f.a, providerManifest.id);
    hold = false;
    release();
    expect(await request).toBeInstanceOf(Error);
    expect(
      await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "wait" }),
    ).toEqual({ exists: false, revision: "0" });
    expect(events.every((e) => Object.isFrozen(e))).toBe(true);
    expect(
      events
        .filter((e) => e.callerIds)
        .every((e) => Object.isFrozen(e.callerIds)),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("uncommitted-private-content");
    expect(JSON.stringify(events)).not.toContain(f.dir);
  },
);
it.each(["false", "nonboolean", "throw"])(
  "fails closed for %s single-use confirmation",
  async (answer) => {
    const confirm = {
      ask: vi.fn(async () => {
        if (answer === "throw") throw Error("private-confirm-failure");
        return (answer === "nonboolean" ? "yes" : false) as boolean;
      }),
    };
    const f = await fixture({ confirm });
    await expect(
      f.invoke(f.a, {
        op: "write",
        resourceId: f.shared,
        key: "confirm",
        expectedRevision: "0",
        value: "refused",
      }),
    ).rejects.toMatchObject({ details: { executionState: "not_started" } });
    confirm.ask.mockResolvedValue(true);
    expect(
      await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "confirm" }),
    ).toEqual({ exists: false, revision: "0" });
  },
);
it.each(["allow", "result"])(
  "preserves execution state when %s audit fails",
  async (phase) => {
    let fail = false;
    const f = await fixture({
      audit: async (_id, event) => {
        if (fail && event.phase === phase) {
          fail = false;
          throw Error("private audit failure");
        }
      },
    });
    await f.grant(f.a);
    fail = true;
    await expect(
      f.invoke(f.a, {
        op: "write",
        resourceId: f.shared,
        key: "audit",
        expectedRevision: "0",
        value: "opaque value",
      }),
    ).rejects.toMatchObject({
      details: {
        executionState: phase === "allow" ? "not_started" : "completed",
      },
    });
    expect(
      await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "audit" }),
    ).toMatchObject(
      phase === "allow"
        ? { exists: false, revision: "0" }
        : { exists: true, value: "opaque value" },
    );
  },
);
it("expires resource ranges on the monotonic clock and rejects malformed keys without exposing rejected content", async () => {
  const f = await fixture();
  await f.grant(f.a);
  const now = performance.now();
  vi.spyOn(performance, "now").mockReturnValue(now + 900_001);
  f.options.confirm.ask = async () => false;
  try {
    await expect(
      f.invoke(f.a, {
        op: "write",
        resourceId: f.shared,
        key: "expired",
        expectedRevision: "0",
        value: "rejected",
      }),
    ).rejects.toMatchObject({ details: { executionState: "not_started" } });
  } finally {
    vi.restoreAllMocks();
  }
  f.options.confirm.ask = async () => true;
  for (const key of ["x\0y", "界".repeat(86)])
    await expect(
      f.invoke(f.a, {
        op: "write",
        resourceId: f.shared,
        key,
        expectedRevision: "0",
        value: "rejected",
      }),
    ).rejects.toMatchObject({ details: { reason: "INVALID_REQUEST" } });
  expect(JSON.stringify(await f.host.audit(f.a))).not.toContain("rejected");
});

it("rechecks cross-process qualification revocation after a real asynchronous audit wait", async () => {
  const f = await fixture();
  const p = child(f, f.a, "audit-wait");
  try {
    await once(p, "message");
    const waiting = once(p, "message");
    p.send({ key: "external-revoke" });
    expect((await waiting)[0]).toMatchObject({ auditWait: true });
    await f.host.setResourceQualification(
      f.a,
      (await f.host.resourcePlan(f.a)).fingerprint,
      f.shared,
      providerManifest.id,
      [],
    );
    const result = once(p, "message");
    p.send({ resume: true });
    expect((await result)[0]).toMatchObject({
      ok: false,
      executionState: "not_started",
    });
    expect(
      await f.invoke(f.b, {
        op: "read",
        resourceId: f.shared,
        key: "external-revoke",
      }),
    ).toEqual({ exists: false, revision: "0" });
  } finally {
    p.kill();
    if (p.exitCode === null) await once(p, "exit");
  }
});

it("snapshots finite resource JSON before SDK transport without coercing invalid values", async () => {
  const f = await fixture();
  await f.grant(f.a);
  for (const variant of ["nan", "accessor", "undefined"]) {
    expect(
      await f.invoke(f.a, {
        op: "invalid",
        resourceId: f.shared,
        key: "invalid",
        variant,
      }),
    ).toEqual({ blocked: true, code: "INVALID_REQUEST" });
  }
  expect(
    await f.invoke(f.a, { op: "read", resourceId: f.shared, key: "invalid" }),
  ).toEqual({ exists: false, revision: "0" });
  expect(
    await f.invoke(f.a, { op: "copy", resourceId: f.shared, key: "snapshot" }),
  ).toMatchObject({ value: { state: "before" } });
});
