import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { rm, mkdir, cp, symlink } from "node:fs/promises";
import path from "node:path";
import { resourceFixture } from "../../host/test/resource-fixture.js";
const require = createRequire(import.meta.url);
it.runIf(process.platform === "darwin")(
  "manages resource ranges and verifies the real sandbox frontend bridge through native main, broker and host",
  async () => {
    const f = await resourceFixture();
    await f.host.setStartup(f.a, "records-provider");
    await f.host.close();
    const root = process.cwd(),
      stage = path.join(f.dir, "desktop");
    await cp(
      path.join(root, "packages/desktop/dist"),
      path.join(stage, "dist"),
      { recursive: true },
    );
    for (const [name, packageName] of [
      ["isolated-vm", "host"],
      ["better-sqlite3", "core"],
    ]) {
      const resolver = createRequire(
        path.join(root, `packages/${packageName}/package.json`),
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
        PLUMS_NODE: process.execPath,
        PLUMS_DATA_DIR: f.dir,
      },
    });
    try {
      const page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Fixture A" }).click();
      const panel = page.getByRole("region", { name: "业务资源" });
      await panel.getByLabel("管理资源", { exact: true }).waitFor();
      await panel
        .getByLabel("管理资源", { exact: true })
        .selectOption(f.shared);
      const field = panel.getByRole("group", { name: "本 Agent 的资格" });
      await expect
        .poll(() =>
          field
            .getByRole("checkbox", { name: "读取", exact: true })
            .isChecked(),
        )
        .toBe(true);
      await field
        .getByRole("checkbox", { name: "删除", exact: true })
        .uncheck();
      await expect
        .poll(() =>
          field
            .getByRole("checkbox", { name: "删除", exact: true })
            .isChecked(),
        )
        .toBe(false);
      const initialPlan = (await page.evaluate(
        async (id) => window.manager.call("resourcePlan", { instanceId: id }),
        f.a,
      )) as any;
      const privateId = initialPlan.spaces.find(
        (s: any) => s.ownerAgentId === f.a,
      ).id;
      const bindingSelect = panel.getByLabel("Platform fixture 的资源 shared", {
        exact: true,
      });
      for (const resourceId of [privateId, f.shared]) {
        await bindingSelect.selectOption(resourceId);
        await expect
          .poll(async () => {
            const plan = (await page.evaluate(
              async (id) =>
                window.manager.call("resourcePlan", { instanceId: id }),
              f.a,
            )) as any;
            return plan.bindings.find((b: any) => b.requirementId === "shared")
              .resourceId;
          })
          .toBe(resourceId);
        // A committed binding precedes the refreshed controlled select.
        // Wait for both before choosing the next value.
        await expect.poll(() => bindingSelect.inputValue()).toBe(resourceId);
      }
      await panel.getByLabel("共用组名称").fill("A separate shared group");
      await panel
        .getByRole("button", { name: "创建共用组", exact: true })
        .click();
      await panel
        .getByLabel("管理资源", { exact: true })
        .selectOption({ label: "A separate shared group · 共用" });
      await expect
        .poll(() =>
          panel
            .getByRole("group", { name: "本 Agent 的资格" })
            .getByRole("checkbox", { name: "读取", exact: true })
            .isChecked(),
        )
        .toBe(false);
      await panel.getByLabel("资源访问模式").selectOption("full-access");
      const range = panel.getByRole("group", {
        name: "Platform fixture → Shared fixture",
      });
      await range.getByRole("checkbox", { name: "读取", exact: true }).check();
      await panel
        .getByRole("button", { name: "授予完全访问所选业务资源", exact: true })
        .click();
      await panel
        .getByText("完全访问业务资源已生效", { exact: true })
        .waitFor();
      const plan = (await page.evaluate(
        async (id) => window.manager.call("resourcePlan", { instanceId: id }),
        f.a,
      )) as any;
      expect(plan.active).toMatchObject({
        mode: "full-access",
        selection: [
          {
            componentId: "records-provider",
            resourceId: f.shared,
            operations: ["read"],
          },
        ],
      });
      const outputs = path.join(root, ".build-cache/common-contract/resources");
      await mkdir(outputs, { recursive: true });
      for (const width of [1120, 820, 560]) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          window.setMinimumSize(0, 0); // Responsive inspection in a disposable test window.
          window.setSize(width, 850);
        }, width);
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(outputs, `resources-ui-${width}.png`),
        });
        const overflow = await panel.evaluate(
          (el) => el.scrollWidth > el.clientWidth + 1,
        );
        expect(overflow).toBe(false);
      }
      await page.evaluate(
        async (id) => window.manager.call("openAgent", { instanceId: id }),
        f.a,
      );
      const frontend = (script: string) =>
        app.evaluate(async ({ webContents }, script) => {
          const view = webContents
            .getAllWebContents()
            .find((w) => w.getURL().startsWith("plums-agent://"));
          return view?.executeJavaScript(script);
        }, script);
      await expect
        .poll(() => frontend("typeof window.plums?.resources?.list"))
        .toBe("function");
      const read = await frontend(
        `(async()=>{window.resourceBinding=(await plums.resources.list()).find(r=>r.requirementId==='shared').binding;return plums.resources.read(window.resourceBinding,'frontend-key');})()`,
      );
      expect(read).toEqual({ exists: false, revision: "0" });
      const denied = await frontend(
        `(async()=>{try{await plums.resources.write(window.resourceBinding,'frontend-key','0',{value:1});return {allowed:true}}catch(e){return {allowed:false,error:e}}})()`,
      );
      expect(denied).toMatchObject({
        allowed: false,
        error: {
          code: "CAPABILITY_FAILED",
          details: { executionState: "not_started" },
        },
      });
      await page.evaluate(
        async (id) =>
          window.manager.call("revokeResourceRange", { instanceId: id }),
        f.a,
      );
      await expect
        .poll(() =>
          app.evaluate(
            ({ webContents }) =>
              webContents
                .getAllWebContents()
                .filter((w) => w.getURL().startsWith("plums-agent://")).length,
          ),
        )
        .toBe(0);
      await expect
        .poll(
          async () =>
            (
              (await page.evaluate(
                async (id) =>
                  window.manager.call("resourcePlan", { instanceId: id }),
                f.a,
              )) as any
            ).active,
        )
        .toBeUndefined();
    } finally {
      await app.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
  60_000,
);
