import { afterEach, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { fixture } from "./common-fixture.js";
import { resourceFixture, providerManifest } from "./resource-fixture.js";
import type { DesktopHost } from "../src/host.js";
const owned: { host: DesktopHost; dir: string }[] = [];
afterEach(async () => {
  for (const f of owned.splice(0)) {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it("keeps default character, protocol choices and component identity while revoking frontend and task leases", async () => {
  const f = await fixture("controlled-node");
  owned.push(f);
  const card = (await f.host.preview(
    Buffer.from('{"name":"Fixture role"}'),
  )) as { token: string };
  const item = await f.host.importLibrary(card.token);
  await f.host.addLibraryComponent(f.a.instanceId, item.digest);
  await f.host.setCharacter(f.a.instanceId, item.manifest.id);
  const old = await f.host.openFrontend(f.a.instanceId);
  expect(old).toBeDefined();
  const scope = await f.host.taskScopePlan(f.a.instanceId);
  await f.host.grantTaskScope(f.a.instanceId, scope.fingerprint, 900000, []);
  const before = (await f.host.listAgents()).find(
    (a) => a.instanceId === f.a.instanceId,
  )!;
  const other = await f.host.foundationStatus(f.b.instanceId);
  const result = await f.host.invoke(
    f.a.instanceId,
    "consumer",
    "consumer",
    "commands",
    "run",
    { value: 1 },
  );
  expect(result).toBeDefined();
  const plan = await f.host.foundationPlan(f.a.instanceId);
  await f.host.switchFoundation(
    f.a.instanceId,
    plan.fingerprint,
    plan.current.selection,
  );
  const after = (await f.host.listAgents()).find(
    (a) => a.instanceId === f.a.instanceId,
  )!;
  expect(after.components).toEqual(before.components);
  expect(after.characterId).toBe(before.characterId);
  expect(after.agent).toEqual(before.agent);
  expect(after.protocolBindings).toEqual(before.protocolBindings);
  expect((await f.host.taskScopePlan(f.a.instanceId)).active).toBeUndefined();
  await expect(
    f.host.frontendCommon(
      old!.context.sessionId,
      old!.context.handle,
      "protocols",
      {},
    ),
  ).rejects.toBeDefined();
  expect(await f.host.foundationStatus(f.b.instanceId)).toEqual(other);
  expect(
    await f.host.invoke(
      f.b.instanceId,
      "consumer",
      "consumer",
      "commands",
      "run",
      { value: 2 },
    ),
  ).toBeDefined();
  expect(
    await f.host.invoke(
      f.a.instanceId,
      "consumer",
      "consumer",
      "commands",
      "run",
      { value: 3 },
    ),
  ).toBeDefined();
});
it("retains resource contents, qualifications and ownership while expiring old handles and scopes", async () => {
  const f = await resourceFixture();
  owned.push(f);
  await f.grant(f.a);
  const saved = await f.invoke(f.a, { op: "remember", resourceId: f.shared });
  await f.invoke(f.a, {
    op: "write",
    resourceId: f.shared,
    key: "retained",
    expectedRevision: "0",
    value: { saved: true },
  });
  const before = await f.host.resourcePlan(f.a),
    binding = await f.host.foundationStatus(f.a),
    other = await f.host.resourcePlan(f.b);
  const plan = await f.host.foundationPlan(f.a);
  await f.host.switchFoundation(f.a, plan.fingerprint, binding.selection);
  const after = await f.host.resourcePlan(f.a);
  expect(after.spaces).toEqual(before.spaces);
  expect(after.bindings).toEqual(before.bindings);
  expect(after.active).toBeUndefined();
  await expect(
    f.invoke(f.a, {
      op: "read",
      resourceId: f.shared,
      key: "retained",
      binding: saved,
    }),
  ).rejects.toBeDefined();
  expect((await f.host.resourcePlan(f.b)).bindings).toEqual(other.bindings);
  await f.grant(f.a);
  expect(
    await f.invoke(f.a, { op: "read", resourceId: f.shared, key: "retained" }),
  ).toMatchObject({ exists: true, value: { saved: true } });
  expect(
    ((await f.host.resources(f.a)) as any).packages.find(
      (p: any) => p.id === providerManifest.id,
    ).enabled,
  ).toBe(true);
});
