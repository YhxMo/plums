import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { cp, mkdir, symlink, rm } from "node:fs/promises";
import path from "node:path";
import { fixture } from "../../host/test/common-fixture.js";
import { addPolicy } from "../../host/test/policy-fixture.js";
const require = createRequire(import.meta.url);
it.runIf(process.platform === "darwin")(
  "trusted manager selects a fixed strategy and maximum; sandbox state is read-only and restart erases its lease",
  async () => {
    const f = await fixture();
    await addPolicy(f.host, f.a.instanceId, "allow");
    await addPolicy(f.host, f.a.instanceId, "deny");
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
    const launch = () =>
      electron.launch({
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
    let app = await launch();
    try {
      let page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Fixture A" }).click();
      let panel = page.getByTestId("policy-modes");
      await expect
        .poll(() =>
          panel.getByText("当前使用安全确认。", { exact: true }).isVisible(),
        )
        .toBe(true);
      await panel
        .getByLabel("策略组件", { exact: true })
        .selectOption("policy-allow/decision");
      await panel
        .getByLabel("模式名称", { exact: true })
        .selectOption("full-access");
      await panel
        .getByRole("button", { name: "保存策略", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("未批准活动范围");
      const scope = panel.locator('.policy-scope-list input[type="checkbox"]');
      for (let i = 0; i < (await scope.count()); i++)
        await scope.nth(i).check();
      await panel
        .getByRole("button", { name: "批准所选范围", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("有效至");
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
        .poll(() => frontend("typeof plums.common?.policy?.status"))
        .toBe("function");
      const state = (await frontend("plums.common.policy.status()")) as any;
      expect(state.selected.mode).toBe("full-access");
      expect(state.active.modeGeneration).toBeGreaterThan(0);
      expect(await frontend("typeof plums.common.policy.select")).toBe(
        "undefined",
      );
      const denied = await frontend(
        "(async()=>{try{await plums.common.invoke('forged','x',null);return false;}catch{return true;}})()",
      );
      expect(denied).toBe(true);
      await frontend("plums.openManager()");
      const outputs = path.join(root, ".artifacts/common-contract/stage-4");
      await mkdir(outputs, { recursive: true });
      for (const width of [1120, 820, 560, 320]) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const w = BrowserWindow.getAllWindows()[0]!;
          w.setMinimumSize(0, 0);
          w.setSize(width, 900);
        }, width);
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => innerWidth)).toBe(width);
        await page.screenshot({
          path: path.join(outputs, `policy-ui-${width}.png`),
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      await panel
        .getByRole("button", { name: "撤销并停止", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("未批准活动范围");
      await panel
        .getByLabel("策略组件", { exact: true })
        .selectOption("policy-deny/decision");
      await panel
        .getByRole("button", { name: "保存策略", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("Policy deny");
      const chosen = panel.locator('.policy-scope-list input[type="checkbox"]');
      for (let i = 0; i < (await chosen.count()); i++)
        await chosen.nth(i).check();
      await panel
        .getByRole("button", { name: "批准所选范围", exact: true })
        .click();
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("有效至");
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Fixture A" }).click();
      panel = page.getByTestId("policy-modes");
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("Policy deny");
      await expect
        .poll(() => panel.getByRole("status").textContent())
        .toContain("未批准活动范围");
    } finally {
      await app.close();
      await f.host.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
  60000,
);
