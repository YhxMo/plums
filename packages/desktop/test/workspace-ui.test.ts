import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { cp, mkdir, symlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { workspaceFixture } from "../../host/test/workspace-fixture.js";
const require = createRequire(import.meta.url);
it.runIf(process.platform === "darwin")(
  "trusted composition restores independent frontends, scopes common identities, switches compatible backends, and permits explicit background takeover through the real desktop bridge",
  async () => {
    const f = await workspaceFixture("controlled-node");
    await f.host.setComponentBackground(f.a.instanceId, "screen-a", true);
    await f.host.close();
    const stage = path.join(f.dir, "desktop"),
      root = process.cwd();
    await cp(
      path.join(root, "packages/desktop/dist"),
      path.join(stage, "dist"),
      { recursive: true },
    );
    for (const [name, pkg] of [
      ["isolated-vm", "host"],
      ["better-sqlite3", "core"],
    ]) {
      const resolver = createRequire(
        path.join(root, `packages/${pkg}/package.json`),
      );
      await mkdir(path.join(stage, "node_modules"), { recursive: true });
      await symlink(
        path.dirname(resolver.resolve(name + "/package.json")),
        path.join(stage, "node_modules", name!),
      );
    }
    let networkRequests = 0;
    const server = createServer((_req, res) => {
      networkRequests++;
      res.end("forbidden");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    const launch = () =>
      electron.launch({
        executablePath: require("electron"),
        args: [path.join(stage, "dist/main.js")],
        env: {
          ...process.env,
          PLUMS_NODE: f.options.nodePath,
          PLUMS_DATA_DIR: f.dir,
        },
      });
    let app = await launch();
    const script = (id: string, code: string) =>
      app.evaluate(
        async ({ webContents }, { id, code }) =>
          webContents
            .getAllWebContents()
            .find(
              (w) =>
                w.getURL().startsWith("plums-agent://") && w.getTitle() === id,
            )
            ?.executeJavaScript(code),
        { id, code },
      );
    const files = path.resolve(".artifacts/common-contract/stage-5");
    await mkdir(files, { recursive: true });
    try {
      let page = await app.firstWindow();
      await page
        .getByRole("article", { name: "查看 Workspace fixture" })
        .click();
      const composition = page.getByTestId("workspace-composition");
      await composition.getByLabel("screen-b", { exact: true }).check();
      await composition
        .getByRole("button", { name: "保存组合", exact: true })
        .click();
      await expect
        .poll(async () => {
          const p: any = await page.evaluate(
            (id) => window.manager.call("workspacePlan", { instanceId: id }),
            f.a.instanceId,
          );
          return p.layout?.views[0]?.componentId;
        })
        .toBe("screen-b");
      await composition.getByRole("button", { name: "打开所选主界面" }).click();
      for (const id of ["screen-a", "screen-b"])
        await expect.poll(() => script(id, "window.fixtureReady")).toBe(true);
      const contexts: any[] = await Promise.all(
        ["screen-a", "screen-b"].map((id) => script(id, "plums.context()")),
      );
      expect(contexts.map((c) => c.componentId)).toEqual([
        "screen-a",
        "screen-b",
      ]);
      expect(new Set(contexts.map((c) => c.handle)).size).toBe(2);
      expect(contexts[0].sessionId).toBe(contexts[1].sessionId);
      for (const id of ["screen-a", "screen-b"])
        await script(
          id,
          "window.legacyEvents=[];plums.onEvent(e=>window.legacyEvents.push(e));true",
        );
      for (const id of ["screen-a", "screen-b"]) {
        expect(await script(id, "window.run()")).toMatchObject({
          outcome: {
            value: {
              provider: "backend-a",
              context: { componentId: "backend-a" },
            },
          },
        });
        expect(
          await script(
            id,
            "({node:typeof require,process:typeof process,manager:typeof manager,policy:Object.keys(plums.common.policy),opener:window.opener})",
          ),
        ).toEqual({
          node: "undefined",
          process: "undefined",
          manager: "undefined",
          policy: ["status"],
          opener: null,
        });
      }
      for (const id of ["screen-a", "screen-b"])
        expect(await script(id, "window.legacyEvents")).toEqual([]);
      const transferred = await script(
        "screen-a",
        "plums.common.binding('backend').then(b=>b.handle)",
      );
      expect(
        await script(
          "screen-b",
          `plums.common.invoke(${JSON.stringify(transferred)},'echo',null).then(()=>false,e=>e.details.reason)`,
        ),
      ).toBe("STALE_BINDING");
      const before = await script("screen-b", "location.href");
      await script("screen-b", `location.href=${JSON.stringify(origin)};true`);
      expect(await script("screen-b", "location.href")).toBe(before);
      await script("screen-b", "location.href='other.html';true");
      expect(await script("screen-b", "location.href")).toBe(before);
      expect(
        await script(
          "screen-b",
          `fetch(${JSON.stringify(origin)}).then(()=>false,()=>true)`,
        ),
      ).toBe(true);
      expect(
        await script(
          "screen-b",
          `window.open(${JSON.stringify(origin)})===null`,
        ),
      ).toBe(true);
      expect(networkRequests).toBe(0);
      const taskId = await script(
        "screen-a",
        `(async()=>{const t=await plums.common.tasks.create({lifetime:'agent'});window.running=await plums.common.invoke((await plums.common.binding('backend')).handle,'hold',null,{taskId:t.taskId});window.states=[];window.off=plums.common.tasks.subscribe(t.taskId,s=>window.states.push(s.status.state));for await(const e of window.running.events){window.actualPid=e.data.pid;break}return t.taskId})()`,
      );
      const pid = await script("screen-a", "window.actualPid");
      expect(typeof pid).toBe("number");
      await expect
        .poll(() => script("screen-a", "window.states.includes('running')"))
        .toBe(true);
      expect(
        ((await script("screen-b", "plums.common.tasks.list()")) as any[]).some(
          (t) => t.taskId === taskId,
        ),
      ).toBe(false);
      await script("screen-a", "plums.openManager()");
      await page.evaluate(
        ({ id, taskId }) =>
          window.manager.call("permitTaskTakeover", {
            instanceId: id,
            taskId,
            packageId: "screen-b",
            enabled: true,
          }),
        { id: f.a.instanceId, taskId },
      );
      expect(
        ((await script("screen-b", "plums.common.tasks.list()")) as any[]).some(
          (t) => t.taskId === taskId,
        ),
      ).toBe(true);
      expect(
        await script(
          "screen-b",
          `plums.common.attach(${JSON.stringify(taskId)},0).then(c=>{window.attached=c;return c.taskId})`,
        ),
      ).toBe(taskId);
      await script(
        "screen-a",
        `plums.panels.layout({root:{x:0,y:0,width:1,height:.5},panels:[{handle:${JSON.stringify(contexts[1].handle)},x:0,y:.5,width:1,height:.5}]})`,
      );
      await page.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        f.b.instanceId,
      );
      await page.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      for (const id of ["screen-a", "screen-b"])
        await expect.poll(() => script(id, "window.fixtureReady")).toBe(true);
      const next: any = await script("screen-a", "plums.context()");
      expect(next.handle).not.toBe(contexts[0].handle);
      expect(next.sessionId).not.toBe(contexts[0].sessionId);
      process.kill(pid as number, 0);
      expect(
        await script(
          "screen-a",
          `plums.common.tasks.status(${JSON.stringify(taskId)}).then(s=>s.status.state)`,
        ),
      ).toBe("running");
      expect(
        await script(
          "screen-b",
          `plums.common.attach(${JSON.stringify(taskId)},0).then(c=>c.taskId)`,
        ),
      ).toBe(taskId);
      await script("screen-a", "plums.openManager()");
      for (const width of [1120, 820, 560, 320]) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const w = BrowserWindow.getAllWindows()[0]!;
          w.setMinimumSize(0, 0);
          w.setContentSize(width, 850);
        }, width);
        await composition.scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: path.join(files, `workspace-ui-${width}.png`),
        });
        await page.evaluate(() => window.manager.call("showAgent"));
        for (const id of ["screen-a", "screen-b"])
          expect(
            await script(
              id,
              "document.documentElement.scrollWidth<=innerWidth",
            ),
          ).toBe(true);
        const frames = await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children.map((v) => ({
            bounds: v.getBounds(),
            visible: v.getVisible(),
          })),
        );
        expect(frames).toHaveLength(2);
        expect(
          frames.every(
            (f) =>
              f.visible &&
              f.bounds.width > 0 &&
              f.bounds.height > 0 &&
              f.bounds.y >= 40,
          ),
        ).toBe(true);
        const metrics = [];
        for (const id of ["screen-a", "screen-b"]) {
          await script(
            id,
            "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))",
          );
          const viewport = await script(
            id,
            "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
          );
          const screen = await app.evaluate(
            async ({ webContents }, id) =>
              (
                await webContents
                  .getAllWebContents()
                  .find((w) => w.getTitle() === id)!
                  .capturePage()
              )
                .toPNG()
                .toString("base64"),
            id,
          );
          const pixels = Buffer.from(screen, "base64");
          expect(pixels.length).toBeGreaterThan(1000);
          await writeFile(
            path.join(files, `workspace-layout-${width}-${id}.png`),
            pixels,
          );
          metrics.push({
            id,
            viewport,
            pixelWidth: pixels.readUInt32BE(16),
            pixelHeight: pixels.readUInt32BE(20),
          });
        }
        await writeFile(
          path.join(files, `workspace-layout-${width}.json`),
          JSON.stringify({ width, frames, metrics }, null, 2),
        );
        await script("screen-a", "plums.openManager()");
      }
      await page.evaluate(
        ({ id, taskId }) =>
          window.manager.call("permitTaskTakeover", {
            instanceId: id,
            taskId,
            packageId: "screen-b",
            enabled: false,
          }),
        { id: f.a.instanceId, taskId },
      );
      expect(
        await script(
          "screen-b",
          `plums.common.tasks.status(${JSON.stringify(taskId)}).then(()=>false,e=>e.details.reason)`,
        ),
      ).toBe("NOT_AUTHORIZED");
      await page.evaluate(
        ({ id, taskId }) =>
          window.manager.call("stopCommonTask", { instanceId: id, taskId }),
        { id: f.a.instanceId, taskId },
      );
      await expect
        .poll(() => {
          try {
            process.kill(pid as number, 0);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
      const oldBinding = await script(
        "screen-a",
        "plums.common.binding('backend').then(b=>b.handle)",
      );
      const plan: any = await page.evaluate(
        (id) => window.manager.call("protocolPlan", { instanceId: id }),
        f.a.instanceId,
      );
      const intent = plan.requirements
        .find((r: any) => r.consumerId === "screen-a")
        .candidates.find(
          (c: any) => c.intent.providerId === "backend-b",
        ).intent;
      await page.evaluate(
        ({ id, intent, fingerprint }) =>
          window.manager.call("setProtocolBinding", {
            instanceId: id,
            consumerId: "screen-a",
            requirementId: "backend",
            choice: intent,
            fingerprint,
          }),
        { id: f.a.instanceId, intent, fingerprint: plan.fingerprint },
      );
      await expect.poll(() => script("screen-a", "true")).toBeUndefined();
      await page.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      await expect
        .poll(() => script("screen-a", "window.fixtureReady"))
        .toBe(true);
      expect(
        await script(
          "screen-a",
          `plums.common.invoke(${JSON.stringify(oldBinding)},'echo',null).then(()=>false,e=>e.details.reason)`,
        ),
      ).toBe("STALE_BINDING");
      expect(await script("screen-a", "window.run()")).toMatchObject({
        outcome: { value: { provider: "backend-b" } },
      });
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await page.getByTestId("nav-tab-home").waitFor();
      await page.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      for (const id of ["screen-a", "screen-b"])
        await expect.poll(() => script(id, "window.fixtureReady")).toBe(true);
      expect(
        await script("screen-a", "plums.common.policy.status()"),
      ).toMatchObject({ active: null });
      expect(await script("screen-a", "plums.context()")).not.toMatchObject({
        sessionId: next.sessionId,
      });
      const finalPlan: any = await page.evaluate(
        (id) => window.manager.call("workspacePlan", { instanceId: id }),
        f.a.instanceId,
      );
      expect(finalPlan.layout.root.height).toBe(0.5);
      const preferenceEvidence = await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .filter((w) => w.getURL().startsWith("plums-agent://"))
          .map((w) => {
            const p = w.getLastWebPreferences();
            return {
              sandbox: p.sandbox,
              contextIsolation: p.contextIsolation,
              nodeIntegration: p.nodeIntegration,
            };
          }),
      );
      expect(preferenceEvidence).toEqual(
        Array(2).fill({
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        }),
      );
      await page.evaluate(
        (id) =>
          window.manager.call("openAgent", {
            instanceId: id,
            componentId: "screen-b",
          }),
        f.a.instanceId,
      );
      await expect
        .poll(() => script("screen-b", "window.fixtureReady"))
        .toBe(true);
      const alternate: any = await script("screen-b", "plums.context()");
      const alternateBinding = await script(
        "screen-b",
        "plums.common.binding('backend').then(b=>b.handle)",
      );
      await script("screen-b", "plums.cancel()");
      const renewed: any = await script("screen-b", "plums.context()");
      expect(renewed.componentId).toBe("screen-b");
      expect(renewed.handle).not.toBe(alternate.handle);
      expect(
        await script(
          "screen-b",
          `plums.common.invoke(${JSON.stringify(alternateBinding)},'echo',null).then(()=>false,e=>e.details.reason)`,
        ),
      ).toBe("STALE_BINDING");
      expect(await script("screen-b", "window.run()")).toMatchObject({
        outcome: { value: { provider: "backend-a" } },
      });
      await page.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      await expect
        .poll(() => script("screen-a", "window.fixtureReady"))
        .toBe(true);
      await script("screen-a", "plums.openManager()");
      await page.evaluate(
        (id) =>
          window.manager.call("disable", {
            instanceId: id,
            packageId: "screen-b",
          }),
        f.a.instanceId,
      );
      await page.evaluate(
        (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      await expect
        .poll(() => script("screen-a", "window.fixtureReady"))
        .toBe(true);
      await expect
        .poll(() =>
          page.getByTestId("running-bar").getByRole("status").textContent(),
        )
        .toBe("部分界面未恢复");
      await script("screen-a", "plums.openManager()");
      await page
        .getByRole("article", { name: "查看 Workspace fixture" })
        .click();
      const recovery = page.getByTestId("workspace-composition");
      await expect
        .poll(() => recovery.getByText(/保存的界面已不可用/).isVisible())
        .toBe(true);
      await expect
        .poll(() =>
          recovery
            .getByLabel("screen-b（未启用）", { exact: true })
            .isChecked(),
        )
        .toBe(false);
      await recovery
        .getByRole("button", { name: "保存组合", exact: true })
        .click();
      await expect
        .poll(async () => {
          const p: any = await page.evaluate(
            (id) => window.manager.call("workspacePlan", { instanceId: id }),
            f.a.instanceId,
          );
          return p.layout.views.length;
        })
        .toBe(0);
      await writeFile(
        path.join(files, "native-workspace-evidence.json"),
        JSON.stringify(
          {
            contexts,
            next,
            taskId,
            pid,
            networkRequests,
            preferences: preferenceEvidence,
            restarted: true,
            layoutRoot: finalPlan.layout.root,
          },
          null,
          2,
        ),
      );
    } finally {
      await app.close();
      await new Promise<void>((r) => server.close(() => r()));
      await rm(f.dir, { recursive: true, force: true });
    }
  },
  60000,
);
