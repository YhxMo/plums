import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  RecordingFsSink,
} from "@plumsjs/core";
import { afterEach, expect, it } from "vitest";
import { DesktopHost } from "../src/host.js";

const hosts: DesktopHost[] = [],
  children: ChildProcess[] = [],
  dirs: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
  }
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it.each([
  "old-moved",
  "new-published",
  "database-committed",
  "before-backup-cleanup",
])(
  "recovers core files before publishing the assembly pin after a crash at %s",
  async (phase) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "plums-host-lifecycle-"));
    dirs.push(root);
    const options = {
      dataDir: root,
      egress: new RecordingEgressSink(),
      fs: new RecordingFsSink(),
      secretStore: () => new MemorySecretStore(),
    };
    const host = new DesktopHost(options);
    hosts.push(host);
    await host.initialize();
    const id = "lifecycle.test";
    const bytes = (version: string) =>
      createArchive({
        "manifest.json": Buffer.from(
          JSON.stringify({
            formatVersion: "2.0",
            kind: "character",
            id,
            name: id,
            version,
            description: "",
            dependencies: [],
            permissions: [],
            payload: { version },
          }),
        ),
        "marker.txt": Buffer.from(version),
      });
    const first = await bytes("1.0.0"),
      second = await bytes("2.0.0");
    const add = async (archive: Uint8Array) => {
      const preview = (await host.preview(archive)) as { token: string };
      return host.importLibrary(preview.token);
    };
    const oldItem = await add(first),
      newItem = await add(second);
    const agent = await host.createAgent("Lifecycle recovery", [
      oldItem.digest,
    ]);
    await host.close();
    const agentDir = path.join(root, "instances", agent.instanceId);
    const next = {
      ...agent,
      components: agent.components!.map((component) => ({
        ...component,
        version: "2.0.0",
        digest: newItem.digest,
      })),
    };
    await writeFile(
      path.join(agentDir, "assembly-transaction.json"),
      JSON.stringify({
        packageId: id,
        beforeVersion: "1.0.0",
        version: "2.0.0",
        next,
      }),
    );
    const zip = path.join(root, "next.zip"),
      secrets = path.join(root, "secrets.json");
    await writeFile(zip, second);
    await writeFile(secrets, "{}");
    const barrier = path.join(root, "barrier"),
      config = path.join(root, "child.json");
    await writeFile(
      config,
      JSON.stringify({
        dataDir: path.join(agentDir, "core"),
        secrets,
        zip,
        phase,
        barrier,
        operation: "update",
      }),
    );
    const helper = fileURLToPath(
      new URL("../../core/test/lifecycle-child.mjs", import.meta.url),
    );
    const entry = fileURLToPath(
      new URL("../../core/dist/index.js", import.meta.url),
    );
    const child = spawn(process.execPath, [helper, entry, config], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout!.on("data", (part) => {
      output += part.toString();
    });
    child.stderr!.on("data", (part) => {
      output += part.toString();
    });
    await expect
      .poll(
        () => {
          if (child.exitCode !== null) throw Error(output);
          return existsSync(barrier);
        },
        { timeout: 10000, interval: 10 },
      )
      .toBe(true);
    const closed = once(child, "close");
    child.kill("SIGKILL");
    await closed;
    const committed = ["database-committed", "before-backup-cleanup"].includes(
      phase,
    );
    const version = committed ? "2.0.0" : "1.0.0";
    for (let attempt = 0; attempt < 2; attempt++) {
      const recovered = new DesktopHost(options);
      hosts.push(recovered);
      await recovered.initialize();
      const record = (await recovered.listAgents()).find(
        (record) => record.instanceId === agent.instanceId,
      )!;
      expect(record.recoveryError).toBeUndefined();
      expect(record.components).toMatchObject([
        {
          packageId: id,
          version,
          digest: committed ? newItem.digest : oldItem.digest,
        },
      ]);
      const disk = JSON.parse(
        await readFile(
          path.join(agentDir, "core", "packages", id, "manifest.json"),
          "utf8",
        ),
      );
      expect(disk.version).toBe(version);
      expect(
        await readFile(
          path.join(agentDir, "core", "packages", id, "marker.txt"),
          "utf8",
        ),
      ).toBe(version);
      expect(existsSync(path.join(agentDir, "assembly-transaction.json"))).toBe(
        false,
      );
      await recovered.close();
    }
  },
);
