/** Internal synthetic adapter. Uses only published core/SDK/host entry points. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createArchive,
  MemorySecretStore,
} from "../packages/core/dist/index.js";
import { createCommonPlatformSdk } from "../packages/sdk/dist/index.js";
import { DesktopHost } from "../packages/host/dist/index.js";

const operations = ["read", "write", "delete"];
const permissions = [
  {
    id: "records",
    kind: "resource",
    target: "business",
    operations,
    reason: "Synthetic records",
  },
  {
    id: "files",
    kind: "fs",
    target: "work",
    operations: ["read", "write"],
    reason: "Synthetic files",
  },
  {
    id: "run",
    kind: "exec",
    target: "echo",
    cwdRoots: ["work"],
    reason: "Synthetic command",
  },
];
const providerSource = (
  implementation,
  runtime,
) => `${runtime === "controlled-node" ? "import fs from 'node:fs';import cp from 'node:child_process';import net from 'node:net';" : ""}
export function activate(s){let calls=0;s.register('tools','probe',async v=>{
 const context=await s.context();const count=++calls;
 if(v.operation==='bad-output')return [];
 if(v.operation==='hold'){await s.emit('ready',{count${runtime === "controlled-node" ? ",pid:process.pid" : ""}});await new Promise(()=>{});}
 if(v.operation==='events')for(let i=0;i<v.input.count;i++)await s.emit('tick',{index:i});
 if(v.operation==='resource'){const b=(await s.resources.list()).find(b=>b.requirementId===v.input.slot);const i=v.input;
  if(i.action==='read')return s.resources.read(b.binding,i.key);
  if(i.action==='write')return s.resources.write(b.binding,i.key,i.revision,i.value);
  if(i.action==='delete')return s.resources.delete(b.binding,i.key,i.revision);}
 if(v.operation==='file')return s.capability('files',{kind:'fs',operation:'read',path:v.input.path});
 if(v.operation==='write')return s.capability('files',{kind:'fs',operation:'write',path:v.input.path,data:[...v.input.data]});
 if(v.operation==='exec')return s.capability('run',{kind:'exec',args:v.input.args,cwd:{root:'work',path:'.'}});
 if(v.operation==='probe'){
  ${
    runtime === "controlled-node"
      ? `let read=false,write=false;try{fs.readFileSync(v.input.path);read=true;}catch{}try{fs.writeFileSync(v.input.path,'changed');write=true;}catch{}
  const spawned=!cp.spawnSync('/bin/echo',['forbidden']).error;
  const network=await new Promise(r=>{const socket=net.connect(v.input.port,'127.0.0.1');socket.once('error',()=>r(false));socket.once('connect',()=>{socket.destroy();r(true);});});return {read,write,spawned,network};`
      : "return {node:typeof process,require:typeof require};"
  }
 }
 ${implementation === "one" ? "return {input:v.input,context,count,implementation:'one'};" : "const response={implementation:'two',count,context};response.input=JSON.parse(JSON.stringify(v.input));return response;"}
});}`;
const consumerSource = `export function activate(s){s.register('commands','run',async v=>{const b=await s.common.binding('backend');const c=await s.common.invoke(b.handle,v.operation,v.input);return c.result;});}`;
const policyBodies = {
  allow: "return decision('allow');",
  deny: "return decision(c.category==='tool'?'allow':'deny');",
  confirm: "return decision(c.category==='tool'?'allow':'confirm');",
  custom:
    "return decision(c.category==='tool'||(c.category==='fs'&&c.intent.path==='allowed.txt')?'allow':'deny');",
};
export async function open({
  runtime = "isolate",
  nodePath,
  createHost = (options) => new DesktopHost(options),
  processRace,
  readAudit,
} = {}) {
  if (!["isolate", "controlled-node"].includes(runtime))
    throw Error("Unsupported runtime");
  return {
    provenance: "internal-fixture",
    runtime,
    async scenario({ unbound = false } = {}) {
      const dir = await mkdtemp(
        path.join(os.tmpdir(), "plums-platform-conformance-"),
      );
      const audit = [],
        confirmations = [];
      let answer = true,
        closed = false,
        host;
      const options = {
        dataDir: path.join(dir, "data"),
        nodePath:
          nodePath ??
          path.resolve(".build-cache/node-v26.5.1-darwin-arm64/bin/node"),
        secretStore: () => new MemorySecretStore(),
        confirm: {
          ask: async (request) => {
            confirmations.push(request);
            return answer;
          },
        },
        audit: async (_id, event) => {
          audit.push(event);
        },
      };
      const artifacts = {},
        agents = {},
        clients = [];
      const makeHost = async () => {
        if (closed) throw Error("Scenario closed");
        host = await createHost(options);
        await host.initialize();
        if (closed) {
          await host.close();
          throw Error("Scenario closed");
        }
      };
      try {
        await makeHost();
        for (const id of [
          "screen-one",
          "screen-two",
          "provider-one",
          "provider-two",
          "provider-incompatible",
          ...Object.keys(policyBodies).map((p) => "policy-" + p),
        ]) {
          const policy = id.startsWith("policy-"),
            screen = id.startsWith("screen-");
          const provides = [
            {
              id: "probe",
              protocol: policy
                ? "org.plums.policy"
                : "org.plums.conformance.probe",
              version: id === "provider-incompatible" ? "2.0.0" : "1.0.0",
              features: policy ? [] : ["probe"],
              contribution: { kind: "tools", name: "probe" },
            },
          ];
          const manifest = {
            formatVersion: "2.0",
            id,
            kind: "extension",
            name: id,
            version: "1.0.0",
            description: "Internal deterministic platform fixture",
            dependencies: [],
            permissions: policy ? [] : permissions,
            payload: {
              plumsDesktop: {
                sdkVersion: "2",
                runtime: "main.js",
                ...(screen ? { frontend: "index.html" } : {}),
                common: {
                  commonVersion: "1.0",
                  features: policy
                    ? ["policy-v1"]
                    : ["events", "task-attach", "resources-cas", "ui-attach"],
                  runtime: policy ? "isolate" : runtime,
                  background: true,
                  ...(policy
                    ? { policy: { provideId: "probe" } }
                    : {
                        resources: ["shared", "private"].map((id) => ({
                          id,
                          permissionId: "records",
                          operations,
                        })),
                      }),
                },
                contributes: screen
                  ? { commands: [{ name: "run", title: "Probe" }] }
                  : {
                      tools: [
                        {
                          name: "probe",
                          title: "Probe",
                          ...(policy
                            ? {}
                            : {
                                inputSchema: {
                                  type: "object",
                                  required: ["operation", "input"],
                                  properties: {
                                    operation: {
                                      enum: [
                                        "echo",
                                        "events",
                                        "hold",
                                        "resource",
                                        "file",
                                        "write",
                                        "exec",
                                        "probe",
                                        "bad-output",
                                      ],
                                    },
                                    input: {},
                                  },
                                  additionalProperties: false,
                                },
                                outputSchema: { type: "object" },
                              }),
                        },
                      ],
                    },
                protocols: screen
                  ? {
                      requires: [
                        {
                          id: "backend",
                          protocol: "org.plums.conformance.probe",
                          range: "^1.0.0",
                          features: ["probe"],
                          optional: true,
                        },
                      ],
                    }
                  : { provides },
              },
            },
          };
          const source = policy
            ? `export function activate(s){s.register('tools','probe',v=>{const c=v.input;const decision=decision=>({assessmentId:c.assessmentId,operationFingerprint:c.operationFingerprint,decision});${policyBodies[id.slice(7)]}});}`
            : screen
              ? consumerSource
              : providerSource(id === "provider-one" ? "one" : "two", runtime);
          const markup =
            id === "screen-one"
              ? '<h1>Probe input</h1><input id="input" value="native-probe"><button id="run">Run</button><output id="result"></output>'
              : '<h1>Probe status</h1><button id="run">Inspect</button><output id="result"></output>';
          const preview = await host.preview(
            await createArchive({
              "manifest.json": Buffer.from(JSON.stringify(manifest)),
              "main.js": Buffer.from(source),
              "index.html": Buffer.from(
                `<!doctype html><meta charset="utf-8"><title>${id}</title>${markup}<script src="ui.js"></script>`,
              ),
              "ui.js": Buffer.from(
                "window.run=async()=>{const b=await plums.common.binding('backend');const c=await plums.common.invoke(b.handle,'echo',{value:document.querySelector('#input')?.value??'native-probe'});const r=await c.result;document.querySelector('#result').textContent=r.outcome.value.implementation;return r};document.querySelector('#run').onclick=()=>run();window.fixtureReady=true;",
              ),
            }),
          );
          artifacts[id] = (await host.importLibrary(preview.token)).digest;
        }
        const digests = Object.values(artifacts),
          plan = await host.planAssembly(digests);
        const choices = unbound
          ? []
          : plan.protocols.map(
              (r) =>
                r.candidates.find((c) => c.intent.providerId === "provider-one")
                  .intent,
            );
        for (const name of ["a", "b"]) {
          agents[name] = (
            await host.createAgent(
              "Conformance " + name.toUpperCase(),
              digests,
              undefined,
              "screen-one",
              choices,
            )
          ).instanceId;
          for (const id of Object.keys(artifacts).sort(
            (a, b) =>
              Number(a.startsWith("screen-")) - Number(b.startsWith("screen-")),
          ))
            await host.enable(agents[name], id);
          const work = path.join(dir, "work-" + name);
          await mkdir(work);
          await writeFile(path.join(work, "allowed.txt"), "fixture-file");
          await writeFile(path.join(work, "blocked.txt"), "second-file");
          await host.bindRoot(agents[name], "work", work);
          if (process.platform === "darwin")
            await host.bindControlledProgram(
              agents[name],
              "echo",
              "/bin/echo",
              ["work"],
              [],
            );
        }
        const shared = await host.createResourceGroup(
          agents.a,
          (await host.resourcePlan(agents.a)).fingerprint,
          "Synthetic shared",
        );
        for (const name of ["a", "b"]) {
          const agent = agents[name],
            own = (await host.resourcePlan(agent)).spaces.find(
              (s) => s.ownerAgentId === agent,
            );
          for (const space of [shared, own]) {
            for (const id of [
              "",
              "screen-one",
              "screen-two",
              "provider-one",
              "provider-two",
              "provider-incompatible",
            ])
              await host.setResourceQualification(
                agent,
                (await host.resourcePlan(agent)).fingerprint,
                space.id,
                id,
                operations,
              );
            for (const component of [
              "screen-one",
              "screen-two",
              "provider-one",
              "provider-two",
              "provider-incompatible",
            ])
              await host.setResourceBinding(
                agent,
                (await host.resourcePlan(agent)).fingerprint,
                component,
                space.id === shared.id ? "shared" : "private",
                space.id,
              );
          }
        }
        const wrap = (front) => {
          if (!front) throw Error("Missing frontend");
          const { sessionId, handle } = front.context;
          const rpc = (method, args) =>
            host.frontendCommon(sessionId, handle, method, args);
          const resourceRpc = (method, args) =>
            host.frontendResource(sessionId, handle, method, args);
          const sdk = createCommonPlatformSdk(rpc, {
            list: () => resourceRpc("list", {}),
            read: (binding, key) => resourceRpc("read", { binding, key }),
            write: (binding, key, expectedRevision, value) =>
              resourceRpc("write", { binding, key, expectedRevision, value }),
            delete: (binding, key, expectedRevision) =>
              resourceRpc("delete", { binding, key, expectedRevision }),
          });
          const result = {
            sdk,
            context: front.context,
            raw: rpc,
            close: () => host.closeFrontend(sessionId),
          };

          return result;
        };
        const scenario = {
          metadata: { runtime, artifacts, agents },
          // Observation and trusted management are outside the business SDK.
          get host() {
            return host;
          },
          dataDir: options.dataDir,
          nodePath: options.nodePath,
          async client(name = "a", component = "screen-one") {
            return wrap(await host.openFrontend(agents[name], component));
          },
          async views() {
            const plan = await host.workspacePlan(agents.a);
            await host.setWorkspaceViews(
              agents.a,
              "screen-one",
              ["screen-two"],
              plan.fingerprint,
            );
            const root = await host.openFrontend(agents.a);
            const side = (
              await host.restoreWorkspace(
                root.context.sessionId,
                root.context.handle,
              )
            ).resources[0];
            return [wrap(root), wrap(side)];
          },
          async choose(name, component, provider) {
            const plan = await host.protocolPlan(agents[name]),
              row = plan.requirements.find(
                (r) =>
                  r.consumerId === component && r.requirement.id === "backend",
              );
            const choice = provider
              ? row.candidates.find((c) => c.intent.providerId === provider)
                  ?.intent
              : undefined;
            if (provider && !choice) throw Error("Incompatible provider");
            await host.setProtocolBinding(
              agents[name],
              plan.fingerprint,
              component,
              "backend",
              choice,
            );
          },
          artifact: async (name, component) =>
            (await host.listAgents())
              .find((a) => a.instanceId === agents[name])
              .components.find((c) => c.packageId === component).digest,
          workPath: (name) => path.join(dir, "work-" + name),
          runtimeCall: (name, input) =>
            host.invoke(
              agents[name],
              "screen-one",
              "screen-one",
              "commands",
              "run",
              input,
            ),
          async grantResources(name) {
            const plan = await host.resourcePlan(agents[name]);
            return host.grantResourceRange(
              agents[name],
              plan.fingerprint,
              "task",
              900_000,
              plan.bindings.map((b) => ({
                componentId: b.componentId,
                resourceId: b.resourceId,
                operations,
              })),
            );
          },
          async processRace(client, binding) {
            if (processRace)
              return processRace({ host, options, agents, client, binding });
            const child = fork(
              fileURLToPath(
                new URL(
                  "./platform-conformance-cas-worker.mjs",
                  import.meta.url,
                ),
              ),
              [options.dataDir, agents.b],
              { stdio: ["ignore", "ignore", "ignore", "ipc"] },
            );
            let exited = false;
            const exit = new Promise((resolve) =>
              child.once("exit", (code) => {
                exited = true;
                resolve(code);
              }),
            );
            const message = () =>
              new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                  child.kill("SIGKILL");
                  reject(Error("Child timeout"));
                }, 10000);
                child.once("message", (value) => {
                  clearTimeout(timer);
                  resolve(value);
                });
                child.once("error", (error) => {
                  clearTimeout(timer);
                  reject(error);
                });
              });
            try {
              const ready = await message();
              if (ready.phase !== "ready" || ready.pid === process.pid)
                throw Error("Child not ready");
              const result = message();
              child.send({ phase: "go" });
              const parent = await client.sdk.resources
                .write(binding, "process-race", "0", "parent")
                .then(
                  (value) => ({ status: "fulfilled", value }),
                  (error) => ({
                    status: "rejected",
                    reason: error.details?.reason,
                  }),
                );
              const peer = await result;
              if ((await exit) !== 0) throw Error("Child failed");
              return { parent, peer, independentProcess: true };
            } finally {
              if (!exited) {
                child.kill("SIGKILL");
                await exit;
              }
            }
          },
          async revokeShared(name) {
            await host.setResourceQualification(
              agents[name],
              (await host.resourcePlan(agents[name])).fingerprint,
              shared.id,
              "",
              [],
            );
          },
          async policy(name, mode, include = () => true) {
            await host.revokePolicyScope(agents[name]);
            let plan = await host.policyPlan(agents[name]);
            await host.selectPolicy(
              agents[name],
              plan.fingerprint,
              "policy-" + mode,
              "probe",
              mode,
            );
            plan = await host.policyPlan(agents[name]);
            await host.grantPolicyScope(
              agents[name],
              plan.fingerprint,
              900_000,
              plan.available.filter(include),
            );
          },
          confirm(value) {
            answer = value;
            confirmations.length = 0;
          },
          confirmationCount: () => confirmations.length,
          file: (name, file = "allowed.txt") =>
            readFile(path.join(dir, "work-" + name, file), "utf8"),
          audit: () =>
            readAudit ? readAudit(options.dataDir) : JSON.stringify(audit),
          async background(name, component = "screen-one") {
            await host.setComponentBackground(agents[name], component, true);
          },
          async restart() {
            await host.close();
            await makeHost();
          },
          async close({ preserve = false } = {}) {
            closed = true;
            await host.close();
            if (!preserve) await rm(dir, { recursive: true, force: true });
          },
        };
        for (const [key, value] of Object.entries(scenario)) {
          if (typeof value === "function" && key !== "close")
            scenario[key] = (...args) => {
              if (closed) throw Error("Scenario closed");
              return value(...args);
            };
        }
        return scenario;
      } catch (error) {
        await host?.close();
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
    },
  };
}
