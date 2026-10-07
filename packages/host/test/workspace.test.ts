import { it, expect } from "vitest";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { DesktopHost } from "../src/host.js";
import { workspaceFixture } from "./workspace-fixture.js";
import { createCommonPlatformSdk } from "@plums/sdk";
const resources = {
  list: async () => [],
  read: async () => ({ exists: false, revision: "0" }),
  write: async () => ({ revision: "0" }),
  delete: async () => ({ revision: "0" }),
};
it("closing an ordinary provider view preserves a common task using it through a declared nested SDK protocol edge", async () => {
  const f = await workspaceFixture("isolate", true, false, true);
  try {
    const plan = await f.host.workspacePlan(f.a.instanceId);
    await f.host.setWorkspaceViews(
      f.a.instanceId,
      "screen-a",
      ["backend-b"],
      plan.fingerprint,
    );
    const root = (await f.host.openFrontend(f.a.instanceId))!;
    const side = (
      await f.host.restoreWorkspace(root.context.sessionId, root.context.handle)
    ).resources[0]!;
    const sdk = createCommonPlatformSdk(
      (m, a) =>
        f.host.frontendCommon(
          root.context.sessionId,
          root.context.handle,
          m,
          a,
        ),
      resources,
    );
    const call = await sdk.invoke(
      (await sdk.binding("backend"))!.handle,
      "nested",
      { fixture: true },
    );
    await expect
      .poll(
        () =>
          f.events.some(
            (e) => e.packageId === "backend-b" && e.topic === "startup",
          ),
        // Two real runtimes may start in sequence; readiness is a precondition
        // for the closure assertion, rather than a one-second performance limit.
        { timeout: 5_000 },
      )
      .toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    await f.host.closePanel(
      root.context.sessionId,
      root.context.handle,
      side.context.handle,
    );
    await new Promise((r) => setTimeout(r, 150));
    expect((await sdk.tasks.status(call.taskId)).status.state).toBe("running");
    await call.cancel();
    expect((await call.result).executionState).toBe("unknown");
  } finally {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it("independent UI identities consume one backend, refuse transferred handles, and restore stable selections without execution credentials", async () => {
  const f = await workspaceFixture();
  let host = f.host;
  try {
    const plan = await host.workspacePlan(f.a.instanceId);
    await host.setWorkspaceViews(
      f.a.instanceId,
      "screen-a",
      ["screen-b"],
      plan.fingerprint,
    );
    const root = (await host.openFrontend(f.a.instanceId))!,
      restored = await host.restoreWorkspace(
        root.context.sessionId,
        root.context.handle,
      ),
      side = restored.resources[0]!;
    expect(restored.layout.panels).toHaveLength(1);
    expect(side.context.componentId).toBe("screen-b");
    expect(side.context.sessionId).toBe(root.context.sessionId);
    expect(side.context.handle).not.toBe(root.context.handle);
    const sdk = (context: typeof root.context) =>
      createCommonPlatformSdk(
        (m, a) => host.frontendCommon(context.sessionId, context.handle, m, a),
        resources,
      );
    const a = sdk(root.context),
      b = sdk(side.context),
      binding = (await a.binding("backend"))!;
    await expect(b.invoke(binding.handle, "echo", null)).rejects.toMatchObject({
      details: { reason: "STALE_BINDING" },
    });
    for (const client of [a, b]) {
      const c = await client.invoke(
        (await client.binding("backend"))!.handle,
        "echo",
        { fixture: true },
      );
      expect(await c.result).toMatchObject({
        outcome: { value: { provider: "backend-a" } },
      });
    }
    expect(await a.tasks.list()).toHaveLength(1);
    expect(await b.tasks.list()).toHaveLength(1);
    await host.panelLayout(root.context.sessionId, root.context.handle, {
      root: { x: 0, y: 0, width: 1, height: 0.5 },
      panels: [
        { handle: side.context.handle, x: 0, y: 0.5, width: 1, height: 0.5 },
      ],
    });
    const text = await readFile(
      path.join(
        f.dir,
        "ui-layouts",
        (await readdir(path.join(f.dir, "ui-layouts")))[0]!,
      ),
      "utf8",
    );
    for (const secret of [
      root.context.handle,
      root.context.sessionId,
      side.context.handle,
      binding.handle,
      "synthetic-input",
    ])
      expect(text).not.toContain(secret);
    await host.close();
    host = new DesktopHost(f.options);
    await host.initialize();
    await expect(
      host.frontendContext(root.context.sessionId, root.context.handle),
    ).rejects.toBeDefined();
    const next = (await host.openFrontend(f.a.instanceId))!,
      again = await host.restoreWorkspace(
        next.context.sessionId,
        next.context.handle,
      );
    expect(again.layout.root.height).toBe(0.5);
    expect(again.resources[0]!.context.handle).not.toBe(side.context.handle);
    expect(await host.policyStatus(f.a.instanceId)).toMatchObject({
      active: null,
    });
    await host.disable(f.a.instanceId, "screen-b");
    const disabled = (await host.openFrontend(f.a.instanceId))!,
      diagnosed = await host.restoreWorkspace(
        disabled.context.sessionId,
        disabled.context.handle,
      );
    expect(diagnosed.resources).toHaveLength(0);
    expect(diagnosed.diagnostics).toContainEqual({
      viewId: "frontend:screen-b",
      reason: "COMPONENT_DISABLED",
    });
    const other = (await host.openFrontend(f.b.instanceId))!;
    expect(
      (
        await host.restoreWorkspace(
          other.context.sessionId,
          other.context.handle,
        )
      ).resources,
    ).toHaveLength(0);
  } finally {
    await host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it("task discovery excludes other owners until trusted takeover, subscription stops after unsubscribe, and binding switch invalidates old consumers", async () => {
  const f = await workspaceFixture();
  try {
    const root = (await f.host.openFrontend(f.a.instanceId))!,
      rpc = (m: string, a: Record<string, unknown>) =>
        f.host.frontendCommon(
          root.context.sessionId,
          root.context.handle,
          m,
          a,
        ),
      sdk = createCommonPlatformSdk(rpc, resources);
    const task = await sdk.tasks.create({ lifetime: "frontend" });
    expect(await sdk.tasks.list()).toHaveLength(1);
    const states: string[] = [];
    let resolve!: () => void;
    const seen = new Promise<void>((r) => (resolve = r));
    const off = sdk.tasks.subscribe(task.taskId, (s) => {
      states.push(s.status.state);
      resolve();
    });
    await seen;
    off();
    await rpc("cancel", { taskId: task.taskId });
    await new Promise((r) => setTimeout(r, 300));
    expect(states).toEqual(["starting"]);
    const viewer = (await f.host.openFrontend(f.a.instanceId, "screen-b"))!;
    expect(
      await f.host.frontendCommon(
        viewer.context.sessionId,
        viewer.context.handle,
        "listTasks",
        {},
      ),
    ).toEqual([]);
    const old = (await f.host.frontendCommon(
      viewer.context.sessionId,
      viewer.context.handle,
      "binding",
      { requirementId: "backend" },
    )) as { handle: string };
    const plan = await f.host.protocolPlan(f.a.instanceId);
    const state = plan.requirements.find((r) => r.consumerId === "screen-b")!;
    await f.host.setProtocolBinding(
      f.a.instanceId,
      plan.fingerprint,
      "screen-b",
      "backend",
      state.candidates.find((c) => c.intent.providerId === "backend-b")!.intent,
    );
    await expect(
      f.host.frontendCommon(
        viewer.context.sessionId,
        viewer.context.handle,
        "invoke",
        { binding: old.handle, operation: "echo", input: null },
      ),
    ).rejects.toBeDefined();
    const fresh = (await f.host.openFrontend(f.a.instanceId, "screen-b"))!,
      client = createCommonPlatformSdk(
        (m, a) =>
          f.host.frontendCommon(
            fresh.context.sessionId,
            fresh.context.handle,
            m,
            a,
          ),
        resources,
      );
    const call = await client.invoke(
      (await client.binding("backend"))!.handle,
      "echo",
      null,
    );
    expect(await call.result).toMatchObject({
      outcome: { value: { provider: "backend-b" } },
    });
  } finally {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it("explicit side closure preserves visibility and corrupt metadata produces a trusted diagnostic without restoring old choices", async () => {
  const f = await workspaceFixture();
  try {
    const plan = await f.host.workspacePlan(f.a.instanceId);
    await f.host.setWorkspaceViews(
      f.a.instanceId,
      "screen-a",
      ["screen-b"],
      plan.fingerprint,
    );
    const root = (await f.host.openFrontend(f.a.instanceId))!,
      restored = await f.host.restoreWorkspace(
        root.context.sessionId,
        root.context.handle,
      );
    await f.host.closePanel(
      root.context.sessionId,
      root.context.handle,
      restored.resources[0]!.context.handle,
    );
    const next = (await f.host.openFrontend(f.a.instanceId))!;
    expect(
      (
        await f.host.restoreWorkspace(
          next.context.sessionId,
          next.context.handle,
        )
      ).resources,
    ).toEqual([]);
    expect(
      (await f.host.workspacePlan(f.a.instanceId)).layout!.views[0]!.visible,
    ).toBe(false);
    const { writeFile } = await import("node:fs/promises");
    const file = path.join(
      f.dir,
      "ui-layouts",
      (await readdir(path.join(f.dir, "ui-layouts")))[0]!,
    );
    await writeFile(file, '{"version":1,"handle":"not-a-credential"}');
    const fresh = (await f.host.openFrontend(f.a.instanceId))!,
      recovered = await f.host.restoreWorkspace(
        fresh.context.sessionId,
        fresh.context.handle,
      );
    expect(recovered.resources).toEqual([]);
    expect(recovered.layout.root).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(recovered.diagnostics).toContainEqual({
      viewId: "root",
      reason: "LAYOUT_INVALID",
    });
  } finally {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it.each([true, false])(
  "closing a component frontend leaves another container's backend call running (common provider: %s)",
  async (backendCommon) => {
    const f = await workspaceFixture("isolate", true, backendCommon);
    try {
      const plan = await f.host.workspacePlan(f.a.instanceId);
      await f.host.setWorkspaceViews(
        f.a.instanceId,
        "screen-a",
        ["backend-a"],
        plan.fingerprint,
      );
      const root = (await f.host.openFrontend(f.a.instanceId))!,
        side = (
          await f.host.restoreWorkspace(
            root.context.sessionId,
            root.context.handle,
          )
        ).resources[0]!;
      const sdk = createCommonPlatformSdk(
        (m, a) =>
          f.host.frontendCommon(
            root.context.sessionId,
            root.context.handle,
            m,
            a,
          ),
        resources,
      );
      const binding = (await sdk.binding("backend"))!.handle;
      const echo = await sdk.invoke(binding, "echo", null);
      expect(await echo.result).toMatchObject({
        outcome: { ok: true, value: { provider: "backend-a" } },
      });
      const call = await sdk.invoke(binding, "hold", null);
      if (backendCommon) {
        for await (const event of call.events) {
          expect(event.channel).toBe("ready");
          break;
        }
      } else
        await expect
          .poll(async () => (await sdk.tasks.status(call.taskId)).status.state)
          .toBe("running");
      await f.host.closePanel(
        root.context.sessionId,
        root.context.handle,
        side.context.handle,
      );
      expect((await sdk.tasks.status(call.taskId)).status.state).toBe(
        "running",
      );
      await new Promise((r) => setTimeout(r, 150));
      expect((await sdk.tasks.status(call.taskId)).status.state).toBe(
        "running",
      );
      await call.cancel();
      expect((await sdk.tasks.status(call.taskId)).status.executionState).toBe(
        "unknown",
      );
    } finally {
      await f.host.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
