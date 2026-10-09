import { afterEach, expect, it, vi } from "vitest";
import type {
  AgentLocalGrant,
  LocalAuthorizationState,
  AuditEvent,
  Confirm,
} from "@plums/core";
import type { TierPlan } from "../../src/local-authorization.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createCommonPlatformSdk, desktopContribution } from "@plums/sdk";
import { addPolicy, select, grant } from "../policy-fixture.js";
import { fixtureManifest, packExtension } from "../fixtures/extensions/pack.js";
import { chatFixture, reply } from "./chat-fixture.js";
import { MACHINE_AUTHORIZATION_COPY } from "../../src/local-authorization.js";

const native = process.platform === "darwin" && process.arch === "arm64";
const Database = createRequire(
  new URL("../../../core/package.json", import.meta.url),
)("better-sqlite3");
const fixtures: Awaited<ReturnType<typeof chatFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.close();
});
async function fixture() {
  const confirm = {
    ask: vi.fn(async (_request: Parameters<Confirm["ask"]>[0]) => true),
  };
  const f = await chatFixture(undefined, undefined, { confirm });
  fixtures.push(f);
  for (const name of ["machine-probe", "machine-probe-b"])
    f.artifacts.set(name, await f.put(await packExtension(name)));
  const agent = await f.create([
    "model-fake",
    "agent-loop",
    "memory",
    "machine-probe",
    "machine-probe-b",
  ]);
  const id = agent.instanceId;
  confirm.ask.mockClear();
  const probe = (
    method: string,
    input: unknown = {},
    component = "machine-probe",
  ) =>
    f.host.invoke(
      id,
      f.idOf(component),
      f.idOf(component),
      "commands",
      "probe",
      { method, input },
    );
  const approve = async (
    ceiling: "project" | "machine",
    components: string[] = [],
  ) => {
    const selection = {
      ceiling,
      projects: [],
      readOnly: [],
      components: components.map(f.idOf),
    };
    const plan = (await f.host.tierPlan(id, selection)) as TierPlan;
    expect(await f.host.confirmTier(id, plan.fingerprint, selection)).toBe(
      true,
    );
    return plan;
  };
  return Object.assign(f, { id, confirm, probe, approve });
}

it.runIf(native)(
  "S-F runs only declared machine entries alongside private memory, and lowering waits for their real processes",
  async () => {
    const f = await fixture();
    await f.approve("project");
    await expect(f.probe("pid")).rejects.toMatchObject({
      code: "TIER_REQUIRED",
    });
    expect(
      await f.host.engineStatus(f.id, f.idOf("machine-probe"), "local"),
    ).toMatchObject({ state: "stopped" });
    await f.approve("machine", ["machine-probe", "machine-probe-b"]);
    expect(f.confirm.ask.mock.calls.at(-1)![0].message).toContain(
      MACHINE_AUTHORIZATION_COPY,
    );
    const calls = f.confirm.ask.mock.calls.length;
    const first = await f.probe("pid"),
      second = await f.probe("pid", {}, "machine-probe-b");
    expect(first).not.toBe(second);
    const group = (pid: unknown) =>
      execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 1000,
      }).trim();
    expect(group(first)).not.toBe(group(second));
    expect(() => process.kill(first as number, 0)).not.toThrow();
    expect(() => process.kill(second as number, 0)).not.toThrow();
    const outside = path.join(f.directory, "outside-project.txt");
    expect(
      await f.probe("write", {
        path: outside,
        content: "synthetic outside value",
      }),
    ).toBe("written");
    expect(await readFile(outside, "utf8")).toBe("synthetic outside value");
    expect(await f.probe("context")).toMatchObject({
      agentId: f.id,
      componentId: f.idOf("machine-probe"),
      engineId: "local",
      tier: "machine",
      projects: [],
    });
    expect(
      await f.probe("model", {
        messages: [{ role: "user", content: "synthetic callback" }],
      }),
    ).toEqual(reply("Synthetic reply"));
    expect(f.egress.inputs.at(-1)).toEqual({
      messages: [{ role: "user", content: "synthetic callback" }],
    });
    expect(
      await f.probe("environment", {
        credential: "synthetic-scenario-credential",
      }),
    ).toEqual({ syntheticCredentialPresent: false });
    await f.memory(f.id, "upsert", { id: "r", text: "memory remains private" });
    expect(await f.memory(f.id, "search", { query: "private" })).toEqual([
      { id: "r", text: "memory remains private" },
    ]);
    for (const operation of ["start", "request"])
      for (const engineId of ["local", "fixture.machine-probe/local"])
        await expect(
          f.host.invoke(
            f.id,
            f.idOf("memory"),
            f.idOf("memory"),
            "commands",
            "localProbe",
            { operation, engineId },
          ),
        ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(
      ((await f.host.tierStatus(f.id)) as LocalAuthorizationState).grants
        .map((g: AgentLocalGrant) => g.packageId)
        .sort(),
    ).toEqual([f.idOf("machine-probe"), f.idOf("machine-probe-b")].sort());
    expect(f.confirm.ask).toHaveBeenCalledTimes(calls + 1); // The model HTTPS callback retains its ordinary confirmation.
    const audit = JSON.stringify(await f.host.audit(f.id));
    for (const value of [
      outside,
      "synthetic outside value",
      "synthetic callback",
      "synthetic-scenario-credential",
    ])
      expect(audit).not.toContain(value);
    await f.host.lowerTier(f.id, "project");
    expect(() => process.kill(first as number, 0)).toThrow();
    expect(() => process.kill(second as number, 0)).toThrow();
    await expect(f.probe("pid")).rejects.toMatchObject({
      code: "TIER_REQUIRED",
    });
    expect(f.confirm.ask).toHaveBeenCalledTimes(calls + 1);
  },
);

it.runIf(native)(
  "S-F migrates a schema-6 trust only to its own entry, preserves old tables and never supplies project/fs coverage",
  async () => {
    const f = await fixture();
    await f.approve("machine", ["machine-probe"]);
    const authorized = (
      (await f.host.tierStatus(f.id)) as LocalAuthorizationState
    ).grants[0]!;
    await f.host.close();
    const database = path.join(
      f.directory,
      "instances",
      f.id,
      "core",
      "plums.db",
    );
    const db = new Database(database);
    const trust = {
      instanceId: authorized.instanceId,
      packageId: authorized.packageId,
      engineId: authorized.engineId,
      installedAt: authorized.installedAt,
      permission: authorized.permission,
      grantedAt: authorized.grantedAt,
    };
    db.prepare("INSERT OR REPLACE INTO engine_trust VALUES (?,?,?)").run(
      trust.packageId,
      trust.engineId,
      JSON.stringify(trust),
    );
    db.exec(
      "DROP TABLE IF EXISTS authority_grant_legacy; DROP TABLE agent_tier; DROP TABLE agent_local_grants; DROP TABLE local_authorization_migrations; PRAGMA user_version=6",
    );
    const tables = [
      "packages",
      "consents",
      "settings_revisions",
      "engine_trust",
      "engine_trust_revision",
      "mcp_tools",
      "mcp_tools_v2",
      "background_consents",
      "authority_grants",
      "authority_grant_revision",
    ];
    const rows = Object.fromEntries(
      tables.map((table) => [
        table,
        db.prepare(`SELECT * FROM ${table}`).all(),
      ]),
    );
    db.close();
    await f.restart();
    const state = (await f.host.tierStatus(f.id)) as LocalAuthorizationState;
    expect(state).toMatchObject({
      tier: { ceiling: "machine", projects: [], readOnly: [], components: [] },
      migration: { migrated: 1, skipped: 0, audited: true },
    });
    expect(state.grants).toHaveLength(1);
    expect(state.grants[0]).toMatchObject({
      packageId: f.idOf("machine-probe"),
      source: "engine-trust",
      hosts: [],
    });
    const check = new Database(database);
    expect(check.pragma("user_version", { simple: true })).toBe(7);
    for (const table of tables)
      expect(check.prepare(`SELECT * FROM ${table}`).all()).toEqual(
        rows[table],
      );
    check.close();
    await f.grant(f.id);
    const questions = f.confirm.ask.mock.calls.length;
    expect(await f.probe("pid")).toEqual(expect.any(Number));
    await expect(f.probe("pid", {}, "machine-probe-b")).rejects.toMatchObject({
      code: "LOCAL_CONFIRM_REQUIRED",
    });
    await expect(
      f.host.invoke(
        f.id,
        f.idOf("memory"),
        f.idOf("memory"),
        "commands",
        "localProbe",
        { operation: "start", engineId: "local" },
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.confirm.ask).toHaveBeenCalledTimes(questions);
    const migration = ((await f.host.audit(f.id)) as AuditEvent[]).filter(
      (e) => e.reason === "LOCAL_AUTHORIZATION_MIGRATED",
    );
    expect(migration).toHaveLength(1);
    await f.restart();
    expect(
      ((await f.host.audit(f.id)) as AuditEvent[]).filter(
        (e) => e.reason === "LOCAL_AUTHORIZATION_MIGRATED",
      ),
    ).toHaveLength(1);
  },
);

it("both machine fixture archives validate with default machine declarations and complete contribution schemas", async () => {
  const f = await chatFixture();
  fixtures.push(f);
  for (const name of ["machine-probe", "machine-probe-b"]) {
    const artifact = await f.put(await packExtension(name));
    const m = await fixtureManifest(name);
    expect(artifact.manifest).toEqual(m);
    const local = m.permissions.find((p) => p.kind === "engine")!;
    expect(local).not.toHaveProperty("tier");
    for (const contribution of desktopContribution(m)!.contributes!.commands!) {
      expect(contribution.inputSchema).toBeDefined();
      expect(contribution.outputSchema).toBeDefined();
    }
    expect(desktopContribution(m)!.foundation!.features).toContain(
      "sdk.engine",
    );
  }
});

it.runIf(native)(
  "ordinary common tasks, private resources, a capability scope and policy lease coexist with a confirmed machine entry in both orders",
  async () => {
    const f = await fixture();
    await addPolicy(f.host, f.id, "coexist", "return decision('allow');");
    await select(f.host, f.id, "coexist");
    await f.grant(f.id);
    const taskPlan = (await f.host.taskScopePlan(f.id)) as {
      fingerprint: string;
    };
    await f.host.grantTaskScope(f.id, taskPlan.fingerprint, 900_000);
    await f.approve("machine", ["machine-probe", "machine-probe-b"]);
    const first = await f.probe("pid");
    await grant(f.host, f.id);
    const frontend = await f.host.openFrontend(f.id);
    if (!frontend) throw Error("Expected loop frontend");
    const sdk = createCommonPlatformSdk(
      (method, args) =>
        f.host.frontendCommon(
          frontend.context.sessionId,
          frontend.context.handle,
          method,
          args,
        ),
      {
        list: async () => [],
        read: async () => ({ exists: false, revision: "0" }),
        write: async () => ({ revision: "0" }),
        delete: async () => ({ revision: "0" }),
      },
    );
    const task = await sdk.tasks.create({ lifetime: "frontend" });
    const binding = await sdk.binding("memory");
    if (!binding) throw Error("Expected memory binding");
    const call = await sdk.invoke(
      binding.handle,
      "search",
      { query: "" },
      { taskId: task.taskId },
    );
    expect(await call.result).toMatchObject({
      outcome: { ok: true, value: [] },
      executionState: "completed",
    });
    await f.memory(f.id, "upsert", {
      id: "coexist",
      text: "all scopes remain active",
    });
    expect(await f.history(f.id)).toEqual([]);
    expect(
      ((await f.host.taskScopePlan(f.id)) as { active: unknown }).active,
    ).toBeDefined();
    expect((await f.host.policyStatus(f.id)).active).not.toBeNull();
    expect(
      (await f.host.commonTasks(f.id)).some(
        (t) => t.description.taskId === task.taskId,
      ),
    ).toBe(true);
    expect(await f.probe("pid")).toBe(first);
    await f.host.stopEngine(f.id, f.idOf("machine-probe"), "local");
    const second = await f.probe("pid");
    expect(second).not.toBe(first);
    expect(await f.memory(f.id, "search", { query: "active" })).toEqual([
      { id: "coexist", text: "all scopes remain active" },
    ]);
    await f.host.stopCommonTask(f.id, task.taskId);
    expect(await f.probe("pid")).toBe(second);
  },
);

it.runIf(native)(
  "invalid machine inputs are refused by the contribution schema before the local process starts",
  async () => {
    const f = await fixture();
    await f.approve("machine", ["machine-probe"]);
    await expect(
      f.probe("write", { path: "synthetic-invalid-input" }),
    ).rejects.toMatchObject({
      details: {
        reason: "CONTRIBUTION_INPUT_INVALID",
        executionState: "not_started",
      },
    });
    expect(
      await f.host.engineStatus(f.id, f.idOf("machine-probe"), "local"),
    ).toMatchObject({ state: "stopped" });
    expect(JSON.stringify(await f.host.audit(f.id))).not.toContain(
      "synthetic-invalid-input",
    );
  },
);
