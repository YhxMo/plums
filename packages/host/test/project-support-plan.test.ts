import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  lstat,
  rm,
  rename,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCore,
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  enginePermissionKey,
  type Core,
  type LocalDirectory,
  type ManifestV2,
} from "@plumsjs/core";
import { LocalAuthorizations } from "../src/local-authorization.js";
import type { Session } from "../src/host.js";

const cores: Core[] = [],
  dirs: string[] = [];
afterEach(async () => {
  cores.splice(0).forEach((c) => c.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(nativeConfiguration = false) {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "plums-project-support-")),
  );
  dirs.push(dir);
  const platform = path.join(dir, "platform"),
    project = path.join(dir, "project"),
    outside = path.join(dir, "outside");
  await Promise.all([platform, project, outside].map((d) => mkdir(d)));
  const core = createCore({
    dataDir: platform,
    instanceId: "fixture-agent",
    egress: new RecordingEgressSink(),
    secrets: new MemorySecretStore(),
  });
  cores.push(core);
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "fixture-tools",
    name: "Fixture",
    description: "",
    version: "1.0.0",
    dependencies: [],
    permissions: [
      {
        id: "files",
        kind: "fs",
        target: "workspace",
        operations: ["read", "write"],
        reason: "fixture",
      },
      {
        id: "exec",
        kind: "exec",
        target: "test",
        cwdRoots: ["workspace"],
        reason: "fixture",
      },
      {
        id: "project",
        kind: "engine",
        target: "project",
        tier: "project",
        toolchains: ["node"],
        reason: "fixture",
      },
      { id: "machine", kind: "engine", target: "machine", reason: "fixture" },
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
  const installed = (await core.listInstalled())[0]!;
  const component = {
    packageId: installed.id,
    installedAt: installed.installedAt,
    permissions: enginePermissionKey(manifest.permissions),
  };
  const directory = async (
    root: string,
    file: string,
  ): Promise<LocalDirectory> => {
    const stat = await lstat(file, { bigint: true });
    return { root, path: file, dev: String(stat.dev), ino: String(stat.ino) };
  };
  const saved = await directory("workspace", project),
    identity = await lstat(project);
  const session = {
    core,
    record: {
      instanceId: "fixture-agent",
      roots: { workspace: project, outside },
      controlledPrograms: {
        test: {
          program: "/fixture/bin/test",
          digest: "fixture",
          reads: ["workspace"],
          writes: ["workspace"],
          rootIdentities: {
            workspace: { dev: identity.dev, ino: identity.ino },
          },
        },
      },
    },
  } as unknown as Session;
  const auth = new LocalAuthorizations({
    dataDir: platform,
    homeDir: path.join(dir, "home"),
    toolchainProbe: {
      shellPath: async () => "/fixture/bin",
      which: async () => "/fixture/tool/node/v1/bin/node",
      realpath: async (p) => p,
    },
    configurationReader: nativeConfiguration
      ? undefined
      : {
          read: async (tool, field) =>
            tool === "git" && field === "user.name" ? "Fixture" : undefined,
        },
    confirm: { ask: async () => true },
    audit: async () => {},
    secrets: async () => [],
    stop: async () => {},
  });
  const approve = async (components = [component]) => {
    const state = await core.localAuthorizationState();
    expect(
      await core.commitLocalAuthorization({
        ...state,
        assembly: [component],
        tier: {
          ...state.tier,
          ceiling: "project",
          projects: [saved],
          components,
        },
      }),
    ).toBe(true);
  };
  const input = {
    principals: [{ packageId: manifest.id, permissionId: "files" }],
    rootPath: project,
    request: {
      kind: "fs" as const,
      operation: "write" as const,
      path: "test",
      data: new Uint8Array(),
    },
  };
  return {
    auth,
    core,
    session,
    project,
    outside,
    component,
    saved,
    manifest,
    approve,
    input,
    home: path.join(dir, "home"),
  };
}
it.runIf(process.platform === "darwin" && process.arch === "arm64")(
  "rereading project configuration leaves a confirmed machine entry unchanged",
  async () => {
    const f = await fixture(true);
    await mkdir(f.home);
    const selection = {
      ceiling: "machine" as const,
      projects: ["workspace"],
      readOnly: [],
      components: [f.manifest.id],
    };
    const initial = await f.auth.plan(f.session, selection);
    await f.auth.confirm(f.session, initial.fingerprint, selection);
    expect(
      (await f.auth.plan(f.session)).entries[0]?.engines.map((e) => e.state),
    ).toEqual(["confirmed", "confirmed"]);
    await writeFile(
      path.join(f.home, ".gitconfig"),
      "[user]\nname = Fixture\n",
    );
    await f.auth.refreshConfiguration(f.session);
    const entries = (await f.auth.plan(f.session)).entries[0]!.engines;
    expect(entries[0]).toMatchObject({
      state: "pending",
      configuration: [{ tool: "git", field: "user.name", value: "Fixture" }],
    });
    expect(entries[1]).toMatchObject({ state: "confirmed", configuration: [] });
  },
);
it("plans each entry's own tier and lists actual probe/config results", async () => {
  const f = await fixture();
  const plan = await f.auth.plan(f.session, {
    ceiling: "project",
    projects: [],
    readOnly: [],
    components: [f.manifest.id],
  });
  expect(plan.entries[0]?.engines).toEqual([
    expect.objectContaining({
      engineId: "project",
      tier: "project",
      state: "pending",
      toolchains: [
        {
          name: "node",
          root: "/fixture/tool/node/v1",
          executable: "/fixture/tool/node/v1/bin/node",
          found: true,
        },
      ],
      configuration: [{ tool: "git", field: "user.name", value: "Fixture" }],
    }),
    expect.objectContaining({
      engineId: "machine",
      tier: "machine",
      state: "tier-required",
      toolchains: [],
      configuration: [],
    }),
  ]);
});
it("only confirmed components and project roots cover filesystem questions", async () => {
  const f = await fixture();
  expect(await f.auth.coverage(f.session, f.input)).toBeUndefined();
  await f.approve();
  expect(await f.auth.coverage(f.session, f.input)).toMatchObject({
    tier: "project",
  });
  expect(
    await f.auth.coverage(f.session, { ...f.input, rootPath: f.outside }),
  ).toBeUndefined();
  await f.approve([]);
  expect(await f.auth.coverage(f.session, f.input)).toBeUndefined();
});
it("checks directory identities after replacement", async () => {
  const f = await fixture();
  await f.approve();
  await rename(f.project, f.project + "-old");
  await mkdir(f.project);
  expect(await f.auth.coverage(f.session, f.input)).toBeUndefined();
});
it("checks every controlled program root and the pinned executable", async () => {
  const f = await fixture();
  await f.approve();
  const input = {
    ...f.input,
    principals: [{ packageId: f.manifest.id, permissionId: "exec" }],
    request: {
      kind: "exec" as const,
      args: [],
      cwd: { root: "workspace", path: "." },
    },
    program: "/fixture/bin/test",
  };
  expect(await f.auth.coverage(f.session, input)).toMatchObject({
    tier: "project",
  });
  expect(
    await f.auth.coverage(f.session, {
      ...input,
      program: "/fixture/bin/other",
    }),
  ).toBeUndefined();
  f.session.record.controlledPrograms!.test!.writes.push("outside");
  expect(await f.auth.coverage(f.session, input)).toBeUndefined();
});
it("does not cover a delegated component absent from the confirmed assembly", async () => {
  const f = await fixture();
  await f.approve([]);
  expect(
    await f.auth.coverage(f.session, {
      ...f.input,
      principals: [
        ...f.input.principals,
        { packageId: f.manifest.id, permissionId: "exec" },
      ],
    }),
  ).toBeUndefined();
});
it("does not return an old scope revoked during asynchronous component checks", async () => {
  const f = await fixture();
  await f.approve();
  const get = f.core.getPackage.bind(f.core);
  vi.spyOn(f.core, "getPackage").mockImplementation(async (id) => {
    const result = await get(id);
    await f.approve([]);
    return result;
  });
  expect(await f.auth.coverage(f.session, f.input)).toBeUndefined();
});
