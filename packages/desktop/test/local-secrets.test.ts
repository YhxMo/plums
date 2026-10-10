import { expect, it } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
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
import path from "node:path";
import os from "node:os";
import { createArchive, MemorySecretStore } from "@plumsjs/core";
import { DesktopHost } from "../../host/src/host.js";
import { LocalSecretStore } from "../../host/src/secrets.js";

import {
  connectorManifest,
  connectorRuntime,
} from "../../host/test/platform-fixtures.js";

it("saves and reopens credentials through the real desktop broker without requesting OS encryption", async () => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "plums-broker-secrets-"),
  );
  const builder = new DesktopHost({
    dataDir: temporary,
    secretStore: () => new MemorySecretStore(),
  });
  let broker: ChildProcess | undefined;
  const services: string[] = [];
  try {
    const application = path.join(temporary, "application");
    await cp(
      path.resolve("packages/desktop/dist"),
      path.join(application, "dist"),
      { recursive: true },
    );
    await writeFile(
      path.join(application, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    await mkdir(path.join(application, "node_modules"));
    for (const [name, owner] of [
      ["better-sqlite3", "core"],
      ["isolated-vm", "host"],
    ]) {
      const require = createRequire(
        path.resolve(`packages/${owner}/package.json`),
      );
      await symlink(
        path.dirname(require.resolve(`${name}/package.json`)),
        path.join(application, "node_modules", name!),
      );
    }
    await builder.initialize();
    const manifest = Buffer.from(JSON.stringify(connectorManifest()));
    const preview = (await builder.preview(
      await createArchive({
        "manifest.json": manifest,
        "runtime/main.js": Buffer.from(connectorRuntime),
      }),
    )) as { token: string };
    const component = await builder.importLibrary(preview.token);
    const agent = await builder.createAgent("Storage fixture", [
      component.digest,
    ]);
    await builder.setSettings(
      agent.instanceId,
      "model",
      { model: "fixture", endpoint: "https://example.com/v1" },
      { apiKey: "fake-old-key" },
    );
    await builder.close();
    const legacy = path.join(
      temporary,
      "instances",
      agent.instanceId,
      "secrets.enc.json",
    );
    await writeFile(
      legacy,
      JSON.stringify({ "secret:model/apiKey": "legacy-ciphertext" }),
    );
    async function start() {
      const child = fork(path.join(application, "dist/broker.mjs"), [], {
        env: { ...process.env, PLUMS_DATA_DIR: temporary },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        execArgv: ["--no-node-snapshot"],
      });
      let errors = "";
      child.stderr?.on("data", (value) => {
        errors += String(value);
      });
      broker = child;
      const waiting = new Map<
        string,
        { resolve(value: any): void; reject(error: unknown): void }
      >();
      let next = 0;
      const ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Broker startup failed")),
          5000,
        );
        child.on("message", (message: any) => {
          if (message.type === "ready") {
            clearTimeout(timer);
            resolve();
          }
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Broker exited: " + errors));
        });
      });
      child.on("message", (message: any) => {
        if (message.type === "service") {
          services.push(message.method);
          child.send({ type: "service-reply", id: message.id, ok: false });
        }
        if (message.type === "reply") {
          const request = waiting.get(message.id);
          waiting.delete(message.id);
          if (message.ok) request?.resolve(message.value);
          else request?.reject(message.error);
        }
      });
      await ready;
      return (method: string, args: Record<string, unknown> = {}) =>
        new Promise<any>((resolve, reject) => {
          const id = String(++next),
            timer = setTimeout(() => {
              waiting.delete(id);
              reject(Error("Broker request timed out"));
            }, 5000);
          waiting.set(id, {
            resolve(value) {
              clearTimeout(timer);
              resolve(value);
            },
            reject(error) {
              clearTimeout(timer);
              reject(error);
            },
          });
          child.send({
            type: "request",
            id,
            method,
            args: { instanceId: agent.instanceId, ...args },
          });
        });
    }
    async function stop() {
      const child = broker!;
      broker = undefined;
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.disconnect();
      await exited;
    }
    let call = await start();
    const old = await call("resources");
    expect(old.packages[0].settings.secrets.apiKey).toBe(false);
    await call("settings", {
      packageId: "model",
      values: { model: "fixture", endpoint: "https://example.com/v1" },
      secrets: { apiKey: "fake-new-local-key" },
    });
    const store = new LocalSecretStore(
      path.join(temporary, "instances", agent.instanceId, "secrets"),
    );
    expect(await store.get("secret:model/apiKey")).toBe("fake-new-local-key");
    await stop();
    call = await start();
    const resources = await call("resources");
    expect(resources.packages[0].settings.secrets.apiKey).toBe(true);
    expect(JSON.stringify(resources)).not.toContain("fake-new-local-key");
    expect(JSON.stringify(await call("audit"))).not.toContain(
      "fake-new-local-key",
    );
    expect(JSON.parse(await readFile(legacy, "utf8"))).toEqual({
      "secret:model/apiKey": "legacy-ciphertext",
    });
    await call("uninstall", { packageId: "model" });
    expect(await store.get("secret:model/apiKey")).toBeUndefined();
    expect(JSON.parse(await readFile(legacy, "utf8"))).toEqual({});
    expect(services).toEqual([]);
    await stop();
  } finally {
    await builder.close();
    if (broker && broker.exitCode === null && broker.signalCode === null) {
      const child = broker;
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill();
      await exited;
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
