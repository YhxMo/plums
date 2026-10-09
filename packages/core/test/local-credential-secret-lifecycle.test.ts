import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { InstallStore, SCHEMA_VERSION } from "../src/install/store.js";
import {
  createCore,
  enginePermissionKey,
  MemorySecretStore,
  RecordingEgressSink,
  secretRef,
  type AgentLocalGrant,
  type Core,
  type LocalAuthorizationCommit,
  type ManifestV2,
} from "../src/index.js";

const opened: Core[] = [],
  directories: string[] = [],
  stores: InstallStore[] = [];
afterEach(async () => {
  opened.splice(0).forEach((core) => core.close());
  stores.splice(0).forEach((store) => store.close());
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});

async function multipart(f: Awaited<ReturnType<typeof fixture>>) {
  const selected = f.credentials.map((credential, index) => {
    const prefix = `secret:${f.id}/multipart-${index}/`;
    return {
      ...credential,
      secretRef: prefix + "metadata",
      valueRef: prefix + "value",
      encodedValueRef: prefix + "encoded-value",
      ...(["pip-index-auth", "git-https"].includes(credential.kind)
        ? {
            usernameRef: prefix + "username",
            encodedUsernameRef: prefix + "encoded-username",
          }
        : {}),
    };
  });
  const entries = selected.flatMap((credential) =>
    [
      credential.secretRef,
      credential.valueRef,
      credential.encodedValueRef,
      "usernameRef" in credential ? credential.usernameRef : undefined,
      "encodedUsernameRef" in credential
        ? credential.encodedUsernameRef
        : undefined,
    ]
      .filter((ref): ref is string => typeof ref === "string")
      .map(
        (ref) =>
          [
            ref,
            "SYNTHETIC_PART_" + ref.slice(ref.indexOf("/multipart")),
          ] as const,
      ),
  );
  await Promise.all(entries.map(([ref, value]) => f.secrets.set(ref, value)));
  expect(await f.core.commitLocalAuthorization(await f.plan(selected))).toBe(
    true,
  );
  return { selected, entries };
}

it("protects every local metadata, scalar and escaped value after partial revocation and restart", async () => {
  const f = await fixture(),
    parts = await multipart(f);
  expect(
    await f.core.commitLocalAuthorization(
      await f.plan(parts.selected.slice(1)),
    ),
  ).toBe(true);
  f.reopen();
  expect(new Set(await f.core.getSecretReferences(f.id))).toEqual(
    new Set([
      ...f.credentials.map((c) => c.secretRef),
      ...parts.entries.map(([ref]) => ref),
    ]),
  );
  for (const [, value] of parts.entries) {
    await expect(
      f.core.exportPackage({ manifest: { ...f.manifest, payload: value } }),
    ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    const failure = await f.core
      .getPackageContents(value)
      .catch((error) => error);
    expect(failure).toMatchObject({ code: "PERMISSION_DENIED" });
    expect(JSON.stringify(failure)).not.toContain(value);
    expect(failure.stack).not.toContain(value);
  }
  await f.core.uninstall(f.id);
  expect(
    await Promise.all(parts.entries.map(([ref]) => f.secrets.get(ref))),
  ).toEqual(parts.entries.map(() => undefined));
});

it("keeps still-approved multi-part credentials on unchanged upgrades and deletes only revoked parts", async () => {
  const f = await fixture(),
    parts = await multipart(f);
  await f.core.commitLocalAuthorization(await f.plan(parts.selected.slice(1)));
  await f.core.updatePackage(
    await f.core.exportPackage({
      manifest: { ...f.manifest, version: "1.1.0" },
    }),
  );
  f.reopen();
  expect(
    (await f.core.localAuthorizationState()).grants[0]!.credentials,
  ).toEqual(parts.selected.slice(1));
  for (const [ref, value] of parts.entries)
    expect(await f.secrets.get(ref)).toBe(
      ref.startsWith(`secret:${f.id}/multipart-0/`) ? undefined : value,
    );
});

it("rejects malformed multi-part descriptors before persisting their fields or changing references", async () => {
  const f = await fixture(),
    parts = await multipart(f),
    before = await f.core.localAuthorizationState();
  const refs = await f.core.getSecretReferences(f.id);
  for (const invalid of [
    { valueRef: undefined },
    { valueRef: "secret:other/value" },
    { valueRef: parts.selected[0]!.secretRef },
    { encodedValueRef: "" },
    { encodedValueRef: `secret:${f.id}/bad\nref` },
    { usernameRef: `secret:${f.id}/username` },
    { rawToken: "SYNTHETIC_NEVER_IN_DATABASE" },
  ]) {
    const credential = { ...parts.selected[0]!, ...invalid };
    expect(
      await f.core.commitLocalAuthorization(
        await f.plan([credential as AgentLocalGrant["credentials"][number]]),
      ),
    ).toBe(false);
    expect(await f.core.localAuthorizationState()).toEqual(before);
    expect(await f.core.getSecretReferences(f.id)).toEqual(refs);
  }
  expect(
    (await readFile(path.join(f.dataDir, "plums.db"))).includes(
      Buffer.from("SYNTHETIC_NEVER_IN_DATABASE"),
    ),
  ).toBe(false);
});

it("retains pending references after uninstall and rejects their reuse by a different installation", async () => {
  const f = await fixture(),
    store = new InstallStore(f.dataDir);
  stores.push(store);
  const installedAt = (await f.core.listInstalled())[0]!.installedAt;
  const ref = `secret:${f.id}/pending-unique`,
    value = "SYNTHETIC_LATE_VALUE";
  expect(store.reserveLocalCredentialReferences(f.id, installedAt, [ref])).toBe(
    true,
  );
  await f.core.uninstall(f.id);
  // Model a write completing after package removal: recovery still owns its reference.
  await f.secrets.set(ref, value);
  f.reopen();
  expect(store.listSecretRefs()).toContain(ref);
  await expect(
    f.core.exportPackage({ manifest: { ...f.manifest, payload: value } }),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await f.core.importPackage(
    await f.core.exportPackage({ manifest: f.manifest }),
  );
  const newInstalledAt = (await f.core.listInstalled())[0]!.installedAt;
  expect(newInstalledAt).not.toBe(installedAt);
  expect(
    store.reserveLocalCredentialReferences(f.id, newInstalledAt, [ref]),
  ).toBe(false);
  store.releaseLocalCredentialReferences(f.id, newInstalledAt, [ref]);
  expect(store.listSecretRefs()).toContain(ref);
  await f.secrets.delete(ref);
  store.releaseLocalCredentialReferences(f.id, installedAt, [ref]);
  expect(store.listSecretRefs()).not.toContain(ref);
});

it("rolls back the reference ledger when reservation insertion fails and refuses invalid reservations", async () => {
  const f = await fixture(),
    store = new InstallStore(f.dataDir);
  stores.push(store);
  const installedAt = (await f.core.listInstalled())[0]!.installedAt,
    refs = store.listSecretRefs();
  for (const selection of [
    [],
    ["secret:other/ref"],
    ["secret:" + f.id + "/"],
    Array(81).fill(`secret:${f.id}/many`),
    [`secret:${f.id}/same`, `secret:${f.id}/same`],
  ])
    expect(
      store.reserveLocalCredentialReferences(f.id, installedAt, selection),
    ).toBe(false);
  const db = new Database(path.join(f.dataDir, "plums.db"));
  db.exec(
    "CREATE TRIGGER reservation_failure BEFORE INSERT ON local_credential_reservations BEGIN SELECT RAISE(ABORT, 'synthetic reservation failure'); END",
  );
  db.close();
  expect(() =>
    store.reserveLocalCredentialReferences(f.id, installedAt, [
      `secret:${f.id}/new`,
    ]),
  ).toThrow();
  expect(store.listSecretRefs()).toEqual(refs);
  expect(await f.core.getSecretReferences(f.id)).toEqual(refs);
});

it("migrates schema-7 credential records without changing consent, enabled state or existing authorization", async () => {
  const f = await fixture(),
    parts = await multipart(f),
    before = await f.core.localAuthorizationState();
  f.core.close();
  const db = new Database(path.join(f.dataDir, "plums.db"));
  // Schema-7 records can contain credentials not yet retained in the package ledger.
  db.prepare("UPDATE packages SET secret_refs='[]'").run();
  const original = db.prepare("SELECT * FROM agent_local_grants").all();
  db.exec("DROP TABLE local_credential_reservations; PRAGMA user_version=7");
  db.close();
  f.reopen();
  expect(await f.core.localAuthorizationState()).toEqual(before);
  expect((await f.core.listInstalled())[0]).toMatchObject({
    enabled: true,
    consented: true,
  });
  expect(new Set(await f.core.getSecretReferences(f.id))).toEqual(
    new Set(parts.entries.map(([ref]) => ref)),
  );
  const check = new Database(path.join(f.dataDir, "plums.db"));
  expect(check.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  expect(check.prepare("SELECT * FROM agent_local_grants").all()).toEqual(
    original,
  );
  check.close();
  await f.core.revokeEngineTrust(f.id, "coding");
  f.reopen();
  expect(new Set(await f.core.getSecretReferences(f.id))).toEqual(
    new Set(parts.entries.map(([ref]) => ref)),
  );
  await f.core.uninstall(f.id);
  expect(
    await Promise.all(parts.entries.map(([ref]) => f.secrets.get(ref))),
  ).toEqual(parts.entries.map(() => undefined));
});
async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "plums-credlifecycle-"));
  directories.push(dataDir);
  const secrets = new MemorySecretStore(),
    instanceId = "credential-agent",
    id = "credential-lifecycle",
    host = "pkg.plums-fixture.test";
  const credentials: AgentLocalGrant["credentials"] = [
    "npm-token",
    "cargo-token",
    "pip-index-auth",
    "git-https",
  ].map((kind, index) => ({
    id: "credential-" + index,
    kind: kind as AgentLocalGrant["credentials"][number]["kind"],
    host,
    secretRef: secretRef(id, "local.coding." + index),
  }));
  const permission: Extract<
    ManifestV2["permissions"][number],
    { kind: "engine" }
  > = {
    id: "local",
    kind: "engine",
    target: "coding",
    tier: "project",
    reason: "Synthetic credential regression",
    network: { hosts: [host] },
    credentials: credentials.map(({ id, kind, host }) => ({ id, kind, host })),
  };
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id,
    name: "Synthetic fixture",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [permission],
    payload: {},
  };
  const options = {
    dataDir,
    instanceId,
    secrets,
    egress: new RecordingEgressSink(),
    onAudit: () => {},
  };
  let core = createCore(options);
  opened.push(core);
  await core.importPackage(await core.exportPackage({ manifest }));
  await core.grantConsent(id);
  await core.enable(id);
  const values = credentials.map(
    (_, index) => "SYNTHETIC_LOCAL_CREDENTIAL_" + index,
  );
  await Promise.all(
    credentials.map((credential, index) =>
      secrets.set(credential.secretRef, values[index]!),
    ),
  );
  const plan = async (
    selected = credentials,
  ): Promise<LocalAuthorizationCommit> => {
    const state = await core.localAuthorizationState();
    const directory = await lstat(dataDir, { bigint: true });
    const assembly = await Promise.all(
      (await core.listInstalled()).map(async (installed) => ({
        packageId: installed.id,
        installedAt: installed.installedAt,
        permissions: enginePermissionKey(
          (await core.getPackageContents(installed.id)).manifest.permissions,
        ),
      })),
    );
    return {
      revision: state.revision,
      assembly,
      tier: {
        instanceId,
        ceiling: "project",
        projects: [
          {
            root: "workspace",
            path: dataDir,
            dev: String(directory.dev),
            ino: String(directory.ino),
          },
        ],
        readOnly: [],
        components: assembly,
      },
      grants: [
        {
          instanceId,
          packageId: id,
          engineId: "coding",
          installedAt: assembly[0]!.installedAt,
          permission: enginePermissionKey(permission),
          tier: "project",
          hosts: [host],
          toolchains: [],
          configuration: [],
          credentials: selected,
          grantedAt: "2026-10-09T00:00:00.000Z",
          source: "confirmation",
        },
      ],
    };
  };
  expect(await core.commitLocalAuthorization(await plan())).toBe(true);
  return {
    get core() {
      return core;
    },
    dataDir,
    secrets,
    credentials,
    values,
    manifest,
    permission,
    id,
    plan,
    reopen() {
      core.close();
      core = createCore(options);
      opened.push(core);
      return core;
    },
  };
}
async function expectSafeFailure(
  promise: Promise<unknown>,
  values: string[],
  version: string,
) {
  let error: any;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject({
    code: "SECRET_NOT_FOUND",
    details: { version, reason: "SECRET_CLEANUP_FAILED" },
  });
  expect(error.cause).toBeUndefined();
  expect(error.path).toBeUndefined();
  for (const value of values)
    expect(
      [error.message, error.stack, JSON.stringify(error)].join("\n"),
    ).not.toContain(value);
  return error;
}

it("refuses malformed, foreign, duplicate and raw-valued credentials without altering grant or reference state", async () => {
  const f = await fixture(),
    before = await f.core.localAuthorizationState(),
    references = await f.core.getSecretReferences(f.id);
  const invalid: unknown[][] = [
    [{ ...f.credentials[0], secretRef: undefined }],
    [{ ...f.credentials[0], secretRef: "" }],
    [
      {
        ...f.credentials[0],
        secretRef: "secret:another-component/local.coding.0",
      },
    ],
    [{ ...f.credentials[0], secretRef: secretRef(f.id, "") }],
    [{ ...f.credentials[0], secretRef: secretRef(f.id, "local\ncredential") }],
    [{ ...f.credentials[0], value: "SYNTHETIC_MUST_NOT_BE_PERSISTED" }],
    [f.credentials[0], f.credentials[0]],
  ];
  for (const selected of invalid) {
    expect(
      await f.core.commitLocalAuthorization(
        await f.plan(selected as AgentLocalGrant["credentials"]),
      ),
    ).toBe(false);
    expect(await f.core.localAuthorizationState()).toEqual(before);
    expect(await f.core.getSecretReferences(f.id)).toEqual(references);
  }
  const database = await readFile(path.join(f.dataDir, "plums.db"));
  expect(
    database.includes(Buffer.from("SYNTHETIC_MUST_NOT_BE_PERSISTED")),
  ).toBe(false);
});

it("rolls reference retention back with the complete authorization transaction", async () => {
  const f = await fixture(),
    before = await f.core.localAuthorizationState(),
    refs = await f.core.getSecretReferences(f.id);
  const plan = await f.plan([
    { ...f.credentials[0]!, secretRef: secretRef(f.id, "local.replacement") },
  ]);
  const db = new Database(path.join(f.dataDir, "plums.db"));
  db.exec(
    "CREATE TRIGGER synthetic_credential_failure BEFORE INSERT ON agent_local_grants BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  db.close();
  await expect(f.core.commitLocalAuthorization(plan)).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      phase: "local_authorization_commit",
      executionState: "not_started",
    },
  });
  expect(await f.core.localAuthorizationState()).toEqual(before);
  expect(await f.core.getSecretReferences(f.id)).toEqual(refs);
  f.reopen();
  expect(await f.core.getSecretReferences(f.id)).toEqual(refs);
});

it("retains revoked references across reopen until uninstall deletes their values", async () => {
  const f = await fixture();
  await f.core.revokeEngineTrust(f.id, "coding");
  expect((await f.core.localAuthorizationState()).grants).toEqual([]);
  f.reopen();
  expect(await f.core.getSecretReferences(f.id)).toEqual(
    f.credentials.map((c) => c.secretRef),
  );
  await expect(
    f.core.exportPackage({
      manifest: { ...f.manifest, payload: { sample: f.values[0] } },
    }),
  ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
  await f.core.uninstall(f.id);
  expect(
    await Promise.all(f.credentials.map((c) => f.secrets.get(c.secretRef))),
  ).toEqual([undefined, undefined, undefined, undefined]);
});

it.each([false, true])(
  "preserves historical local references when update deletion fails afterDeleting=%s and retries at a higher version",
  async (afterDeleting) => {
    const f = await fixture(),
      original = f.secrets.delete.bind(f.secrets),
      deleted: string[] = [];
    f.secrets.delete = async (ref) => {
      deleted.push(ref);
      if (afterDeleting) await original(ref);
      throw new Error("Synthetic delete failed " + f.values[0]);
    };
    const next = {
      ...f.manifest,
      version: "1.1.0",
      permissions: [{ ...f.permission, credentials: [] }],
    };
    await expectSafeFailure(
      f.core.updatePackage(await f.core.exportPackage({ manifest: next }), {
        consent: true,
      }),
      f.values,
      "1.1.0",
    );
    expect(new Set(deleted)).toEqual(
      new Set(f.credentials.map((c) => c.secretRef)),
    );
    expect((await f.core.listInstalled())[0]!.version).toBe("1.1.0");
    expect((await f.core.localAuthorizationState()).grants).toEqual([]);
    f.reopen();
    expect(await f.core.getSecretReferences(f.id)).toEqual(
      f.credentials.map((c) => c.secretRef),
    );
    expect(
      await Promise.all(f.credentials.map((c) => f.secrets.get(c.secretRef))),
    ).toEqual(
      afterDeleting ? [undefined, undefined, undefined, undefined] : f.values,
    );
    if (!afterDeleting)
      await expect(
        f.core.exportPackage({ manifest: { ...next, payload: f.values[0] } }),
      ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    const installedVersion = (await f.core.listInstalled())[0]!.version;
    await expect(
      f.core.updatePackage(await f.core.exportPackage({ manifest: next }), {
        consent: true,
      }),
    ).rejects.toMatchObject({ code: "IMPORT_INVALID" });
    expect((await f.core.listInstalled())[0]!.version).toBe(installedVersion);
    f.secrets.delete = original;
    await f.core.updatePackage(
      await f.core.exportPackage({ manifest: { ...next, version: "1.2.0" } }),
    );
    expect(
      await Promise.all(f.credentials.map((c) => f.secrets.get(c.secretRef))),
    ).toEqual([undefined, undefined, undefined, undefined]);
  },
);

it("waits for all local deletions and preserves the install for restart retry when uninstall fails", async () => {
  const f = await fixture(),
    original = f.secrets.delete.bind(f.secrets),
    gates = new Map<string, { resolve(): void; reject(error: Error): void }>();
  f.secrets.delete = (ref) =>
    new Promise<void>((resolve, reject) => gates.set(ref, { resolve, reject }));
  let settled = false;
  const removing = f.core.uninstall(f.id).then(
    () => {
      settled = true;
      return { success: true };
    },
    (error) => {
      settled = true;
      return { error };
    },
  );
  await expect.poll(() => gates.size).toBe(4);
  gates
    .get(f.credentials[0]!.secretRef)!
    .reject(new Error("Synthetic deletion failure " + f.values[0]));
  await Promise.resolve();
  expect(settled).toBe(false);
  expect((await f.core.listInstalled())[0]!.id).toBe(f.id);
  for (const credential of f.credentials.slice(1))
    gates.get(credential.secretRef)!.resolve();
  const result = await removing;
  expect(result).toMatchObject({
    error: {
      code: "SECRET_NOT_FOUND",
      details: { version: "1.0.0", reason: "SECRET_CLEANUP_FAILED" },
    },
  });
  expect(JSON.stringify(result)).not.toContain(f.values[0]);
  f.secrets.delete = original;
  f.reopen();
  expect(await f.core.getSecretReferences(f.id)).toEqual(
    f.credentials.map((c) => c.secretRef),
  );
  await f.core.uninstall(f.id);
  expect(await f.core.listInstalled()).toEqual([]);
  expect(
    await Promise.all(f.credentials.map((c) => f.secrets.get(c.secretRef))),
  ).toEqual([undefined, undefined, undefined, undefined]);
});
