import { afterEach, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { resourceFixture, providerManifest } from "./resource-fixture.js";
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
it("resource policy uses the single existing maximum, preserves CAS and isolates another Agent", async () => {
  const f = await resourceFixture();
  hosts.push(f.host);
  dirs.push(f.dir);
  await addPolicy(f.host, f.a, "allow");
  await addPolicy(f.host, f.a, "deny");
  await select(f.host, f.a, "allow");
  await f.grant(f.a);
  await grant(f.host, f.a);
  const written = (await f.invoke(f.a, {
    op: "write",
    resourceId: f.shared,
    key: "record",
    expectedRevision: "0",
    value: { opaque: "resource-fixture" },
  })) as any;
  expect(written.revision).not.toBe("0");
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "record",
      expectedRevision: "0",
      value: null,
    }),
  ).rejects.toMatchObject({
    details: { reason: "RESOURCE_CONFLICT", executionState: "not_started" },
  });
  await f.grant(f.b, ["task"][0] as any);
  expect(
    await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "record" }),
  ).toMatchObject({ value: { opaque: "resource-fixture" } });
  await select(f.host, f.a, "deny");
  await f.grant(f.a);
  await grant(f.host, f.a);
  await expect(
    f.invoke(f.a, { op: "read", resourceId: f.shared, key: "record" }),
  ).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED", executionState: "not_started" },
  });
  expect(
    await f.invoke(f.b, { op: "read", resourceId: f.shared, key: "record" }),
  ).toMatchObject({ revision: written.revision });
  await select(f.host, f.a, "allow");
  await f.grant(f.a, "task", ["read"]);
  await grant(f.host, f.a);
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "record",
      expectedRevision: written.revision,
      value: null,
    }),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
});
it("policy cannot expand a resource maximum through confirm or extra scope properties", async () => {
  const f = await resourceFixture();
  hosts.push(f.host);
  dirs.push(f.dir);
  await addPolicy(f.host, f.a, "confirm");
  await select(f.host, f.a, "confirm");
  await f.grant(f.a, "task", ["read"]);
  const plan = await f.host.policyPlan(f.a),
    row = plan.available.find((r) => r.category === "resource")!;
  await expect(
    f.host.grantPolicyScope(f.a, plan.fingerprint, 900_000, [
      { ...row, operation: "write" },
    ]),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
  await expect(
    f.host.grantPolicyScope(f.a, plan.fingerprint, 900_000, [
      { ...row, hiddenRoot: "/" } as any,
    ]),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
  await grant(f.host, f.a);
  await expect(
    f.invoke(f.a, {
      op: "write",
      resourceId: f.shared,
      key: "record",
      expectedRevision: "0",
      value: null,
    }),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
});

it("full-access plus policy changes only business qualification and retains other-Agent ownership and selected operations", async () => {
  const f = await resourceFixture();
  hosts.push(f.host);
  dirs.push(f.dir);
  const privateB = (await f.host.resourcePlan(f.b)).spaces.find(
    (s) => s.ownerAgentId === f.b,
  )!;
  await f.host.setResourceBinding(
    f.a,
    (await f.host.resourcePlan(f.a)).fingerprint,
    providerManifest.id,
    "private",
    privateB.id,
  );
  await addPolicy(f.host, f.a, "allow");
  await select(f.host, f.a, "allow");
  await expect(f.grant(f.a, "task")).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED" },
  });
  await expect(
    f.invoke(f.a, { op: "read", resourceId: privateB.id, key: "x" }),
  ).rejects.toBeDefined();
  await f.host.revokePolicyScope(f.a);
  await f.grant(f.a, "full-access", ["read", "write"]);
  await grant(f.host, f.a);
  const written = (await f.invoke(f.a, {
    op: "write",
    resourceId: privateB.id,
    key: "x",
    expectedRevision: "0",
    value: { test: "cross-agent" },
  })) as { revision: string };
  expect(
    await f.invoke(f.b, { op: "read", resourceId: privateB.id, key: "x" }),
  ).toMatchObject({
    revision: written.revision,
    value: { test: "cross-agent" },
  });
  await expect(
    f.invoke(f.a, {
      op: "delete",
      resourceId: privateB.id,
      key: "x",
      expectedRevision: written.revision,
    }),
  ).rejects.toMatchObject({ details: { reason: "NOT_AUTHORIZED" } });
  expect(
    (await f.host.resourcePlan(f.a)).spaces.find((s) => s.id === privateB.id)
      ?.ownerAgentId,
  ).toBe(f.b);
});
