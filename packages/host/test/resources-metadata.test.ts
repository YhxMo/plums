import { it, expect, afterEach } from "vitest";
import { resourceFixture } from "./resource-fixture.js";
import { fork } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { rm } from "node:fs/promises";
let current: Awaited<ReturnType<typeof resourceFixture>> | undefined;
const fixture = async (extra: Parameters<typeof resourceFixture>[0]) =>
  (current = await resourceFixture(extra));
afterEach(async () => {
  if (current) {
    await current.host.close();
    await rm(current.dir, { recursive: true, force: true });
    current = undefined;
  }
});
it("keeps configured bindings through enable while renewing handles and protects explicit revoke audit failures", async () => {
  let failAudit = false;
  const f = await fixture({
    audit: async (_id, event) => {
      if (failAudit && event.phase === "revoke")
        throw Error("private bottom-level audit error");
    },
  });
  await f.host.disable(f.a, "records-provider");
  const disabledPlan = await f.host.resourcePlan(f.a);
  await f.host.setResourceBinding(
    f.a,
    disabledPlan.fingerprint,
    "records-provider",
    "shared",
    f.shared,
  );
  const installation = (await f.host.resourcePlan(f.a)).bindings.find(
    (b) => b.requirementId === "shared",
  )!.installation;
  await f.host.enable(f.a, "records-provider");
  expect(
    (await f.host.resourcePlan(f.a)).requirements.find(
      (r) => r.id === "shared",
    )!.installation,
  ).toBe(installation);
  await f.grant(f.a);
  expect(
    await f.invoke(f.a, { op: "read", resourceId: f.shared, key: "enabled" }),
  ).toMatchObject({ exists: false, revision: "0" });
  failAudit = true;
  await expect(f.host.revokeResourceRange(f.a)).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      reason: "PROVIDER_FAILED",
      phase: "revoke",
      executionState: "not_started",
    },
  });
  expect((await f.host.resourcePlan(f.a)).active).toBeUndefined();
});
it("blocks a stale cross-process request after disable and re-enable during allow audit", async () => {
  const f = await fixture({});
  const p = fork(
    path.join(process.cwd(), "packages/host/test/resource-child.mjs"),
    [],
    {
      execArgv: [],
      env: {
        PLUMS_FIXTURE_DIR: f.dir,
        PLUMS_FIXTURE_AGENT: f.a,
        PLUMS_FIXTURE_RESOURCE: f.shared,
        PLUMS_FIXTURE_AUDIT_WAIT: "1",
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  try {
    await once(p, "message");
    const waiting = once(p, "message");
    p.send({ key: "external-state-aba" });
    expect((await waiting)[0]).toMatchObject({ auditWait: true });
    await f.host.disable(f.a, "records-provider");
    await f.host.enable(f.a, "records-provider");
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
        key: "external-state-aba",
      }),
    ).toEqual({ exists: false, revision: "0" });
  } finally {
    p.kill();
    if (p.exitCode === null) await once(p, "exit");
  }
});

it("never revives a saved cross-process handle or resource range after disable and re-enable", async () => {
  const f = await fixture({});
  const p = fork(
    path.join(process.cwd(), "packages/host/test/resource-child.mjs"),
    [],
    {
      execArgv: [],
      env: {
        PLUMS_FIXTURE_DIR: f.dir,
        PLUMS_FIXTURE_AGENT: f.a,
        PLUMS_FIXTURE_RESOURCE: f.shared,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const send = async (message: object) => {
    const answer = once(p, "message");
    p.send(message);
    return (await answer)[0] as any;
  };
  try {
    await once(p, "message");
    const remembered = await send({
      input: { op: "remember", resourceId: f.shared },
    });
    expect(remembered.ok).toBe(true);
    await f.host.disable(f.a, "records-provider");
    await f.host.enable(f.a, "records-provider");
    expect(
      await send({ input: { op: "read", saved: true, key: "old-handle" } }),
    ).toMatchObject({
      ok: false,
      reason: "STALE_BINDING",
      executionState: "not_started",
    });
    expect(await send({ plan: true })).toEqual({ ok: true });
    const refreshed = await send({
      input: { op: "remember", resourceId: f.shared },
    });
    expect(refreshed.ok).toBe(true);
    expect(refreshed.value).not.toBe(remembered.value);
    expect(
      await send({
        input: { op: "read", binding: remembered.value, key: "old-handle" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "STALE_BINDING",
      executionState: "not_started",
    });
    expect(
      await send({ input: { op: "read", saved: true, key: "old-handle" } }),
    ).toMatchObject({ ok: true, value: { exists: false, revision: "0" } });
  } finally {
    p.kill();
    if (p.exitCode === null) await once(p, "exit");
  }
});
