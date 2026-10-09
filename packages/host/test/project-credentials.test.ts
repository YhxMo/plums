import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, lstat, rm } from "node:fs/promises";
import {
  createArchive,
  createCore,
  enginePermissionKey,
  MemorySecretStore,
  RecordingEgressSink,
  type Core,
  type ManifestV2,
} from "@plums/core";
import { LocalAuthorizations } from "../src/local-authorization.js";
import { credentialFragments } from "../src/project-credentials.js";
import type { Session } from "../src/host.js";
const roots: string[] = [],
  cores: Core[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of cores.splice(0)) c.close();
  for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp("/private/tmp/plums-credential-test-");
  roots.push(root);
  const project = root + "/project";
  await mkdir(project);
  const store = new MemorySecretStore(),
    events: unknown[] = [],
    stop = vi.fn(async () => {}),
    confirm = { ask: vi.fn(async () => true) };
  const core = createCore({
    dataDir: root + "/platform",
    instanceId: "fixture-agent",
    secrets: store,
    egress: new RecordingEgressSink(),
  });
  cores.push(core);
  const declarations = [
    {
      id: "npm",
      kind: "npm-token" as const,
      host: "npm.example.test",
      reason: "fixture package download",
    },
    { id: "git", kind: "git-https" as const, host: "git.example.test" },
  ];
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "fixture.credentials",
    name: "Credentials",
    description: "",
    version: "1.0.0",
    dependencies: [],
    permissions: [
      {
        id: "engine",
        kind: "engine",
        target: "local",
        tier: "project",
        network: { hosts: ["npm.example.test", "git.example.test"] },
        credentials: declarations,
        reason: "fixture",
      },
    ],
    payload: {},
  };
  await core.importPackage(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
    }),
  );
  await core.grantConsent(manifest.id);
  await core.enable(manifest.id);
  const installed = (await core.listInstalled())[0]!,
    st = await lstat(project, { bigint: true }),
    component = {
      packageId: manifest.id,
      installedAt: installed.installedAt,
      permissions: enginePermissionKey(manifest.permissions),
    };
  await core.commitLocalAuthorization({
    revision: 0,
    assembly: [component],
    tier: {
      instanceId: "fixture-agent",
      ceiling: "project",
      projects: [
        {
          root: "workspace",
          path: project,
          dev: String(st.dev),
          ino: String(st.ino),
        },
      ],
      readOnly: [],
      components: [component],
    },
    grants: [
      {
        instanceId: "fixture-agent",
        packageId: manifest.id,
        engineId: "local",
        installedAt: installed.installedAt,
        permission: enginePermissionKey(manifest.permissions[0]),
        tier: "project",
        hosts: ["npm.example.test", "git.example.test"],
        toolchains: [],
        configuration: [],
        credentials: [],
        source: "confirmation",
        grantedAt: new Date().toISOString(),
        authorizationId: "original",
      },
    ],
  });
  const session = {
    core,
    secrets: store,
    record: {
      instanceId: "fixture-agent",
      name: "Fixture",
      roots: { workspace: project },
    },
    controller: new AbortController(),
  } as unknown as Session;
  const auth = new LocalAuthorizations({
    dataDir: root + "/platform",
    homeDir: root + "/synthetic-home",
    confirm,
    audit: async (_s, e) => {
      events.push(e);
    },
    secrets: async () => {
      const refs = await core.listSecretReferences();
      return (await Promise.all(refs.map((r) => store.get(r)))).filter(
        (v): v is string => v !== undefined,
      );
    },
    stop,
  });
  const fingerprint = async () => (await auth.plan(session)).fingerprint;
  const provide = async (id: string, value: string, username?: string) =>
    auth.provideCredential(
      session,
      await fingerprint(),
      manifest.id,
      "local",
      id,
      value,
      username,
    );
  return {
    root,
    core,
    store,
    manifest,
    declarations,
    session,
    auth,
    events,
    stop,
    confirm,
    fingerprint,
    provide,
  };
}
it("approves only declared current hosts, stores separate scalar references, stops affected entries and revokes values", async () => {
  const f = await fixture(),
    token = "SYNTHETIC token@with/escaping";
  await f.provide("git", token, "fixture user");
  const state = await f.core.localAuthorizationState(),
    grant = state.grants[0]!,
    credential = grant.credentials[0]!;
  expect(credential.valueRef).toBeTruthy();
  expect(credential.usernameRef).toBeTruthy();
  expect(credential.encodedValueRef).toBeTruthy();
  expect(await f.store.get(credential.valueRef!)).toBe(token);
  expect(
    JSON.stringify([state, await f.auth.plan(f.session), f.events]),
  ).not.toContain(token);
  expect(JSON.stringify(f.events)).not.toContain(f.root);
  expect(f.events).toContainEqual(
    expect.objectContaining({
      reason: "LOCAL_CREDENTIAL_GRANTED",
      localCredential: {
        packageId: f.manifest.id,
        engineId: "local",
        id: "git",
        host: "git.example.test",
      },
    }),
  );
  expect(f.stop.mock.calls[0]![0] === f.session).toBe(true);
  expect(f.stop.mock.calls[0]![1]).toEqual([f.manifest.id]);
  const rendered = await credentialFragments(grant, f.declarations, (r) =>
    f.store.get(r),
  );
  expect(rendered.gitCredentials).toContain(encodeURIComponent(token));
  await expect(
    credentialFragments(grant, [], (r) => f.store.get(r)),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(
    f.core.exportPackage({ manifest: { ...f.manifest, payload: token } }),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await f.auth.revokeCredential(f.session, f.manifest.id, "local", "git");
  expect(
    (await f.core.localAuthorizationState()).grants[0]!.credentials,
  ).toEqual([]);
  expect(await f.store.get(credential.valueRef!)).toBeUndefined();
  expect(f.events).toContainEqual(
    expect.objectContaining({
      reason: "LOCAL_CREDENTIAL_REVOKED",
      localCredential: {
        packageId: f.manifest.id,
        engineId: "local",
        id: "git",
        host: "git.example.test",
      },
    }),
  );
});
it("asks the trusted user with credential kind/host and refuses stale plans or undeclared credentials before writes", async () => {
  const f = await fixture();
  expect(
    await f.auth.askCredential(
      f.session,
      await f.fingerprint(),
      f.manifest.id,
      "local",
      "npm",
    ),
  ).toBe(true);
  expect(f.confirm.ask.mock.calls[0]![0]).toMatchObject({
    message: expect.stringContaining("令牌注入后扩展代码可以读到它"),
  });
  await expect(
    f.auth.provideCredential(
      f.session,
      "stale",
      f.manifest.id,
      "local",
      "npm",
      "SYNTHETIC_TOKEN",
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  await expect(f.provide("missing", "SYNTHETIC_TOKEN")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  await expect(f.provide("npm", "bad\nsyntax")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(await f.core.listSecretReferences()).toEqual([]);
});
it("rolls back a scalar write failure and retains reservation history for restart/uninstall cleanup", async () => {
  const f = await fixture();
  let calls = 0;
  const set = f.store.set.bind(f.store);
  vi.spyOn(f.store, "set").mockImplementation(async (ref, value) => {
    await set(ref, value);
    if (++calls === 2) throw Error("SYNTHETIC_TOKEN");
  });
  const error = await f.provide("npm", "SYNTHETIC_TOKEN").catch((e) => e);
  expect(error).toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { reason: "LOCAL_CREDENTIAL_WRITE_FAILED" },
  });
  expect(JSON.stringify(error)).not.toContain("SYNTHETIC_TOKEN");
  expect(
    (await f.core.localAuthorizationState()).grants[0]!.credentials,
  ).toEqual([]);
  const refs = await f.core.listSecretReferences();
  expect(refs.length).toBe(2);
  expect(await Promise.all(refs.map((r) => f.store.get(r)))).toEqual([
    undefined,
    undefined,
  ]);
  await f.core.uninstall(f.manifest.id);
});
it("deletes staged values after a failed authorization CAS and never expands a changed scope", async () => {
  const f = await fixture();
  vi.spyOn(f.core, "commitLocalAuthorization").mockResolvedValueOnce(false);
  await expect(f.provide("npm", "SYNTHETIC_TOKEN")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(
    (await f.core.localAuthorizationState()).grants[0]!.credentials,
  ).toEqual([]);
  expect(
    (
      await Promise.all(
        (await f.core.listSecretReferences()).map((r) => f.store.get(r)),
      )
    ).every((v) => v === undefined),
  ).toBe(true);
});
it("a deletion failure leaves the credential revoked and retry uninstall clears all retained references", async () => {
  const f = await fixture();
  await f.provide("npm", "SYNTHETIC_TOKEN");
  const refs = await f.core.listSecretReferences(),
    del = f.store.delete.bind(f.store);
  vi.spyOn(f.store, "delete").mockRejectedValueOnce(Error("SYNTHETIC_TOKEN"));
  const error = await f.auth
    .revokeCredential(f.session, f.manifest.id, "local", "npm")
    .catch((e) => e);
  expect(error).toMatchObject({
    code: "SECRET_NOT_FOUND",
    details: { reason: "SECRET_CLEANUP_FAILED" },
  });
  expect(JSON.stringify(error)).not.toContain("SYNTHETIC_TOKEN");
  expect(
    (await f.core.localAuthorizationState()).grants[0]!.credentials,
  ).toEqual([]);
  vi.mocked(f.store.delete).mockImplementation(del);
  await f.core.uninstall(f.manifest.id);
  expect(
    (await Promise.all(refs.map((r) => f.store.get(r)))).every(
      (v) => v === undefined,
    ),
  ).toBe(true);
});
