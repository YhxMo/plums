import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArchive, MemorySecretStore, type ManifestV2 } from "@plums/core";
import { DesktopHost } from "../src/host.js";
export async function workspaceFixture(
  runtime: "isolate" | "controlled-node" = "isolate",
  backendFrontend = false,
  backendCommon = true,
  nested = false,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-workspace-"));
  const events: { packageId: string; topic: string }[] = [];
  const options = {
    dataDir: dir,
    nodePath: path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node"),
    secretStore: () => new MemorySecretStore(),
    confirm: { ask: async () => true },
    event: (_instanceId: string, packageId: string, topic: string) => {
      events.push({ packageId, topic });
    },
  };
  const host = new DesktopHost(options);
  await host.initialize();
  const items = [];
  for (const id of ["screen-a", "screen-b", "backend-a", "backend-b"]) {
    const ui = id.startsWith("screen");
    const manifest: ManifestV2 = {
      formatVersion: "2.0",
      id,
      kind: "extension",
      name: id,
      version: "1.0.0",
      description: "Internal platform fixture",
      dependencies: [],
      permissions: [],
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          ...(ui ||
          (backendFrontend &&
            (id === "backend-a" || (nested && id === "backend-b")))
            ? { frontend: "index.html" }
            : {}),
          ...(ui || backendCommon || (nested && id === "backend-a")
            ? {
                common: {
                  commonVersion: "1.0",
                  features: ["events", "task-attach", "ui-attach"],
                  runtime: ui ? "isolate" : runtime,
                  background: true,
                },
              }
            : {}),
          contributes: ui ? {} : { tools: [{ name: "reply", title: "Reply" }] },
          protocols: ui
            ? {
                requires: [
                  {
                    id: "backend",
                    protocol: "org.example.platform-fixture",
                    range: "^1.0.0",
                    features: ["reply"],
                  },
                ],
              }
            : {
                ...(nested && id === "backend-a"
                  ? {
                      requires: [
                        {
                          id: "nested",
                          protocol: "org.example.platform-fixture",
                          range: "^1.0.0",
                          features: ["reply"],
                        },
                      ],
                    }
                  : {}),
                provides: [
                  {
                    id: "reply",
                    protocol: "org.example.platform-fixture",
                    version: "1.0.0",
                    features: ["reply"],
                    contribution: { kind: "tools", name: "reply" },
                  },
                ],
              },
        },
      },
    };
    const code = ui
      ? "export function activate(){}"
      : `export async function activate(s){await s.emit('startup',{provider:'${id}',text:'synthetic-startup-body'});s.register('tools','reply',async v=>{const context=await s.context();${backendCommon || (nested && id === "backend-a") ? `await s.emit('ready',{provider:'${id}',${runtime === "controlled-node" ? "pid:process.pid," : ""}context});` : ""}${nested && id === "backend-a" ? "if(v.operation==='nested')return s.protocols.invoke('nested',{operation:'hold',input:v.input});" : ""}if(v.operation==='hold')await new Promise(()=>{});return {provider:'${id}',input:v.input,context};});}`;
    const markup =
      id === "screen-a"
        ? '<h1>输入面板</h1><label>测试输入<input id="input" value="synthetic-input"></label><button id="run">执行</button><p id="result" role="status">等待执行</p>'
        : '<h1>状态面板</h1><button id="run">读取回复</button><dl><dt>回复</dt><dd id="result" role="status">等待执行</dd></dl>';
    const script = `window.run=async()=>{const b=await plums.common.binding('backend');const c=await plums.common.invoke(b.handle,'echo',{text:document.querySelector('#input')?.value??'synthetic-input'});const r=await c.result;document.querySelector('#result').textContent=r.outcome.value.provider;return r};document.querySelector('#run').onclick=()=>window.run().catch(e=>window.lastError=e);plums.context().then(c=>{window.own=c;window.fixtureReady=true});`;
    const p = (await host.preview(
      await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(manifest)),
        "main.js": Buffer.from(code),
        "index.html": Buffer.from(
          `<!doctype html><meta charset="utf-8"><title>${id}</title><link rel="stylesheet" href="style.css">${markup}<script src="ui.js"></script>`,
        ),
        "other.html": Buffer.from("<title>forbidden-local-navigation</title>"),
        "ui.js": Buffer.from(script),
        "style.css": Buffer.from(
          "*{box-sizing:border-box}body{margin:0;padding:16px;background:#f7f6f3;color:#24241f;font:16px/1.5 system-ui}h1{font-size:20px}button,input{font:inherit;min-height:44px;max-width:100%}label{display:grid;gap:8px}input{width:100%}p,dd{overflow-wrap:anywhere}:focus-visible{outline:3px solid #287451;outline-offset:3px}",
        ),
      }),
    )) as { token: string };
    items.push(await host.importLibrary(p.token));
  }
  const digests = items.map((i) => i.digest),
    plan = await host.planAssembly(digests);
  const choices = plan.protocols.map(
    (r) =>
      r.candidates.find(
        (c) =>
          c.intent.providerId ===
          (r.consumerId === "backend-a" ? "backend-b" : "backend-a"),
      )!.intent,
  );
  const a = await host.createAgent(
    "Workspace fixture",
    digests,
    undefined,
    "screen-a",
    choices,
  );
  const b = await host.createAgent(
    "Workspace peer",
    digests,
    undefined,
    "screen-a",
    choices,
  );
  for (const agent of [a, b])
    for (const item of [...items].sort((a, b) =>
      nested && a.manifest.id === "backend-b"
        ? -1
        : nested && b.manifest.id === "backend-b"
          ? 1
          : a.manifest.id.localeCompare(b.manifest.id),
    ))
      await host.enable(agent.instanceId, item.manifest.id);
  return { host, options, dir, a, b, items, events };
}
