import { it, expect, afterEach } from "vitest";
import {
  readFile,
  mkdtemp,
  writeFile,
  rm,
  realpath,
  lstat,
} from "node:fs/promises";
import { spawnSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  createArchive,
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
  validatePackage,
} from "@plums/core";
import {
  desktopContribution,
  type FoundationRequirement,
  type FoundationProvider,
} from "@plums/sdk";
import {
  startFoundationSession,
  createFoundationSession,
  createOfficialFoundationRegistry,
  OFFICIAL_FOUNDATION_REFERENCE,
} from "../src/index.js";
import { ExtensionRuntime, type InvocationContext } from "../src/runtime.js";
import { SecureFsSink } from "../src/io.js";
const node = path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node");
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const sessions: { close(): Promise<void> }[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
const requirement: FoundationRequirement = {
  requirementVersion: "1.0",
  protocolRange: "^1.0.0",
  sdk: { id: "org.plums.sdk", version: "2.0.0" },
  features: ["sdk.register", "sdk.settings", "sdk.context", "sdk.capability"],
};
const declaration: FoundationProvider = {
  declarationVersion: "1.0",
  id: "org.example.independent",
  foundationVersion: "1.0",
  entry: "provider.mjs",
  execution: "controlled-node",
  platforms: ["darwin-arm64"],
  features: ["session.invoke", "session.callback", "session.cancel"],
  hostFeatures: [],
  sdks: [
    { id: "org.plums.sdk", range: "^2.0.0", features: requirement.features },
  ],
};
const source = `export function activate(s){s.register('commands','check',async i=>({settings:await s.settings(),context:await s.context(),files:await s.capability('files',{kind:'fs',operation:'list',path:'.'}),value:i.value}));}`;
it.each(["builtin", "independent"])(
  "%s preserves opaque JSON own keys, ordinary prototypes and code-like strings in inputs and callback replies",
  async (profile) => {
    const f = await fixture();
    try {
      const source = `export function activate(s){const inspect=v=>({value:v,own:Object.hasOwn(v,'__proto__'),ordinary:Object.getPrototypeOf(v)===Object.prototype,nestedOwn:Object.hasOwn(v.nested[0],'__proto__'),nestedOrdinary:Object.getPrototypeOf(v.nested[0])===Object.prototype});s.register('commands','check',async i=>({input:inspect(i),reply:inspect(await s.settings()),polluted:({}).polluted??null}));}`;
      const archive = await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(f.m)),
        "main.js": Buffer.from(source),
      });
      const value = JSON.parse(
        '{"__proto__":{"polluted":"own-data"},"constructor":{"value":7},"nested":[{"__proto__":null}],"text":"\\\"});globalThis.polluted=true;// ${not_code}\\nline"}',
      );
      let callbacks = 0;
      const bridge = async (method: string) => {
        expect(method).toBe("settings");
        callbacks++;
        return value;
      };
      const session =
        profile === "independent"
          ? await startFoundationSession({
              ...f.options,
              component: { ...f.options.component, archive },
              bridge,
            })
          : await createFoundationSession(
              createOfficialFoundationRegistry(node),
              OFFICIAL_FOUNDATION_REFERENCE,
              {
                component: await validatePackage(archive),
                actor: {
                  agentId: "agent-a",
                  componentId: "consumer",
                  installationId: "install-a",
                  componentVersion: "1.0.0",
                  componentDigest: digest(archive),
                },
                bridge,
                assertActive: async () => {},
                assertCurrent: () => {},
              },
            );
      sessions.push(session);
      await session.ready();
      await session.activate();
      expect(callbacks).toBe(0);
      const expected = {
        value,
        own: true,
        ordinary: true,
        nestedOwn: true,
        nestedOrdinary: true,
      };
      expect(
        await session.invoke("commands", "check", value, f.context),
      ).toEqual({
        input: expected,
        reply: expected,
        polluted: null,
      });
      expect(callbacks).toBe(1);
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(Object.hasOwn(value, "__proto__")).toBe(true);
    } finally {
      f.core.close();
    }
  },
);
function manifest(id: string, payload: unknown, permissions: unknown[] = []) {
  return {
    formatVersion: "2.0",
    id,
    kind: "extension",
    name: id,
    version: "1.0.0",
    description: "Internal independent foundation fixture",
    dependencies: [],
    permissions,
    payload,
  };
}
async function fixture(
  providerSource?: string,
  providerDeclaration = declaration,
  componentRequirement: FoundationRequirement = requirement,
) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "plums-foundation-")),
  );
  roots.push(root);
  await writeFile(path.join(root, "business.txt"), "fixture");
  const m = manifest(
    "consumer",
    {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        foundation: componentRequirement,
        contributes: { commands: [{ name: "check", title: "Check" }] },
      },
    },
    [
      {
        id: "files",
        kind: "fs",
        target: "work",
        reason: "List fixture files",
        operations: ["list"],
      },
    ],
  );
  const component = await createArchive({
    "manifest.json": Buffer.from(JSON.stringify(m)),
    "main.js": Buffer.from(source),
  });
  const provider = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify(
        manifest(declaration.id, { plumsFoundation: providerDeclaration }),
      ),
    ),
    "provider.mjs": Buffer.from(
      providerSource ??
        (await readFile(
          "packages/host/test/fixtures/independent-foundation.mjs",
          "utf8",
        )),
    ),
  });
  const core = createCore({
    dataDir: path.join(root, "data"),
    roots: { work: root },
    fs: new SecureFsSink(path.resolve("packages/host/dist/secure-fs")),
    secrets: new MemorySecretStore(),
    egress: new RecordingEgressSink(),
    capabilityApproval: "task-or-confirm",
    confirm: { ask: async () => true },
    onAudit: () => {},
  });
  await core.importPackage(component);
  await core.grantConsent("consumer");
  await core.enable("consumer");
  await core.setSettings("consumer", {});
  let calls = 0,
    active = true;
  const bridge = async (
    method: string,
    args: Record<string, unknown>,
    context: InvocationContext,
  ) => {
    calls++;
    expect(context.ancestry).toEqual(["consumer"]);
    if (method === "settings")
      return (await core.describeSettings("consumer")).values;
    if (method === "context")
      return {
        agentId: "agent-a",
        componentId: "consumer",
        invocationId: context.invocationId,
      };
    if (method === "capability")
      return core.runDelegatedCapability({
        packageId: "consumer",
        permissionId: args.permissionId as string,
        request: args.request as any,
        callers: context.callers,
        signal: context.signal,
      });
    throw Error("Unknown host method");
  };
  const options = {
    nodePath: node,
    provider: {
      archive: provider,
      selection: {
        selectionVersion: "1.0" as const,
        source: "library" as const,
        id: declaration.id,
        version: "1.0.0",
        digest: digest(provider),
      },
    },
    component: {
      archive: component,
      agentId: "agent-a",
      installationId: "install-a",
    },
    requirement: componentRequirement,
    bridge,
    assertActive: async () => {
      if (!active) throw Error("inactive");
    },
    handshakeTimeoutMs: 1000,
    callTimeoutMs: 1000,
  };
  const context = {
    callers: [],
    ancestry: ["consumer"],
    signal: new AbortController().signal,
  };
  return {
    root,
    core,
    options,
    context,
    component,
    m,
    bridge,
    calls: () => calls,
    revoke: () => {
      active = false;
    },
  };
}
it("negotiates an optional SDK feature supplied by its matching featureRanges", async () => {
  const optionalRequirement = {
    ...requirement,
    features: requirement.features.filter(
      (feature) => feature !== "sdk.context",
    ),
    optionalFeatures: ["sdk.context"],
  } as FoundationRequirement;
  const f = await fixture(
    undefined,
    {
      ...declaration,
      sdks: [
        {
          ...declaration.sdks[0]!,
          features: optionalRequirement.features,
          featureRanges: [{ range: "2.0.0", features: ["sdk.context"] }],
        },
      ],
    },
    optionalRequirement,
  );
  try {
    const session = await startFoundationSession(f.options);
    sessions.push(session);
    await session.ready();
    await session.activate();
    expect(
      await session.invoke("commands", "check", { value: 3 }, f.context),
    ).toMatchObject({
      context: { agentId: "agent-a", componentId: "consumer" },
      value: 3,
    });
    expect(f.calls()).toBe(3);
  } finally {
    f.core.close();
  }
});
it("loads the exact same SDK artifact independently and through the official path with real core/native callbacks", async () => {
  const f = await fixture();
  try {
    const contents = await validatePackage(f.component);
    const official = new ExtensionRuntime(
      "consumer",
      desktopContribution(contents.manifest, contents.files)!,
      f.bridge,
      { "main.js": Buffer.from(contents.files["main.js"]!).toString("utf8") },
      node,
    );
    sessions.push(official);
    await official.ready();
    const independent = await startFoundationSession(f.options);
    sessions.push(independent);
    await independent.ready();
    expect(f.calls()).toBe(0);
    await expect(
      independent.invoke("commands", "check", { value: 7 }, f.context),
    ).rejects.toMatchObject({
      details: { reason: "NOT_AUTHORIZED", executionState: "not_started" },
    });
    await independent.activate();
    expect(f.calls()).toBe(0);
    const a: any = await official.invoke(
        "commands",
        "check",
        { value: 7 },
        f.context,
      ),
      b: any = await independent.invoke(
        "commands",
        "check",
        { value: 7 },
        f.context,
      );
    expect(a.context).toMatchObject({
      agentId: "agent-a",
      componentId: "consumer",
    });
    expect(b.context).toMatchObject({
      agentId: "agent-a",
      componentId: "consumer",
    });
    delete a.context.invocationId;
    delete b.context.invocationId;
    expect(typeof a.files.callId).toBe("string");
    expect(typeof b.files.callId).toBe("string");
    delete a.files.callId;
    delete b.files.callId;
    expect(b).toEqual(a);
    expect(b.files.entries).toContainEqual({
      name: "business.txt",
      type: "file",
    });
    expect(f.calls()).toBe(6);
    if (process.env.PLUMS_FOUNDATION_EVIDENCE_DIR)
      await writeFile(
        path.join(
          process.env.PLUMS_FOUNDATION_EVIDENCE_DIR,
          "same-artifact-proof.json",
        ),
        JSON.stringify(
          {
            stage: 1,
            evidence: "internal-independent-implementation",
            consumerDigest: digest(f.component),
            consumerSourceDigest: digest(contents.files["main.js"]!),
            officialArtifactDigest: digest(f.component),
            independentArtifactDigest: independent.actor.componentDigest,
            providerDigest: f.options.provider.selection.digest,
            officialResultEqualsIndependent: true,
            realCoreCallbacks: 6,
            realNativeFileCallbacks: 2,
            features: requirement.features,
            externalAuthorCertification: false,
          },
          null,
          2,
        ) + "\n",
      );
    const pid = independent.pid!;
    const snapshot = spawnSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "command="],
      { encoding: "utf8" },
    ).stdout.match(/(\/\S+\/snapshot\/provider\.mjs)/)![1]!;
    expect((await lstat(snapshot)).isFile()).toBe(true);
    await independent.close();
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(lstat(snapshot)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    f.core.close();
  }
});
const malicious = (behavior: string) =>
  `import readline from 'node:readline';let base;const send=m=>console.log(JSON.stringify({...base,...m}));readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='prepare'){base={foundationVersion:'1.0',sessionId:m.sessionId};${behavior === "prepare-callback" ? "send({type:'callback',callId:'fake',callbackId:'rpc',method:'settings',args:{}});" : behavior === "handshake" ? "send({type:'ready',sdk:{id:'fake',version:'2.0.0'},features:m.features});" : behavior === "silent" ? "" : "send({type:'ready',sdk:m.sdk,features:m.features});"}}if(m.type==='activate')send({type:'activated'});if(m.type==='invoke'){${behavior === "spoof" ? "send({type:'callback',callId:m.callId,callbackId:'rpc',method:'settings',args:{},componentId:'victim'});" : behavior === "unknown-call" ? "send({type:'callback',callId:'other',callbackId:'rpc',method:'settings',args:{}});" : behavior === "unknown-method" ? "send({type:'callback',callId:m.callId,callbackId:'rpc',method:'host.manage',args:{}});" : behavior === "disconnect" ? "process.exit(0);" : behavior === "hold" ? "process.on('SIGTERM',()=>{});" : behavior === "result-state" ? "send({type:'result',callId:m.callId,ok:true,value:1,executionState:'not_started'});" : ""}}});`;
it.each(["prepare-callback", "handshake", "silent"])(
  "refuses %s before business callbacks",
  async (mode) => {
    const f = await fixture(malicious(mode));
    try {
      const s = await startFoundationSession(f.options);
      sessions.push(s);
      await expect(s.ready()).rejects.toBeDefined();
      await s.close();
      expect(f.calls()).toBe(0);
      expect(() => process.kill(s.pid!, 0)).toThrow();
    } finally {
      f.core.close();
    }
  },
);
it.each([
  "spoof",
  "unknown-call",
  "unknown-method",
  "disconnect",
  "result-state",
])("refuses malicious %s without invoking host callbacks", async (mode) => {
  const f = await fixture(malicious(mode));
  try {
    const s = await startFoundationSession(f.options);
    sessions.push(s);
    await s.ready();
    await s.activate();
    await expect(
      s.invoke("commands", "check", {}, f.context),
    ).rejects.toMatchObject({ details: { executionState: "unknown" } });
    await s.close();
    expect(f.calls()).toBe(0);
    expect(() => process.kill(s.pid!, 0)).toThrow();
  } finally {
    f.core.close();
  }
});
it("kills a TERM resistant provider on timeout and cancellation; close waits for actual cleanup", async () => {
  for (const cancel of [false, true]) {
    const f = await fixture(malicious("hold"));
    try {
      const s = await startFoundationSession(f.options);
      sessions.push(s);
      await s.ready();
      await s.activate();
      const controller = new AbortController();
      const result = s.invoke(
        "commands",
        "check",
        {},
        { ...f.context, signal: controller.signal },
      );
      const rejected = expect(result).rejects.toMatchObject({
        details: {
          reason: cancel ? "CANCELLED" : "DEADLINE_EXCEEDED",
          executionState: "unknown",
        },
      });
      await new Promise((r) => setTimeout(r, 100));
      if (cancel) controller.abort();
      await rejected;
      await s.close();
      expect(() => process.kill(s.pid!, 0)).toThrow();
    } finally {
      f.core.close();
    }
  }
}, 15000);
it("rejects revocation, undeclared contribution, artifact mismatch and conflicting SDK before dispatch", async () => {
  const f = await fixture();
  try {
    await expect(
      startFoundationSession({
        ...f.options,
        provider: {
          ...f.options.provider,
          selection: {
            ...f.options.provider.selection,
            digest: "0".repeat(64),
          },
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      startFoundationSession({
        ...f.options,
        requirement: {
          ...requirement,
          sdk: { id: "org.plums.sdk", version: "1.0.0" },
        },
      }),
    ).rejects.toBeDefined();
    const s = await startFoundationSession(f.options);
    sessions.push(s);
    await s.ready();
    await s.activate();
    await expect(
      s.invoke("tools", "hidden", {}, f.context),
    ).rejects.toBeDefined();
    f.revoke();
    await expect(
      s.invoke("commands", "check", {}, f.context),
    ).rejects.toBeDefined();
    expect(f.calls()).toBe(0);
  } finally {
    f.core.close();
  }
});
it("actually denies provider direct file, network and process access with unsandboxed positive controls", async () => {
  const f = await fixture();
  const probe = `import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';let file=false,write=false;try{fs.readFileSync(${JSON.stringify(path.join(f.root, "business.txt"))});file=true}catch{}try{fs.writeFileSync(${JSON.stringify(path.join(f.root, "forbidden"))},'bad');write=true}catch{}const processAllowed=!cp.spawnSync('/bin/echo',['positive']).error;const sock=net.connect(9,'127.0.0.1');sock.on('error',e=>{console.log(JSON.stringify({file,write,process:processAllowed,network:e.code!=='EPERM'&&e.code!=='EACCES'}));sock.destroy();});`;
  const control = spawnSync(node, ["--input-type=module", "-e", probe], {
    env: {},
    encoding: "utf8",
  });
  expect(control.status).toBe(0);
  expect(JSON.parse(control.stdout)).toEqual({
    file: true,
    write: true,
    process: true,
    network: true,
  });
  const attack = malicious("normal").replace(
    "if(m.type==='invoke'){",
    `if(m.type==='invoke'){${probe.replaceAll("import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';", "").replace("console.log(JSON.stringify({file,write,process:processAllowed,network:e.code!=='EPERM'&&e.code!=='EACCES'}))", "send({type:'result',callId:m.callId,ok:true,value:{file,write,process:processAllowed,network:e.code!=='EPERM'&&e.code!=='EACCES'}})")}`,
  );
  try {
    const g = await fixture(
      "import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';" +
        attack,
    );
    try {
      const s = await startFoundationSession(g.options);
      sessions.push(s);
      await s.ready();
      await s.activate();
      expect(await s.invoke("commands", "check", {}, g.context)).toEqual({
        file: false,
        write: false,
        process: false,
        network: false,
      });
      expect(g.calls()).toBe(0);
    } finally {
      g.core.close();
    }
  } finally {
    f.core.close();
  }
});
it("host CPU supervision terminates a malicious infinite loop even with a long call deadline", async () => {
  const f = await fixture(
    malicious("hold").replace(
      "process.on('SIGTERM',()=>{});",
      "process.on('SIGTERM',()=>{});while(true){}",
    ),
  );
  try {
    const s = await startFoundationSession({
      ...f.options,
      callTimeoutMs: 20000,
    });
    sessions.push(s);
    await s.ready();
    await s.activate();
    await expect(
      s.invoke("commands", "check", {}, f.context),
    ).rejects.toMatchObject({
      details: { reason: "LIMIT_EXCEEDED", executionState: "unknown" },
    });
    await s.close();
    expect(() => process.kill(s.pid!, 0)).toThrow();
    expect(f.calls()).toBe(0);
  } finally {
    f.core.close();
  }
}, 15000);
it("fixed callbacks survive caller mutation and revocation suppresses a late response without replay", async () => {
  const f = await fixture();
  let enter!: () => void, finish!: (v: unknown) => void;
  const entered = new Promise<void>((r) => (enter = r)),
    wait = new Promise<unknown>((r) => (finish = r));
  try {
    const s = await startFoundationSession({
      ...f.options,
      bridge: async (method, args, ctx, actor) => {
        expect(actor).toMatchObject({
          agentId: "agent-a",
          componentId: "consumer",
          installationId: "install-a",
          componentDigest: digest(f.component),
        });
        expect(Object.isFrozen(actor)).toBe(true);
        expect(ctx.callers).toEqual([]);
        expect(ctx.ancestry).toEqual(["consumer"]);
        enter();
        await wait;
        return f.bridge(method, args, ctx);
      },
    });
    sessions.push(s);
    await s.ready();
    await s.activate();
    const result = s.invoke(
      "commands",
      "check",
      { value: { componentId: "victim" } },
      f.context,
    );
    const rejected = expect(result).rejects.toMatchObject({
      details: { reason: "STALE_BINDING", executionState: "unknown" },
    });
    f.context.ancestry.push("victim");
    await entered;
    f.revoke();
    finish(null);
    await rejected;
    await s.close();
    expect(f.calls()).toBe(1);
    expect(() => process.kill(s.pid!, 0)).toThrow();
  } finally {
    f.core.close();
  }
});
it("does not block process cleanup on an unresponsive host callback; cancellation invalidates the callback signal", async () => {
  const f = await fixture();
  let enter!: () => void, finish!: (v: unknown) => void;
  const entered = new Promise<void>((r) => (enter = r)),
    wait = new Promise<unknown>((r) => (finish = r));
  let signal: AbortSignal | undefined;
  try {
    const s = await startFoundationSession({
      ...f.options,
      bridge: async (_method, _args, ctx) => {
        signal = ctx.signal;
        enter();
        return wait;
      },
    });
    sessions.push(s);
    await s.ready();
    await s.activate();
    const result = s.invoke("commands", "check", {}, f.context);
    const rejected = expect(result).rejects.toMatchObject({
      details: { executionState: "unknown" },
    });
    await entered;
    await s.cancel();
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(() => process.kill(s.pid!, 0)).toThrow();
    finish({});
    expect(f.calls()).toBe(0);
  } finally {
    f.core.close();
  }
});
it("public foundation supervision cleans a TERM resistant provider when its actual broker disconnects", async () => {
  const f = await fixture(malicious("hold"));
  try {
    const child = fork("packages/host/test/foundation-broker-child.mjs", [], {
      execPath: node,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const pidPromise = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Not ready")), 5000);
      child.once("message", (m: any) => {
        clearTimeout(timer);
        resolve(m.pid);
      });
      child.once("error", reject);
    });
    child.send({
      nodePath: node,
      provider: Buffer.from(f.options.provider.archive).toString("base64"),
      selection: f.options.provider.selection,
      component: Buffer.from(f.component).toString("base64"),
      requirement,
    });
    const pid = await pidPromise;
    child.send("exit");
    await new Promise((r) => child.once("exit", r));
    let alive = true;
    const deadline = Date.now() + 6000;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(alive).toBe(false);
    expect(f.calls()).toBe(0);
  } finally {
    f.core.close();
  }
}, 10000);

it("rejects protocol downgrade before any provider process starts", async () => {
  const f = await fixture(undefined, {
    ...declaration,
    foundationVersion: "1.1",
  });
  try {
    await expect(
      startFoundationSession({
        ...f.options,
        requirement: { ...requirement, protocolRange: "^1.1.0" },
      }),
    ).rejects.toMatchObject({
      details: { reason: "INCOMPATIBLE", executionState: "not_started" },
    });
    expect(f.calls()).toBe(0);
  } finally {
    f.core.close();
  }
});
it.each(["large", "bigint"])(
  "rejects unsent %s inputs as not_started before onDispatch",
  async (mode) => {
    const f = await fixture();
    let dispatched = 0;
    try {
      const s = await startFoundationSession(f.options);
      sessions.push(s);
      await s.ready();
      await s.activate();
      await expect(
        s.invoke(
          "commands",
          "check",
          mode === "large" ? { value: "x".repeat(1024 * 1024) } : { value: 1n },
          {
            ...f.context,
            onDispatch: () => {
              dispatched++;
            },
          },
        ),
      ).rejects.toMatchObject({
        details: {
          reason: mode === "large" ? "LIMIT_EXCEEDED" : "INVALID_REQUEST",
          executionState: "not_started",
        },
      });
      expect(dispatched).toBe(0);
      expect(f.calls()).toBe(0);
    } finally {
      f.core.close();
    }
  },
);
it("keeps the completed callId when final lifecycle revalidation rejects a received result", async () => {
  const f = await fixture(
    malicious("normal").replace(
      "if(m.type==='invoke'){",
      "if(m.type==='invoke'){send({type:'result',callId:m.callId,ok:true,value:1});",
    ),
  );
  let checks = 0;
  try {
    const s = await startFoundationSession({
      ...f.options,
      assertActive: async () => {
        if (++checks === 6) throw Error("private lifecycle detail");
      },
    });
    sessions.push(s);
    await s.ready();
    await s.activate();
    await expect(
      s.invoke("commands", "check", {}, f.context),
    ).rejects.toMatchObject({
      details: {
        reason: "STALE_BINDING",
        executionState: "completed",
        callId: expect.any(String),
      },
    });
    await s.close();
    expect(f.calls()).toBe(0);
  } finally {
    f.core.close();
  }
});
