import { DesktopHost, type HostOptions } from "../src/host.js";
import { createArchive, MemorySecretStore, type ManifestV2 } from "@plumsjs/core";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ResourceOperation } from "@plumsjs/sdk";
export const allOps: ResourceOperation[] = ["read", "write", "delete"];
export const providerManifest: ManifestV2 = {
  formatVersion: "2.0",
  id: "records-provider",
  kind: "extension",
  name: "Platform fixture",
  version: "1.0.0",
  description: "Deterministic resource behavior fixture",
  dependencies: [],
  permissions: [
    {
      id: "records",
      kind: "resource",
      target: "business",
      reason: "Fixture business records",
      operations: allOps,
    },
  ],
  payload: {
    plumsDesktop: {
      sdkVersion: "2",
      runtime: "main.js",
      frontend: "index.html",
      common: {
        commonVersion: "1.0",
        features: ["resources-cas"],
        runtime: "isolate",
        resources: [
          { id: "shared", permissionId: "records", operations: allOps },
          { id: "private", permissionId: "records", operations: allOps },
        ],
      },
      contributes: {
        commands: [{ name: "records", title: "Fixture records" }],
      },
    },
  },
};
export const providerSource = `export function activate(s){let saved; s.register('commands','records',async i=>{
 if(i.op==='list')return s.resources.list();
 if(i.op==='remember'){saved=(await s.resources.list()).find(b=>b.resourceId===i.resourceId)?.binding;return saved;}
 const binding=i.binding || (i.saved?saved:(await s.resources.list()).find(b=>b.resourceId===i.resourceId)?.binding);
 if(i.op==='invalid'){try{await s.resources.write(binding,i.key,'0',i.variant==='nan'?{a:NaN}:i.variant==='accessor'?{get a(){throw Error('private accessor')}}:{a:undefined});return {blocked:false};}catch(e){return {blocked:true,code:e.code};}}
 if(i.op==='copy'){const value={state:'before'};const writing=s.resources.write(binding,i.key,'0',value);value.state='after';await writing;return s.resources.read(binding,i.key);}
 if(i.op==='read')return s.resources.read(binding,i.key);
 if(i.op==='write')return s.resources.write(binding,i.key,i.expectedRevision,i.value);
 if(i.op==='delete')return s.resources.delete(binding,i.key,i.expectedRevision);
});}`;
export async function resourceFixture(
  extra: Partial<HostOptions> = {},
  runtime: "isolate" | "controlled-node" = "isolate",
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-resource-"));
  const options: HostOptions = {
    dataDir: dir,
    confirm: { ask: async () => true },
    secretStore: () => new MemorySecretStore(),
    ...extra,
  };
  const host = new DesktopHost(options);
  await host.initialize();
  const preview = (await host.preview(
    await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify({
          ...providerManifest,
          payload: {
            plumsDesktop: {
              ...(providerManifest.payload as any).plumsDesktop,
              common: {
                ...(providerManifest.payload as any).plumsDesktop.common,
                runtime,
              },
            },
          },
        }),
      ),
      "main.js": Buffer.from(providerSource),
      "index.html": Buffer.from(
        "<!doctype html><title>Resource fixture</title><p>Platform resource fixture</p>",
      ),
    }),
  )) as { token: string };
  const artifact = await host.importLibrary(preview.token);
  const a = await host.createAgent("Fixture A", [artifact.digest]),
    b = await host.createAgent("Fixture B", [artifact.digest]);
  await host.enable(a.instanceId, providerManifest.id);
  await host.enable(b.instanceId, providerManifest.id);
  const shared = await host.createResourceGroup(
    a.instanceId,
    (await host.resourcePlan(a.instanceId)).fingerprint,
    "Shared fixture",
  );
  for (const agent of [a, b]) {
    const id = agent.instanceId,
      privateSpace = (await host.resourcePlan(id)).spaces.find(
        (s) => s.ownerAgentId === id,
      )!;
    for (const [slot, space] of [
      ["shared", shared],
      ["private", privateSpace],
    ] as const) {
      for (const component of ["", providerManifest.id])
        await host.setResourceQualification(
          id,
          (await host.resourcePlan(id)).fingerprint,
          space.id,
          component,
          allOps,
        );
      await host.setResourceBinding(
        id,
        (await host.resourcePlan(id)).fingerprint,
        providerManifest.id,
        slot,
        space.id,
      );
    }
  }
  const invoke = (id: string, input: unknown) =>
    host.invoke(
      id,
      providerManifest.id,
      providerManifest.id,
      "commands",
      "records",
      input,
    );
  const grant = async (
    id: string,
    mode: "task" | "full-access" = "task",
    operations = allOps,
  ) => {
    const plan = await host.resourcePlan(id);
    return host.grantResourceRange(
      id,
      plan.fingerprint,
      mode,
      900_000,
      plan.bindings.map((b) => ({
        componentId: b.componentId,
        resourceId: b.resourceId,
        operations,
      })),
    );
  };
  return {
    host,
    dir,
    options,
    a: a.instanceId,
    b: b.instanceId,
    shared: shared.id,
    artifact,
    invoke,
    grant,
  };
}
