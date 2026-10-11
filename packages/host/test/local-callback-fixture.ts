import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
  type AuditEvent,
  type ManifestV2,
} from "@plumsjs/core";
import { DesktopHost, type HostOptions } from "../src/host.js";
import { engineManifest } from "./platform-fixtures.js";
import { addPolicy, select, grant } from "./policy-fixture.js";

export const callbackActors = ["caller", "engine-demo", "middle", "store"];
const operations = ["read", "write", "delete"] as const;
const permissions: ManifestV2["permissions"] = [
  {
    id: "data",
    kind: "fs",
    target: "agent-data",
    operations: ["write"],
    reason: "Fixture file",
  },
  {
    id: "records",
    kind: "resource",
    target: "agent",
    operations: [...operations],
    reason: "Fixture records",
  },
];
const requires = (id: string, protocol: string) => ({
  requires: [{ id, protocol, range: "^1.0.0" }],
});
const provides = (
  id: string,
  protocol: string,
  kind: "commands" | "tools",
  name: string,
) => ({
  provides: [{ id, protocol, version: "1.0.0", contribution: { kind, name } }],
});
const common = {
  commonVersion: "1.0",
  features: ["resources-cas", "task-attach"],
  runtime: "isolate",
  background: true,
  resources: [
    { id: "records", permissionId: "records", operations: [...operations] },
  ],
};
const native = `import{createInterface}from'node:readline';
let next=0;const callbacks=new Map;const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));
createInterface({input:process.stdin}).on('line',m=>{m=JSON.parse(m);
if(m.method==='initialize'){send({id:m.id,result:{protocol:'jsonrpc-jsonl-v1'}});return;}
if(m.method==='$/cancelRequest'){for(const[id,parent]of callbacks)if(parent===m.params.id)callbacks.delete(id);send({id:m.params.id,result:{cancelled:true}});return;}
if(callbacks.has(m.id)){const parent=callbacks.get(m.id);callbacks.delete(m.id);send({id:parent,result:m.error?{refused:m.error.data}:m.result});return;}
if(m.method==='echo'){send({id:m.id,result:m.params});return;}
const id='callback-'+(++next);callbacks.set(id,m.id);send({id,method:'host.invokeProtocol',parentRequestId:m.id,params:{requirementId:'middle',input:m.params,ancestry:['store'],callerIds:[],taskId:'forged',engineScope:'other/local'}});
});`;
const storeSource = `export function activate(s){const run=async v=>{const i=v.input??v;
if(i.op==='fs')return s.capability('data',{kind:'fs',operation:'write',path:'callback.txt',data:[1,2,3]});
if(i.op==='hang')await new Promise(()=>{});
if(i.op==='benchmark-hang'){await s.emit('benchmark.started',null);await new Promise(()=>{});}
if(i.op==='list')return s.resources.list();
const binding=i.binding??(await s.resources.list()).find(r=>r.requirementId==='records')?.binding;
if(i.op==='handle')return binding;
if(i.op==='write')return s.resources.write(binding,'record',i.revision??'0',i.value);
return s.resources.read(binding,'record');};s.register('tools','records',run);s.register('commands','direct',run);}`;

export async function callbackFixture(
  options: {
    omitPermission?: string;
    qualification?: string;
    rangeOmit?: string;
    rangeReadOnly?: boolean;
    noRange?: boolean;
    policy?: string;
    noPolicyLease?: boolean;
    policyOmit?: string;
    localContributionTools?: boolean;
    audit?: (event: Readonly<AuditEvent>) => Promise<void>;
  } = {},
  track?: (host: DesktopHost, directory: string) => void,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-local-callbacks-")),
    confirm = { ask: vi.fn(async () => true) },
    fs = new RecordingFsSink(),
    audit: Readonly<AuditEvent>[] = [];
  let auditHook = options.audit ?? (async () => {});
  const stores = new Map<string, MemorySecretStore>();
  const hostOptions: HostOptions = {
    dataDir: dir,
    confirm,
    fs,
    egress: new RecordingEgressSink(),
    secretStore: (id) => {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
    audit: async (_id, event) => {
      audit.push(event);
      await auditHook(event);
    },
  };
  const host = new DesktopHost(hostOptions);
  track?.(host, dir);
  await host.initialize();
  const digests: string[] = [];
  for (const id of callbackActors) {
    const desktop = {
      sdkVersion: "2",
      runtime: "main.js",
      common:
        id === options.omitPermission ? { ...common, resources: [] } : common,
      contributes:
        id === "engine-demo" && options.localContributionTools
          ? { tools: [{ name: "run", title: "Run" }] }
          : id === "store"
            ? {
                tools: [{ name: "records", title: "Records" }],
                commands: [{ name: "direct", title: "Direct" }],
              }
            : { commands: [{ name: "run", title: "Run" }] },
      protocols:
        id === "caller"
          ? requires("local", "org.example.local-callback")
          : id === "engine-demo"
            ? {
                ...provides(
                  "local",
                  "org.example.local-callback",
                  options.localContributionTools ? "tools" : "commands",
                  "run",
                ),
                ...requires("middle", "org.example.middle-callback"),
              }
            : id === "middle"
              ? {
                  ...provides(
                    "middle",
                    "org.example.middle-callback",
                    "commands",
                    "run",
                  ),
                  ...requires("records", "org.example.records-callback"),
                }
              : provides(
                  "records",
                  "org.example.records-callback",
                  "tools",
                  "records",
                ),
    };
    const manifest: ManifestV2 = {
      formatVersion: "2.0",
      id,
      kind: "extension",
      name: id,
      version: "1.0.0",
      description: "Synthetic local callback fixture",
      dependencies: [],
      permissions:
        id === options.omitPermission ? [] : structuredClone(permissions),
      payload: { plumsDesktop: desktop },
    };
    const files: Record<string, Buffer> = {};
    if (id === "engine-demo") {
      manifest.permissions.push(
        engineManifest().permissions[0] as ManifestV2["permissions"][number],
      );
      Object.assign(desktop, {
        engines: (engineManifest().payload as any).plumsDesktop.engines,
      });
      files["engine/main.mjs"] = Buffer.from(native);
    }
    files["main.js"] = Buffer.from(
      id === "store"
        ? storeSource
        : id === "middle"
          ? `export function activate(s){s.register('commands','run',async i=>{const b=await s.common.binding('records');const task=i.background?await s.common.tasks.create({lifetime:'agent',timeoutMs:60000}):undefined;const c=await s.common.invoke(b.handle,'records',i,task?{taskId:task.taskId}:{});return i.detached?{taskId:c.taskId}:c.result;});}`
          : id === "engine-demo"
            ? `export function activate(s){s.register('${options.localContributionTools ? "tools" : "commands"}','run',async i=>{await s.engine.start('local');return s.engine.request('local','callback',i.input??i);});}`
            : `export function activate(s){s.register('commands','run',async i=>{if(i.common){const b=await s.common.binding('local');const c=await s.common.invoke(b.handle,'run',i,{timeoutMs:i.timeoutMs??60000});return i.parentDetached?{taskId:c.taskId}:c.result;}return s.protocols.invoke('local',i);});}`,
    );
    const bytes = await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      ...files,
    });
    digests.push(
      (
        await host.importLibrary(
          ((await host.preview(bytes)) as { token: string }).token,
        )
      ).digest,
    );
  }
  const { instanceId: id } = await host.createAgent(
    "Local callback fixture",
    digests,
  );
  for (const pkg of [...callbackActors].reverse()) await host.enable(id, pkg);
  const space = (await host.resourcePlan(id)).spaces.find(
    (s) => s.ownerAgentId === id,
  )!;
  for (const componentId of [
    "",
    ...callbackActors.filter((p) => p !== options.omitPermission),
  ])
    await host.setResourceQualification(
      id,
      (await host.resourcePlan(id)).fingerprint,
      space.id,
      componentId,
      componentId === options.qualification ? ["read"] : [...operations],
    );
  for (const pkg of callbackActors.filter((p) => p !== options.omitPermission))
    await host.setResourceBinding(
      id,
      (await host.resourcePlan(id)).fingerprint,
      pkg,
      "records",
      space.id,
    );
  if (options.policy) {
    await addPolicy(host, id, "callback", options.policy);
    await select(host, id, "callback");
  }
  if (!options.noRange) {
    const plan = await host.resourcePlan(id);
    await host.grantResourceRange(
      id,
      plan.fingerprint,
      "task",
      900000,
      plan.bindings
        .filter((b) => b.componentId !== options.rangeOmit)
        .map((b) => ({
          componentId: b.componentId,
          resourceId: b.resourceId,
          operations:
            options.rangeReadOnly || b.componentId === options.qualification
              ? ["read"]
              : [...operations],
        })),
    );
  }
  if (options.policy && !options.noPolicyLease)
    await grant(
      host,
      id,
      (row) =>
        (row as { componentId: string; category: string; target: string })
          .componentId !== options.policyOmit,
    );
  const selection = {
    ceiling: "machine" as const,
    projects: [],
    readOnly: [],
    components: ["engine-demo"],
  };
  await host.confirmTier(
    id,
    ((await host.tierPlan(id, selection)) as { fingerprint: string })
      .fingerprint,
    selection,
  );
  confirm.ask.mockClear();
  const run = (input: unknown, signal?: AbortSignal) =>
    host.invoke(id, "caller", "caller", "commands", "run", input, signal);
  const direct = (input: unknown) =>
    host.invoke(id, "store", "store", "commands", "direct", input);
  return {
    host,
    dir,
    id,
    fs,
    audit,
    confirm,
    run,
    direct,
    space: space.id,
    options: hostOptions,
    setAudit: (hook: typeof auditHook) => {
      auditHook = hook;
    },
  };
}
