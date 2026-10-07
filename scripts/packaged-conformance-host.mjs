/** Trusted package test driver. Every operation runs through the unchanged packaged broker. */
import { fork, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { open as internalFixture } from "./platform-conformance-host.mjs";
const methods = {
  listAgents: ["list"],
  resources: ["resources", "instanceId"],
  importLibrary: ["importLibrary", "token"],
  planAssembly: ["planAssembly", "digests"],
  createAgent: [
    "createAgent",
    "name",
    "digests",
    "characterId",
    "startup",
    "protocolBindings",
  ],
  enable: ["enable", "instanceId", "packageId"],
  bindRoot: ["bindRoot", "instanceId", "name", "path"],
  bindControlledProgram: [
    "bindControlledProgram",
    "instanceId",
    "target",
    "program",
    "reads",
    "writes",
  ],
  createResourceGroup: [
    "createResourceGroup",
    "instanceId",
    "fingerprint",
    "name",
    "contentContract",
  ],
  resourcePlan: ["resourcePlan", "instanceId"],
  setResourceQualification: [
    "setResourceQualification",
    "instanceId",
    "fingerprint",
    "resourceId",
    "componentId",
    "operations",
  ],
  setResourceBinding: [
    "setResourceBinding",
    "instanceId",
    "fingerprint",
    "componentId",
    "requirementId",
    "resourceId",
  ],
  grantResourceRange: [
    "grantResourceRange",
    "instanceId",
    "fingerprint",
    "mode",
    "durationMs",
    "selection",
  ],
  revokeResourceRange: ["revokeResourceRange", "instanceId"],
  openFrontend: ["openFrontend", "instanceId", "componentId"],
  closeFrontend: ["closeFrontend", "sessionId"],
  frontendCommon: [
    "frontendCommon",
    "sessionId",
    "source",
    "method",
    "request",
  ],
  frontendResource: [
    "frontendResource",
    "sessionId",
    "source",
    "operation",
    "request",
  ],
  workspacePlan: ["workspacePlan", "instanceId", "componentId"],
  setWorkspaceViews: [
    "setWorkspaceViews",
    "instanceId",
    "componentId",
    "components",
    "fingerprint",
  ],
  restoreWorkspace: ["restoreWorkspace", "sessionId", "source"],
  protocolPlan: ["protocolPlan", "instanceId"],
  setProtocolBinding: [
    "setProtocolBinding",
    "instanceId",
    "fingerprint",
    "consumerId",
    "requirementId",
    "choice",
  ],
  invoke: [
    "invoke",
    "instanceId",
    "ownerId",
    "targetId",
    "kind",
    "name",
    "input",
  ],
  policyPlan: ["policyPlan", "instanceId"],
  selectPolicy: [
    "selectPolicy",
    "instanceId",
    "fingerprint",
    "providerId",
    "provideId",
    "mode",
  ],
  grantPolicyScope: [
    "grantPolicyScope",
    "instanceId",
    "fingerprint",
    "durationMs",
    "selection",
  ],
  revokePolicyScope: ["revokePolicyScope", "instanceId"],
  setComponentBackground: [
    "setComponentBackground",
    "instanceId",
    "packageId",
    "enabled",
  ],
  permitTaskTakeover: [
    "permitTaskTakeover",
    "instanceId",
    "taskId",
    "packageId",
    "enabled",
  ],
  commonTasks: ["commonTasks", "instanceId"],
  exportAgent: ["export", "instanceId"],
  install: ["install", "token"],
  setSettings: ["settings", "instanceId", "packageId", "values", "secrets"],
};
export class PackagedHost {
  constructor(options, application) {
    this.options = options;
    this.application = path.resolve(application);
    this.pending = new Map();
    this.next = 0;
    return new Proxy(this, {
      get: (target, name) => {
        if (name in target) return Reflect.get(target, name);
        const entry = methods[name];
        if (!entry) return undefined;
        return async (...values) => {
          const result = await target.call(
            entry[0],
            Object.fromEntries(
              entry.slice(1).map((key, i) => [key, values[i]]),
            ),
          );
          return name === "exportAgent" ? new Uint8Array(result) : result;
        };
      },
    });
  }
  async initialize() {
    const resources = path.join(this.application, "Contents/Resources");
    this.child = fork(path.join(resources, "app/dist/broker.mjs"), [], {
      execPath: path.join(resources, "node/bin/node"),
      execArgv: ["--no-node-snapshot"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        PLUMS_DATA_DIR: this.options.dataDir,
      },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.exited = new Promise((resolve) =>
      this.child.once("exit", (code, signal) => {
        for (const item of this.pending.values())
          item.reject(Error("Packaged broker exited"));
        this.pending.clear();
        resolve({ code, signal });
      }),
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Packaged broker readiness timed out")),
        20000,
      );
      this.child.once("error", () => {
        clearTimeout(timer);
        reject(Error("Packaged broker failed"));
      });
      this.child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("Packaged broker exited before readiness"));
      });
      this.child.on("message", async (m) => {
        if (m.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (m.type === "reply") {
          const item = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (item) {
            if (m.ok) item.resolve(m.value);
            else item.reject(m.error);
          }
        } else if (m.type === "service") {
          let ok = true,
            value;
          try {
            if (m.method !== "confirm") throw Error();
            value = await this.options.confirm.ask(m.args);
          } catch {
            ok = false;
          }
          if (this.child.connected)
            this.child.send({ type: "service-reply", id: m.id, ok, value });
        }
      });
    });
  }
  call(method, args = {}) {
    const id = String(++this.next);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Packaged broker request timed out"));
      }, 30000);
      const finish = (callback) => (value) => {
        clearTimeout(timer);
        callback(value);
      };
      this.pending.set(id, {
        resolve: finish(resolve),
        reject: finish(reject),
      });
      if (!this.child.connected) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(Error("Packaged broker unavailable"));
        return;
      }
      this.child.send({ type: "request", id, method, args }, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(Error("Packaged broker transport failed"));
        }
      });
    });
  }
  async preview(bytes) {
    if (typeof bytes === "string") return this.call("preview", { path: bytes });
    await mkdir(this.options.dataDir, { recursive: true });
    const file = path.join(
      this.options.dataDir,
      `.fixture-${randomUUID()}.zip`,
    );
    try {
      await writeFile(file, bytes);
      return await this.call("preview", { path: file });
    } finally {
      await rm(file, { force: true });
    }
  }
  async close() {
    if (!this.child) return;
    const child = this.child;
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.disconnect();
    else child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 15000);
    try {
      const result = await this.exited;
      if (result.signal || result.code !== 0)
        throw Error("Packaged broker cleanup failed");
    } finally {
      clearTimeout(kill);
    }
  }
}
const readAudit = (dataDir) => {
  const root = path.join(dataDir, "instances");
  return readdirSync(root)
    .filter((id) => /^[a-f0-9-]{36}$/.test(id))
    .map((id) => path.join(root, id, "audit.jsonl"))
    .filter(existsSync)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
};
export async function open({ runtime = "isolate" } = {}) {
  const application = process.env.PLUMS_CONFORMANCE_APP;
  if (!application)
    throw Error("PLUMS_CONFORMANCE_APP must identify the packaged app");
  const nodePath = path.join(
    path.resolve(application),
    "Contents/Resources/node/bin/node",
  );
  if (
    execFileSync(nodePath, ["--version"], { encoding: "utf8" }).trim() !==
    "v26.5.1"
  )
    throw Error("Unexpected packaged Node");
  const adapter = await internalFixture({
    runtime,
    nodePath,
    createHost: (options) => new PackagedHost(options, application),
    readAudit,
    processRace: async ({ host, options, agents, client, binding }) => {
      const peer = new PackagedHost(options, application);
      try {
        await peer.initialize();
        const plan = await peer.resourcePlan(agents.b);
        await peer.grantResourceRange(
          agents.b,
          plan.fingerprint,
          "task",
          900000,
          plan.bindings.map((b) => ({
            componentId: b.componentId,
            resourceId: b.resourceId,
            operations: ["read", "write", "delete"],
          })),
        );
        const f = await peer.openFrontend(agents.b),
          rpc = (operation, request) =>
            peer.frontendResource(
              f.context.sessionId,
              f.context.handle,
              operation,
              request,
            );
        const shared = (await rpc("list", {})).find(
          (b) => b.requirementId === "shared",
        );
        const result = (promise) =>
          promise.then(
            (value) => ({ status: "fulfilled", value }),
            (error) => ({ status: "rejected", reason: error.details?.reason }),
          );
        const [parent, other] = await Promise.all([
          result(
            client.sdk.resources.write(binding, "process-race", "0", "parent"),
          ),
          result(
            rpc("write", {
              binding: shared.binding,
              key: "process-race",
              expectedRevision: "0",
              value: "child",
            }),
          ),
        ]);
        return {
          parent,
          peer: other,
          independentProcess: peer.child.pid !== host.child.pid,
        };
      } finally {
        await peer.close();
      }
    },
  });
  return { ...adapter, provenance: "adapter-supplied-unverified" };
}
