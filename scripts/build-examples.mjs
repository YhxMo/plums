import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCore,
  MemorySecretStore,
  RecordingEgressSink,
} from "../packages/core/dist/index.js";
import { createAgentBundle } from "../packages/sdk/dist/index.js";
const output = "release/examples";
await mkdir(output, { recursive: true });
const temp = await mkdtemp(path.join(os.tmpdir(), "plums-examples-"));
const core = createCore({
  dataDir: temp,
  secrets: new MemorySecretStore(),
  egress: new RecordingEgressSink(),
});
async function component(name) {
  const root = path.join("examples", name);
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  );
  const files = {};
  async function walk(dir) {
    for (const e of await readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) await walk(rel);
      else if (rel !== "manifest.json")
        files[rel] = new Uint8Array(await readFile(path.join(root, rel)));
    }
  }
  await walk("");
  return core.exportPackage({ manifest, files });
}
try {
  const names = [
    "character",
    "trusted-engine",
    "chat-ui",
    "board-ui",
    "model-connector",
    "mcp-connector",
    "http-connector",
  ];
  const zipped = {};
  for (const name of names) {
    zipped[name] = await component(name);
    await writeFile(path.join(output, name + ".zip"), zipped[name]);
  }
  for (const [name, title, start, extensions, connectors] of [
    [
      "plum-chat",
      "Plum Chat",
      "chat",
      ["chat-ui"],
      ["model-connector", "mcp-connector", "http-connector"],
    ],
    [
      "paper-board",
      "纸上看板",
      "board",
      ["board-ui"],
      ["mcp-connector", "http-connector"],
    ],
  ]) {
    const paths = Object.fromEntries(
      ["character", ...extensions, ...connectors].map((n) => [
        "components/" + n + ".zip",
        zipped[n],
      ]),
    );
    const agent = {
      bundleVersion: "1.0",
      id: name,
      name: title,
      version: name === "plum-chat" ? "2.0.0" : "1.0.0",
      character: "components/character.zip",
      extensions: extensions.map((n) => "components/" + n + ".zip"),
      connectors: connectors.map((n) => "components/" + n + ".zip"),
      startup: start,
    };
    await writeFile(
      path.join(output, name + ".zip"),
      await createAgentBundle(agent, paths),
    );
  }
  await writeFile(path.join(output,"trusted-engine-agent.zip"),await createAgentBundle({bundleVersion:"1.0",id:"trusted-engine-agent",name:"\u672c\u673a\u5f15\u64ce\u793a\u4f8b",version:"1.0.0",extensions:["components/trusted-engine.zip"],connectors:[],startup:"engine-demo"},{"components/trusted-engine.zip":zipped["trusted-engine"]}));
  console.log("Example ZIPs: " + path.resolve(output));
} finally {
  core.close();
  await rm(temp, { recursive: true, force: true });
}
