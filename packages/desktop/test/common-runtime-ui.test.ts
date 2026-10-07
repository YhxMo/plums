import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { cp, mkdir, symlink, rm } from "node:fs/promises";
import path from "node:path";
import { fixture } from "../../host/test/common-fixture.js";
const require = createRequire(import.meta.url);
it.runIf(process.platform === "darwin")(
  "real trusted UI manages background tasks; sandbox frontend invokes, closes, reattaches and stops through the common bridge",
  async () => {
    const f = await fixture("controlled-node");
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
        path.join(stage, "node_modules", name),
      );
    }
    const app = await electron.launch({
      executablePath: require("electron"),
      args: [path.join(stage, "dist/main.js")],
      env: {
        ...process.env,
        PLUMS_NODE: path.join(
          root,
          ".artifacts/node-v26.5.1-darwin-arm64/bin/node",
        ),
        PLUMS_DATA_DIR: f.dir,
      },
    });
    try {
      const page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Fixture A" }).click();
      const panel = page.getByTestId("controlled-tasks");
      await panel.getByLabel("consumer：允许声明的 Agent 后台任务").check();
      await expect
        .poll(() =>
          panel.getByLabel("consumer：允许声明的 Agent 后台任务").isChecked(),
        )
        .toBe(true);
      await page.evaluate(
        async (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      const frontend = (script: string) =>
        app.evaluate(async ({ webContents }, script) => {
          const view = webContents
            .getAllWebContents()
            .find((w) => w.getURL().startsWith("plums-agent://"));
          return view?.executeJavaScript(script);
        }, script);
      await expect
        .poll(() => frontend("typeof plums.common?.invoke"))
        .toBe("function");
      const taskId = await frontend(
        `(async()=>{const task=await plums.common.tasks.create({lifetime:'agent'}),b=await plums.common.binding('backend');const call=await plums.common.invoke(b.handle,'hang',null,{taskId:task.taskId});window.savedTaskId=call.taskId;return call.taskId;})()`,
      );
      await frontend("plums.openManager()");
      await expect
        .poll(
          async () => {
            const list: any = await page.evaluate(
              async (id) =>
                window.manager.call("commonTasks", { instanceId: id }),
              f.a.instanceId,
            );
            return list.find((t: any) => t.description.taskId === taskId)
              ?.snapshot.status.state;
          },
          { timeout: 10000 },
        )
        .toBe("running");
      await page.evaluate(
        async (id) => window.manager.call("openAgent", { instanceId: id }),
        f.b.instanceId,
      );
      await page.evaluate(
        async (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a.instanceId,
      );
      expect(
        await frontend(
          `(async()=>{const c=await plums.common.attach(${JSON.stringify(taskId)},0);return {taskId:c.taskId,state:(await plums.common.tasks.status(c.taskId)).status.state};})()`,
        ),
      ).toEqual({ taskId, state: "running" });
      await frontend("plums.openManager()");
      await expect
        .poll(() =>
          panel.getByText("运行中 · Agent 后台", { exact: true }).count(),
        )
        .toBe(1);
      const outputs = path.join(root, ".artifacts/common-contract/stage-3");
      await mkdir(outputs, { recursive: true });
      for (const width of [1120, 820, 560, 320]) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const w = BrowserWindow.getAllWindows()[0]!;
          w.setMinimumSize(0, 0);
          w.setSize(width, 850);
        }, width);
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(outputs, `tasks-ui-${width}.png`),
        });
        expect(
          await panel.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        ).toBe(false);
      }
      await panel
        .getByRole("button", { name: "停止任务", exact: true })
        .click();
      await expect
        .poll(() =>
          panel.getByText("已停止 · Agent 后台", { exact: true }).count(),
        )
        .toBe(1);
      const status: any = await page.evaluate(
        async (id) => window.manager.call("commonTasks", { instanceId: id }),
        f.a.instanceId,
      );
      expect(
        status.find((t: any) => t.description.taskId === taskId).snapshot.status
          .executionState,
      ).toBe("unknown");
    } finally {
      await app.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
  60000,
);
