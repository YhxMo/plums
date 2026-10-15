import { Host } from "../../modules/extension-host/host";
import { AgentStore, restoreAgents } from "../../modules/agents/store";
import type {
  ExtensionDefinition,
  Platform,
  StoredState,
} from "../../modules/sdk";
import { PlatformAdapter } from "../../src/platform";

const check = (condition: boolean, message: string) => {
  if (!condition) throw Error(message);
};

/** Native-only fixture: invoke the real broker with isolated synthetic state. */
async function verifyState(platform: Platform) {
  const owner = "reliability." + crypto.randomUUID();
  await platform.grant(owner, ["state.read", "state.write"]);
  let revision = 0;
  let output: unknown = "x".repeat(32000);
  const store = new AgentStore(
    [],
    async (agents) => {
      const receipt = (await platform.call(owner, "state.write", {
        revision,
        value: agents,
      })) as StoredState;
      revision = receipt.revision;
    },
    async () => output as string,
  );
  const agent = await store.create({ name: "Native boundary" });
  await store.send(agent.id, "short");
  const saved = (await platform.call(owner, "state.read")) as StoredState;
  check(
    restoreAgents(saved.value)[0].sessions[0].messages[1].text.length === 32000,
    "Boundary reply not restored",
  );
  for (const invalid of ["x".repeat(32001), 42, undefined]) {
    output = invalid;
    check(
      await store.send(agent.id, "retain").then(
        () => false,
        () => true,
      ),
      "Invalid reply accepted",
    );
    check(
      JSON.stringify(await platform.call(owner, "state.read")) ===
        JSON.stringify(saved),
      "Rejected reply changed native state",
    );
  }
  await store.close();
  return { owner, revision, checks: 4 };
}

async function verifyStop(
  platform: Platform,
  action: "stop" | "revoke",
  fail: boolean,
) {
  const host = new Host(platform);
  let calls = 0;
  let notices = 0;
  let notify = () => {};
  host.install({
    manifest: { id: "notifier", version: "1", apiVersion: 1 },
    activate(ctx) {
      notify = () => {
        notices++;
        ctx.emit("tick", null);
      };
    },
  });
  host.install({
    manifest: {
      id: "root",
      version: "1",
      apiVersion: 1,
      capabilities: ["platform.info"],
      provides: { source: 1 },
    },
    activate(ctx) {
      ctx.provide("source", 1, {});
    },
  });
  for (const id of ["left", "right"])
    host.install({
      manifest: { id, version: "1", apiVersion: 1, requires: { source: 1 } },
      activate(ctx) {
        ctx.use("source");
        ctx.on("tick", () => {
          calls++;
        });
        ctx.signal.addEventListener("abort", notify, { once: true });
        ctx.onDispose(() => {
          if (id === "left" && fail) throw Error("fixture cleanup failed");
        });
      },
    });
  await host.start("notifier");
  await host.grant("root", ["platform.info"]);
  for (const id of ["root", "left", "right"]) await host.start(id);
  notify();
  check(calls === 2, "Initial event path unavailable");
  calls = 0;
  notices = 0;
  const rejected = await (
    action === "stop" ? host.stop("root") : host.grant("root", [])
  ).then(
    () => false,
    () => true,
  );
  check(rejected === fail, "Incorrect cleanup outcome");
  check(calls === 0 && notices === 2, "Cancellation reentered a live consumer");
  check(
    host.inspect("left").status === (fail ? "cleanup-failed" : "waiting"),
    "Cleanup state lost",
  );
  check(
    host.inspect("right").resources === 0 && host.inspect("right").tasks === 0,
    "Resources retained",
  );
  if (fail)
    check(
      await host.start("left").then(
        () => false,
        () => true,
      ),
      "Failed cleanup restarted",
    );
  await host.stop("notifier");
  return { action, fail, calls, notices };
}

export async function runNativeChecks() {
  const platform = new PlatformAdapter();
  check(platform.kind === "native", "Native broker required");
  const state = await verifyState(platform);
  const lifecycle = [];
  for (const action of ["stop", "revoke"] as const)
    for (const fail of [false, true])
      lifecycle.push(await verifyStop(platform, action, fail));
  return { passed: true, state, lifecycle };
}

export async function verifyNativeRestore(owner: string) {
  check(/^reliability\.[0-9a-f-]{36}$/.test(owner), "Invalid fixture owner");
  const platform = new PlatformAdapter();
  check(platform.kind === "native", "Native broker required");
  await platform.grant(owner, ["state.read"]);
  const saved = (await platform.call(owner, "state.read")) as StoredState;
  const agents = restoreAgents(saved.value);
  check(saved.revision === 2, "Unexpected saved revision");
  check(
    agents[0].sessions[0].messages[1].text.length === 32000,
    "Restore mismatch",
  );
  return { passed: true, revision: saved.revision, length: 32000 };
}

const fixture: ExtensionDefinition = {
  manifest: { id: "reliability.check", version: "1", apiVersion: 1 },
  activate(ctx) {
    ctx.view({
      id: "reliability",
      label: "原生回归检查",
      mount(root) {
        const run = document.createElement("button");
        run.textContent = "运行原生回归";
        const status = document.createElement("pre");
        status.setAttribute("role", "status");
        run.onclick = async () => {
          run.disabled = true;
          try {
            status.textContent = JSON.stringify(
              await runNativeChecks(),
              null,
              2,
            );
          } catch (error) {
            status.textContent = JSON.stringify({
              passed: false,
              error: String(error),
            });
          }
        };
        const owner = document.createElement("input");
        owner.setAttribute("aria-label", "恢复检查 owner");
        const restore = document.createElement("button");
        restore.textContent = "检查已有原生状态";
        restore.onclick = async () => {
          try {
            status.textContent = JSON.stringify(
              await verifyNativeRestore(owner.value),
            );
          } catch (error) {
            status.textContent = JSON.stringify({
              passed: false,
              error: String(error),
            });
          }
        };
        root.replaceChildren(run, owner, restore, status);
        return () => {
          run.onclick = null;
          restore.onclick = null;
          root.replaceChildren();
        };
      },
    });
  },
};
export default fixture;
