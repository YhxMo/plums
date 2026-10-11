import { afterEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { MemorySecretStore, secretRef, type Core } from "@plumsjs/core";
import { makeCore, manifestZip, validManifest } from "./package-helpers.js";
import { InstallStore, SCHEMA_VERSION } from "../src/install/store.js";

const cores: Core[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
});

it("upgrades schema-eight records without changing settings, consent, MCP or secret references", async () => {
  const id = "migration.lifecycle",
    secrets = new MemorySecretStore();
  const { core, dataDir } = makeCore({ secrets });
  cores.push(core);
  const manifest = {
    ...validManifest("connector"),
    id,
    dependencies: [],
    permissions: [
      {
        id: "search",
        level: "read" as const,
        target: "notes",
        reason: "Synthetic",
      },
    ],
    settingsSchema: {
      type: "object" as const,
      properties: {
        token: {
          type: "string" as const,
          "x-secret": true,
          title: "Token",
          description: "Synthetic",
        },
      },
    },
  };
  const bytes = await manifestZip(manifest);
  await core.importPackage(bytes);
  await core.grantConsent(id);
  await core.enable(id);
  await secrets.set(secretRef(id, "token"), "FAKE_MIGRATION_SECRET");
  await core.setSettings(id, { token: secretRef(id, "token") });
  await core.approveMcpTools(id, [
    { name: "search", description: "Synthetic", inputSchema: {} },
  ]);
  const before = {
    installed: await core.listInstalled(),
    consent: await core.getConsent(id),
    mcp: await core.getMcpApprovals(id),
    refs: await core.listSecretReferences(),
    settings: await core.resolveSettings(id),
  };
  core.close();
  const database = new Database(path.join(dataDir, "plums.db"));
  // Synthetic schema-8 fixture; historical schema-6/7 source fixtures run separately.
  database.exec(
    "DROP TABLE lifecycle_operations; ALTER TABLE packages DROP COLUMN installation_id; PRAGMA user_version=8",
  );
  database.close();
  const next = makeCore({ dataDir, secrets }).core;
  cores.push(next);
  expect({
    installed: await next.listInstalled(),
    consent: await next.getConsent(id),
    mcp: await next.getMcpApprovals(id),
    refs: await next.listSecretReferences(),
    settings: await next.resolveSettings(id),
  }).toEqual(before);
  const store = new InstallStore(dataDir);
  const identity = store.installationIdentity(id);
  expect(identity?.installationId).toMatch(/^[a-f0-9-]{36}$/);
  store.close();
  next.close();
  expect((await next.getPackage(id)).installed).toEqual(before.installed[0]);
  expect(store.installationIdentity(id)).toEqual(identity);
  await next.uninstall(id);
  await next.importPackage(bytes);
  expect(store.installationIdentity(id)?.installationId).not.toBe(
    identity?.installationId,
  );
  expect((await next.getPackage(id)).installed).toMatchObject({
    consented: false,
    enabled: false,
  });
  store.close();
  next.close();
  const check = new Database(path.join(dataDir, "plums.db"));
  expect(check.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  check.close();
});
