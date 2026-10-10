import { expect, it } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { DesktopHost } from "../src/host.js";
import { MemorySecretStore, createArchive } from "@plumsjs/core";
it("relocates the exact executing trusted adapter and rejects changed bundle bytes without changing its pin", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-adapter-")),
    options = {
      dataDir: path.join(root, "data"),
      nodePath: path.resolve(".build-cache/node-v26.5.1-darwin-arm64/bin/node"),
      confirm: { ask: async () => true },
      secretStore: () => new MemorySecretStore(),
    },
    source = new DesktopHost(options);
  let relocated: any;
  try {
    const app = path.join(root, "application"),
      adapter = path.join(app, "host-adapter");
    await cp("packages/host/dist/host-adapter", adapter, { recursive: true });
    await cp(
      "packages/host/dist/foundation-resources",
      path.join(app, "foundation-resources"),
      { recursive: true },
    );
    await mkdir(path.join(app, "node_modules"));
    for (const [name, owner] of [
      ["isolated-vm", "host"],
      ["better-sqlite3", "core"],
    ]) {
      const require = createRequire(
        path.resolve("packages", owner!, "package.json"),
      );
      await symlink(
        path.dirname(require.resolve(name! + "/package.json")),
        path.join(app, "node_modules", name!),
      );
    }
    await source.initialize();
    const bytes = await createArchive({
      "manifest.json": Buffer.from(
        JSON.stringify({
          formatVersion: "2.0",
          kind: "extension",
          id: "fixture",
          name: "Fixture",
          version: "1.0.0",
          description: "Internal relocation check",
          dependencies: [],
          permissions: [],
          payload: {
            plumsDesktop: {
              sdkVersion: "2",
              runtime: "main.js",
              contributes: { commands: [{ name: "check", title: "Check" }] },
            },
          },
        }),
      ),
      "main.js": Buffer.from(
        "export function activate(s){s.register('commands','check',async()=>await s.context());}",
      ),
    });
    const preview = (await source.preview(bytes)) as any,
      item = await source.importLibrary(preview.token),
      a = await source.createAgent("A", [item.digest]);
    await source.enable(a.instanceId, "fixture");
    await source.close();
    const bundle = await import(
      pathToFileURL(path.join(adapter, "index.mjs")).href
    );
    relocated = new bundle.DesktopHost(options);
    await relocated.initialize();
    expect(await relocated.foundationStatus(a.instanceId)).toEqual(
      a.foundation,
    );
    expect(
      await relocated.invoke(
        a.instanceId,
        "fixture",
        "fixture",
        "commands",
        "check",
        {},
      ),
    ).toMatchObject({ agentId: a.instanceId, componentId: "fixture" });
    const b = await relocated.createAgent("B");
    expect(b.foundation.selection).toEqual(a.foundation!.selection);
    const code = path.join(adapter, "index.mjs");
    await writeFile(
      code,
      (await readFile(code, "utf8")) + "\n// changed bytes\n",
    );
    const plan = await relocated.foundationPlan(
      a.instanceId,
      a.foundation!.selection,
    );
    expect(plan).toMatchObject({
      compatible: false,
      failure: { reason: "FOUNDATION_UNAVAILABLE" },
    });
    expect(await relocated.foundationStatus(a.instanceId)).toEqual(
      a.foundation,
    );
  } finally {
    await source.close();
    await relocated?.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  "secure-fs",
  "controlled-supervisor.js",
  "engine-supervisor.js",
  "source-inputs.json",
])(
  "rejects changed relocated trusted host helper %s without modifying the Agent pin",
  async (name) => {
    const root = await mkdtemp(
        path.join(os.tmpdir(), "plums-helper-integrity-"),
      ),
      options = {
        dataDir: path.join(root, "data"),
        confirm: { ask: async () => true },
        secretStore: () => new MemorySecretStore(),
      },
      source = new DesktopHost(options);
    let relocated: any;
    try {
      await source.initialize();
      const a = await source.createAgent("Pinned");
      await source.close();
      const app = path.join(root, "app"),
        adapter = path.join(app, "host-adapter");
      await cp("packages/host/dist/host-adapter", adapter, { recursive: true });
      await cp(
        "packages/host/dist/foundation-resources",
        path.join(app, "foundation-resources"),
        { recursive: true },
      );
      await mkdir(path.join(app, "node_modules"));
      for (const [pkg, owner] of [
        ["isolated-vm", "host"],
        ["better-sqlite3", "core"],
      ]) {
        const req = createRequire(
          path.resolve("packages", owner!, "package.json"),
        );
        await symlink(
          path.dirname(req.resolve(pkg! + "/package.json")),
          path.join(app, "node_modules", pkg!),
        );
      }
      const bundle = await import(
        pathToFileURL(path.join(adapter, "index.mjs")).href
      );
      relocated = new bundle.DesktopHost(options);
      await relocated.initialize();
      const file = path.join(adapter, name);
      await writeFile(
        file,
        Buffer.concat([await readFile(file), Buffer.from("\nchanged\n")]),
      );
      expect(await relocated.foundationPlan(a.instanceId)).toMatchObject({
        compatible: false,
        failure: { reason: "FOUNDATION_UNAVAILABLE" },
      });
      expect(await relocated.foundationStatus(a.instanceId)).toEqual(
        a.foundation,
      );
    } finally {
      await source.close();
      await relocated?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
