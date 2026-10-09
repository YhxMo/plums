/** Internal SDK observations. These reports never change public declared evidence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createArchive,
  createCore,
  validatePackage,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  RecordingExecSink,
} from "../packages/core/dist/index.js";
import {
  DesktopHost,
  createFoundationSession,
  FoundationRegistry,
  startFoundationSession,
} from "../packages/host/dist/index.js";
import { OfficialAdapterArtifacts } from "../packages/host/dist/foundation-artifact.js";

export const SUITE_VERSION = "1.0.0";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ownJSON = JSON.parse(
  '{"__proto__":{"value":"opaque-own"},"constructor":{"value":7},"nested":[{"__proto__":null}],"text":"\\\"});globalThis.polluted=true;// ${data}"}',
);
const secret = "synthetic-sdk-matrix-credential";
const tool = {
  name: "matrix-tool",
  description: "Synthetic tool",
  inputSchema: { type: "object" },
};
const requirement = (features) => ({
  requirementVersion: "1.0",
  protocolRange: "^1.0.0",
  sdk: { id: "org.plums.sdk", version: "2.0.0" },
  features: [...new Set(["sdk.register", ...features])],
});
async function rejected(fn, expected) {
  return assert.rejects(
    fn,
    expected &&
      ((error) => {
        const match = (value, wanted) => {
          for (const [key, entry] of Object.entries(wanted)) {
            if (entry && typeof entry === "object") match(value[key], entry);
            else assert.equal(value[key], entry);
          }
        };
        match(error, expected);
        return true;
      }),
  );
}
const independentFeatures = [
  "sdk.register",
  "sdk.settings",
  "sdk.context",
  "sdk.capability",
];
export async function independentArchive() {
  return createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify(
        manifest("fixture.independent-foundation", {
          plumsFoundation: {
            declarationVersion: "1.0",
            id: "fixture.independent-foundation",
            foundationVersion: "1.0",
            entry: "provider.mjs",
            execution: "controlled-node",
            platforms: ["darwin-arm64"],
            features: ["session.invoke", "session.callback", "session.cancel"],
            hostFeatures: [],
            sdks: [
              {
                id: "org.plums.sdk",
                range: "^2.0.0",
                features: independentFeatures,
              },
            ],
          },
        }),
      ),
    ),
    "provider.mjs": await readFile(
      new URL(
        "../packages/host/test/fixtures/independent-foundation.mjs",
        import.meta.url,
      ),
    ),
  });
}
function manifest(id, payload, permissions = [], kind = "extension") {
  return {
    formatVersion: "2.0",
    id,
    kind,
    name: id,
    version: "1.0.0",
    description: "Internal SDK matrix; not distributed",
    dependencies: [],
    permissions,
    payload,
  };
}
const fsPermission = (operation) => ({
  id: "files",
  kind: "fs",
  target: "work",
  operations: [operation],
  reason: "Synthetic filesystem",
});
const service = {
  id: "api",
  kind: "service",
  target: "https",
  operations: ["request"],
  reason: "Synthetic HTTPS",
};
const send = `const c=await s.connection('api');return s.capability('api',{kind:'service',operation:'request',binding:c.binding,sources:[],input:{path:'/matrix',body:'synthetic-request'}},i.tool);`;
const resourceBinding = `const b=(await s.resources.list())[0].binding;`;
const cases = [];
const test = (id, features, source, check, options = {}) =>
  cases.push({ id, features, source, check, ...options });
test(
  "register",
  [],
  "return {value:i,own:Object.hasOwn(i,'__proto__'),ordinary:Object.getPrototypeOf(i)===Object.prototype,nestedOwn:Object.hasOwn(i.nested[0],'__proto__'),polluted:({}).polluted??null};",
  async (f) => {
    assert.deepEqual(await f.invoke(ownJSON), {
      value: ownJSON,
      own: true,
      ordinary: true,
      nestedOwn: true,
      polluted: null,
    });
  },
);
test(
  "settings",
  ["sdk.settings"],
  "return s.settings();",
  async (f) => {
    const result = await f.invoke({});
    assert.equal(result.label, "synthetic-setting");
    assert.ok(!JSON.stringify(result).includes(secret));
  },
  { settings: true },
);
test("context", ["sdk.context"], "return s.context();", async (f) => {
  const result = await f.invoke({ agentId: "forged", componentId: "forged" });
  assert.equal(result.agentId, f.agent.instanceId);
  assert.equal(result.componentId, f.componentId);
  assert.equal(typeof result.invocationId, "string");
});
test(
  "character",
  ["sdk.character"],
  "return s.character(i.id);",
  async (f) => {
    assert.deepEqual(await f.invoke({}), f.cardPayload);
    await rejected(() => f.invoke({ id: "fixture.foreign-card" }), {
      code: "PERMISSION_DENIED",
    });
    await f.host.setCharacter(f.agent.instanceId);
    assert.equal(await f.invoke({}), null);
  },
  { cards: true },
);
test(
  "characters",
  ["sdk.characters"],
  "return s.characters();",
  async (f) => {
    assert.deepEqual(
      (await f.invoke({})).map((c) => c.id),
      ["fixture.matrix-card"],
    );
  },
  { cards: true },
);
test(
  "connection",
  ["sdk.connection"],
  "return s.connection('api');",
  async (f) => {
    const c = await f.invoke({ origin: "https://forged.example" });
    assert.equal(c.origin, "https://sdk.plums-fixture.test");
    assert.equal(c.ready, true);
    assert.ok(!JSON.stringify(c).includes(secret));
    assert.equal(f.egress.records.length, 0);
  },
  { service: true },
);
for (const operation of ["read", "write", "list"])
  test(
    `capability.fs.${operation}`,
    ["sdk.capability"],
    `return s.capability('files',{kind:'fs',operation:'${operation}',path:i.path,...(i.data?{data:i.data}:{})});`,
    async (f) => {
      const r = await f.invoke({
        path: operation === "list" ? "." : "item",
        ...(operation === "write" ? { data: [1, 2, 3] } : {}),
      });
      if (operation === "read") assert.deepEqual(r.data, [4, 5, 6]);
      if (operation === "list")
        assert.deepEqual(r.entries, [{ name: "synthetic", type: "file" }]);
      assert.equal(f.fs.records.length, 1);
      assert.equal(f.fs.records[0].operation, operation);
      if (operation === "write")
        assert.deepEqual([...f.fs.records[0].data], [1, 2, 3]);
      await rejected(() => f.invoke({ path: "../outside" }));
      assert.equal(f.fs.records.length, 1);
    },
    { permissions: [fsPermission(operation)], fs: true },
  );
test(
  "capability.exec",
  ["sdk.capability"],
  "return s.capability('run',{kind:'exec',args:i.args,cwd:{root:'work',path:i.cwd??'.'}});",
  async (f) => {
    const args = ["literal $(echo data)", "separate argument"];
    const result = await f.invoke({ args });
    assert.equal(result.result.stdout, "synthetic-exec-result");
    assert.equal(f.exec.records.length, 1);
    assert.deepEqual(f.exec.records[0].args, args);
    await rejected(() => f.invoke({ args, cwd: "../outside" }));
    assert.equal(f.exec.records.length, 1);
  },
  {
    exec: true,
    permissions: [
      {
        id: "run",
        kind: "exec",
        target: "synthetic-program",
        cwdRoots: ["work"],
        reason: "Synthetic exec",
      },
    ],
  },
);
test(
  "capability.service.request",
  ["sdk.connection", "sdk.capability"],
  send,
  async (f) => {
    const r = await f.invoke({});
    assert.equal(r.result.status, 200);
    assert.equal(f.egress.records.length, 1);
    assert.equal(
      f.egress.records[0].url,
      "https://sdk.plums-fixture.test/matrix",
    );
    assert.equal(f.egress.records[0].headers.Authorization, `Bearer ${secret}`);
    assert.ok(!JSON.stringify(r).includes(secret));
  },
  { service: true },
);
test(
  "capability.service.mcpTool",
  ["sdk.connection", "sdk.capability", "sdk.mcpCheck"],
  `if(i.tools)return s.mcpCheck(i.tools);${send}`,
  async (f) => {
    await f.invoke({ tools: [tool] });
    await rejected(() => f.invoke({ tool }));
    assert.equal(f.egress.records.length, 0);
    await f.host.approveMcp(f.agent.instanceId, f.componentId, "api", [tool]);
    assert.equal((await f.invoke({ tool })).result.status, 200);
    const changed = { ...tool, description: "Changed synthetic tool" };
    await f.invoke({ tools: [changed] });
    await rejected(() => f.invoke({ tool: changed }));
    assert.equal(f.egress.records.length, 1);
  },
  { service: true },
);
test(
  "mcpCheck",
  ["sdk.mcpCheck"],
  "return s.mcpCheck(i.tools);",
  async (f) => {
    assert.equal((await f.invoke({ tools: [tool] }))[0].state, "ADDED");
    await f.host.approveMcp(f.agent.instanceId, f.componentId, "api", [tool]);
    assert.equal((await f.invoke({ tools: [tool] }))[0].state, "APPROVED");
    assert.deepEqual(await f.invoke({ tools: [] }), []);
    assert.equal((await f.invoke({ tools: [tool] }))[0].state, "ADDED");
  },
  { service: true },
);
test(
  "protocols.status",
  ["sdk.protocols"],
  "return s.protocols.status('echo');",
  async (f) => {
    const status = await f.invoke({});
    assert.equal(status.state, "available");
    assert.equal(status.providerId, "fixture.matrix-provider");
  },
  { protocols: true },
);
test(
  "protocols.invoke",
  ["sdk.protocols"],
  "return s.protocols.invoke('echo',i);",
  async (f) => {
    assert.deepEqual(
      await f.invoke({ operation: "echo", input: { value: ownJSON } }),
      { operation: "echo", input: { value: ownJSON } },
    );
    await rejected(() => f.invoke({ operation: "wrong", input: {} }), {
      details: {
        reason: "CONTRIBUTION_INPUT_INVALID",
        executionState: "not_started",
      },
    });
  },
  { protocols: true },
);
test(
  "resources.read",
  ["sdk.resources"],
  `${resourceBinding}if(i.seed)return s.resources.write(b,'item','0',i.value);return s.resources.read(b,'item');`,
  async (f) => {
    assert.deepEqual(await f.invoke({}), { exists: false, revision: "0" });
    const saved = await f.invoke({ seed: true, value: ownJSON });
    assert.deepEqual(await f.invoke({}), {
      exists: true,
      revision: saved.revision,
      value: ownJSON,
    });
  },
  { resources: true },
);
test(
  "resources.write",
  ["sdk.resources"],
  `${resourceBinding}return s.resources.write(b,'item',i.revision,i.value);`,
  async (f) => {
    const first = await f.invoke({ revision: "0", value: ownJSON });
    assert.equal(typeof first.revision, "string");
    await rejected(() => f.invoke({ revision: "0", value: "stale" }), {
      details: { reason: "RESOURCE_CONFLICT" },
    });
    const second = await f.invoke({
      revision: first.revision,
      value: "updated",
    });
    assert.notEqual(second.revision, first.revision);
  },
  { resources: true },
);
test(
  "contribution.schema",
  [],
  "count++;return i.action==='bad'?{invalid:true}:{count};",
  async (f) => {
    await rejected(() => f.invoke({ action: 7 }), {
      path: "/input",
      details: {
        reason: "CONTRIBUTION_INPUT_INVALID",
        executionState: "not_started",
      },
    });
    assert.deepEqual(await f.invoke({ action: "count" }), { count: 1 });
    await rejected(() => f.invoke({ action: "bad" }), {
      path: "/output",
      details: {
        reason: "CONTRIBUTION_OUTPUT_INVALID",
        executionState: "completed",
      },
    });
    assert.deepEqual(await f.invoke({ action: "count" }), { count: 3 });
  },
  { schema: true },
);
test(
  "failResponse",
  ["sdk.connection", "sdk.capability", "sdk.failResponse"],
  `const r=await (async()=>{${send}})();return s.failResponse(r.callId,'RESPONSE_INVALID');`,
  async (f) => {
    await rejected(() => f.invoke({}), {
      code: "CAPABILITY_FAILED",
      details: {
        reason: "RESPONSE_INVALID",
        executionState: "completed",
        httpStatus: 200,
      },
    });
    assert.equal(f.egress.records.length, 1);
    const events = await f.host.audit(f.agent.instanceId);
    const failed = events.filter(
      (e) => e.phase === "result" && e.reason === "RESPONSE_INVALID",
    );
    assert.equal(failed.length, 1);
    assert.ok(
      events.some((e) => e.phase === "allow" && e.callId === failed[0].callId),
    );
  },
  { service: true },
);
export const SDK_CASE_IDS = Object.freeze(cases.map((c) => c.id));

async function setup(
  c,
  { foundation = "builtin", nodePath = process.execPath } = {},
) {
  if (!["builtin", "independent"].includes(foundation))
    throw Error("Unknown foundation");
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "plums-scenario-sdk-")),
  );
  const work = path.join(root, "work");
  await mkdir(work);
  await writeFile(path.join(work, "item"), "synthetic-metadata");
  const fs = new RecordingFsSink({
    data: new Uint8Array([4, 5, 6]),
    entries: [{ name: "synthetic", type: "file" }],
  });
  const egress = new RecordingEgressSink(
    {},
    { status: 200, body: "synthetic-response" },
  );
  const exec = new RecordingExecSink({ stdout: "synthetic-exec-result" });
  const secrets = new MemorySecretStore();
  let host, core, session;
  const close = async () => {
    try {
      await session?.close();
    } finally {
      try {
        await host?.close();
      } finally {
        core?.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  };
  try {
    host = new DesktopHost({
      dataDir: path.join(root, "data"),
      nodePath,
      fs,
      egress,
      secretStore: () => secrets,
      confirm: { ask: async () => true },
    });
    await host.initialize();
    const put = async (bytes) =>
      host.importLibrary((await host.preview(bytes)).token);
    let provider;
    if (foundation === "independent")
      provider = await put(await independentArchive());
    const selected =
      foundation === "builtin"
        ? await host.restoreBuiltinFoundation()
        : (await host.listFoundations()).find(
            (p) => p.selection.digest === provider.digest,
          ).selection;
    const features = requirement(c.features);
    const contribution = {
      name: "check",
      title: "SDK check",
      inputSchema: c.schema
        ? {
            type: "object",
            properties: { action: { enum: ["count", "bad"] } },
            required: ["action"],
            additionalProperties: false,
          }
        : { type: "object" },
      outputSchema: c.schema
        ? {
            type: "object",
            properties: { count: { type: "integer" } },
            required: ["count"],
            additionalProperties: false,
          }
        : {},
    };
    const m = manifest(
      "fixture.sdk-matrix",
      {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          foundation: features,
          contributes: { commands: [contribution] },
          ...(c.service
            ? {
                connections: [
                  {
                    id: "api",
                    permissionId: "api",
                    baseURLSetting: "url",
                    credentials: [
                      {
                        setting: "token",
                        header: "Authorization",
                        prefix: "Bearer ",
                      },
                    ],
                  },
                ],
              }
            : {}),
          ...(c.protocols
            ? {
                protocols: {
                  requires: [
                    {
                      id: "echo",
                      protocol: "org.plums.fixture-matrix",
                      range: "^1.0.0",
                      features: ["echo"],
                    },
                  ],
                },
              }
            : {}),
          ...(c.resources
            ? {
                common: {
                  commonVersion: "1.0",
                  features: ["resources-cas"],
                  runtime: "isolate",
                  resources: [
                    {
                      id: "private",
                      permissionId: "data",
                      operations: ["read", "write"],
                    },
                  ],
                },
              }
            : {}),
        },
      },
      c.permissions ??
        (c.resources
          ? [
              {
                id: "data",
                kind: "resource",
                target: "agent",
                operations: ["read", "write"],
                reason: "Private fixture",
              },
            ]
          : c.service
            ? [service]
            : []),
      c.service ? "connector" : "extension",
    );
    if (c.settings || c.service)
      m.settingsSchema = {
        type: "object",
        properties: {
          label: {
            type: "string",
            title: "Label",
            description: "Synthetic setting",
          },
          url: { type: "string", title: "URL", description: "Synthetic URL" },
          token: {
            type: "string",
            title: "Token",
            description: "Synthetic token",
            "x-secret": true,
          },
        },
      };
    const archive = await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(m)),
      "main.js": Buffer.from(
        `let count=0;export function activate(s){s.register('commands','check',async i=>{${c.source}});}`,
      ),
    });
    const item = await put(archive);
    const digests = [item.digest];
    const cardPayload = { arbitrary: "opaque-card", nested: ownJSON };
    if (c.cards) {
      for (const id of [
        "fixture.matrix-card",
        "fixture.disabled-card",
        "fixture.foreign-card",
      ]) {
        const card = await put(
          await createArchive({
            "manifest.json": Buffer.from(
              JSON.stringify(manifest(id, cardPayload, [], "character")),
            ),
          }),
        );
        if (id !== "fixture.foreign-card") digests.push(card.digest);
      }
    }
    if (c.protocols) {
      const wrapper = {
        type: "object",
        properties: {
          operation: { const: "echo" },
          input: {
            type: "object",
            properties: { value: {} },
            required: ["value"],
            additionalProperties: false,
          },
        },
        required: ["operation", "input"],
        additionalProperties: false,
      };
      const p = manifest("fixture.matrix-provider", {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          foundation: requirement([]),
          contributes: {
            tools: [
              {
                name: "echo",
                title: "Echo",
                inputSchema: wrapper,
                outputSchema: wrapper,
              },
            ],
          },
          protocols: {
            provides: [
              {
                id: "echo",
                protocol: "org.plums.fixture-matrix",
                version: "1.0.0",
                features: ["echo"],
                contribution: { kind: "tools", name: "echo" },
              },
            ],
          },
        },
      });
      digests.push(
        (
          await put(
            await createArchive({
              "manifest.json": Buffer.from(JSON.stringify(p)),
              "main.js": Buffer.from(
                "export function activate(s){s.register('tools','echo',i=>i)}",
              ),
            }),
          )
        ).digest,
      );
    }
    const unsupported =
      foundation === "independent" &&
      features.features.some((f) => !independentFeatures.includes(f));
    let agent;
    if (unsupported) {
      await rejected(
        () =>
          host.createAgent(
            "SDK matrix",
            digests,
            c.cards ? "fixture.matrix-card" : undefined,
            undefined,
            [],
            { requirement: features, selection: selected },
          ),
        {
          code: "CAPABILITY_FAILED",
          details: {
            reason: "FOUNDATION_INCOMPATIBLE",
            executionState: "not_started",
          },
        },
      );
      assert.deepEqual(await host.listAgents(), []);
      assert.equal(
        fs.records.length + egress.records.length + exec.records.length,
        0,
      );
      return { close, selected, unsupported, componentDigest: item.digest };
    }
    agent = await host.createAgent(
      "SDK matrix",
      digests,
      c.cards ? "fixture.matrix-card" : undefined,
      undefined,
      [],
      { requirement: features, selection: selected },
    );
    assert.deepEqual(agent.foundation.selection, selected);
    assert.equal(
      (await host.foundationPlan(agent.instanceId)).evidence,
      "declared",
    );
    if (c.settings || c.service)
      await host.setSettings(
        agent.instanceId,
        m.id,
        {
          label: "synthetic-setting",
          url: "https://sdk.plums-fixture.test/base",
        },
        { token: secret },
      );
    if (c.fs) await host.bindRoot(agent.instanceId, "work", work);
    if (c.cards) await host.enable(agent.instanceId, "fixture.matrix-card");
    if (c.protocols)
      await host.enable(agent.instanceId, "fixture.matrix-provider");
    await host.enable(agent.instanceId, m.id);
    if (c.resources) {
      const privateSpace = (
        await host.resourcePlan(agent.instanceId)
      ).spaces.find((s) => s.ownerAgentId === agent.instanceId);
      for (const component of ["", m.id])
        await host.setResourceQualification(
          agent.instanceId,
          (await host.resourcePlan(agent.instanceId)).fingerprint,
          privateSpace.id,
          component,
          ["read", "write"],
        );
      await host.setResourceBinding(
        agent.instanceId,
        (await host.resourcePlan(agent.instanceId)).fingerprint,
        m.id,
        "private",
        privateSpace.id,
      );
      const plan = await host.resourcePlan(agent.instanceId);
      await host.grantResourceRange(
        agent.instanceId,
        plan.fingerprint,
        "task",
        900_000,
        [
          {
            componentId: m.id,
            resourceId: privateSpace.id,
            operations: ["read", "write"],
          },
        ],
      );
    }
    let invoke = (input) =>
      host.invoke(agent.instanceId, m.id, m.id, "commands", "check", input);
    if (c.exec) {
      // This matrix tests SDK/core exec authorization with a Recording Sink. No program is executed.
      core = createCore({
        dataDir: path.join(root, "exec-core"),
        instanceId: agent.instanceId,
        roots: { work },
        programs: { "synthetic-program": "/synthetic/program" },
        exec,
        secrets,
        egress,
        confirm: { ask: async () => true },
        onAudit: async () => {},
      });
      await core.importPackage(archive);
      await core.grantConsent(m.id);
      await core.enable(m.id);
      const bridge = async (method, args, context) => {
        assert.equal(method, "capability");
        return core.runDelegatedCapability({
          packageId: m.id,
          permissionId: args.permissionId,
          request: args.request,
          callers: context.callers,
          signal: context.signal,
        });
      };
      const registry = new FoundationRegistry();
      if (foundation === "builtin")
        await new OfficialAdapterArtifacts(path.join(root, "data")).register(
          registry,
          selected,
          nodePath,
        );
      session =
        foundation === "builtin"
          ? await createFoundationSession(registry, selected, {
              component: await validatePackage(archive),
              actor: {
                agentId: agent.instanceId,
                componentId: m.id,
                installationId: "matrix-installation",
                componentVersion: m.version,
                componentDigest: item.digest,
              },
              bridge,
              assertActive: async () => {},
              assertCurrent: () => {},
            })
          : await startFoundationSession({
              nodePath,
              provider: {
                archive: await independentArchive(),
                selection: selected,
              },
              component: {
                archive,
                agentId: agent.instanceId,
                installationId: "matrix-installation",
              },
              requirement: features,
              bridge,
              assertActive: async () => {},
            });
      await session.ready();
      await session.activate();
      invoke = (input) =>
        session.invoke("commands", "check", input, {
          callers: [],
          ancestry: [m.id],
          signal: new AbortController().signal,
        });
    }
    return {
      host,
      agent,
      componentId: m.id,
      componentDigest: item.digest,
      fs,
      exec,
      egress,
      invoke,
      cardPayload,
      selected,
      close,
      unsupported: false,
      root,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function runScenarioSdkConformance(options = {}) {
  const selectedCases = options.caseIds
    ? cases.filter((c) => options.caseIds.includes(c.id))
    : cases;
  if (
    !selectedCases.length ||
    (options.caseIds && selectedCases.length !== new Set(options.caseIds).size)
  )
    throw Error("Unknown SDK case");
  const report = {
    reportVersion: "1.0",
    suiteVersion: SUITE_VERSION,
    suiteDigest: hash(await readFile(fileURLToPath(import.meta.url))),
    platform: {
      os: process.platform,
      arch: process.arch,
      node: process.versions.node,
    },
    provenance: "internal-fixture",
    publicEvidence: "declared",
    thirdPartyAuthorVerified: false,
    scope: "scenario-sdk-matrix",
    coverage: options.caseIds ? "partial" : "complete",
    checkedAt: new Date().toISOString(),
    overallObjectiveComplete: false,
    cases: [],
    limitations: [
      "Fake filesystem, exec and HTTPS Sinks; no real network or toolchain certification.",
      "Exec uses the public foundation session and real core with RecordingExecSink, not the DesktopHost controlled program runner.",
      "Business scenarios S-B/S-E/S-F/S-G/S-H still require separate implementation and acceptance.",
    ],
  };
  for (const c of selectedCases) {
    let f;
    const row = {
      id: c.id,
      status: "failed",
      requiredFeatures: requirement(c.features).features,
      route: c.exec ? "public-session/core-recording-exec" : "DesktopHost",
    };
    try {
      f = await setup(c, options);
      report.foundation ??= f.selected;
      assert.deepEqual(report.foundation, f.selected);
      row.componentDigest = f.componentDigest;
      row.expectation = f.unsupported
        ? "reject-before-start"
        : "execute-supported";
      if (!f.unsupported) {
        await c.check(f);
        const audit = JSON.stringify(await f.host.audit(f.agent.instanceId));
        assert.ok(!audit.includes(secret));
        assert.ok(!audit.includes(f.root));
        assert.ok(!audit.includes("synthetic-response"));
      }
      row.status = "passed";
      if (f.unsupported)
        row.rejection = {
          code: "CAPABILITY_FAILED",
          reason: "FOUNDATION_INCOMPATIBLE",
          executionState: "not_started",
        };
    } catch (error) {
      row.failure = {
        code:
          error.code === "ERR_ASSERTION"
            ? "ASSERTION_FAILED"
            : "SDK_OR_HOST_FAILED",
        checkLine:
          Number(
            error.stack?.match(/scenario-sdk-conformance\.mjs:(\d+)/)?.[1],
          ) || null,
      };
      if (options.onFailure) options.onFailure(error, c.id);
    } finally {
      try {
        await f?.close();
      } catch {
        row.status = "failed";
        row.failure = { code: "CLEANUP_FAILED" };
      }
    }
    report.cases.push(row);
  }
  report.status = report.cases.every((c) => c.status === "passed")
    ? "passed"
    : "failed";
  return report;
}
async function main(args) {
  let out;
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      const [key, value] = args.slice(i, i + 2);
      if (
        !value ||
        !["--foundation", "--node", "--out", "--case"].includes(key)
      )
        throw Error("Arguments");
      if (key === "--foundation") options.foundation = value;
      if (key === "--node") options.nodePath = path.resolve(value);
      if (key === "--out") out = path.resolve(value);
      if (key === "--case") (options.caseIds ??= []).push(value);
    }
    const report = await runScenarioSdkConformance(options);
    if (out) {
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== "passed") process.exitCode = 1;
  } catch {
    const report = {
      reportVersion: "1.0",
      suiteVersion: SUITE_VERSION,
      status: "failed",
      failure: { code: "INPUT_OR_REPORT_FAILED" },
    };
    if (out) {
      try {
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, JSON.stringify(report, null, 2) + "\n");
      } catch {
        report.failure.code = "REPORT_WRITE_FAILED";
      }
    }
    console.log(JSON.stringify(report));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
