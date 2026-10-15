import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { catalog } from "../fixtures/dependency-chain.js";

for (const failCleanup of [false, true]) {
  test(`withdraws a composed service chain after view release failure (consumer cleanup fails: ${failCleanup})`, async ({
    page,
  }) => {
    await page.route("**/catalog.json", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ json: [...(await response.json()), ...catalog] });
    });
    for (const name of ["dependency-chain.js", "dependency-state.js"]) {
      await page.route(`**/fixtures/${name}*`, (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: readFileSync(
            new URL(`../fixtures/${name}`, import.meta.url),
            "utf8",
          ),
        }),
      );
    }
    await page.goto("/");
    await page.getByRole("button", { name: "授予实验能力并启动" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await page.getByRole("button", { name: "扩展管理", exact: true }).click();
    for (const id of [
      "combo.leaf",
      "combo.middle",
      "combo.provider",
      "combo.controls",
    ]) {
      await page
        .getByRole("button", { name: `启用 ${id}`, exact: true })
        .click();
    }
    await page.getByLabel("界面布局").selectOption("combo-controls");
    await page.getByRole("button", { name: "发送组合事件" }).click();
    await expect(
      page.getByText("旧服务调用 2 · 已取消 0 · 清理回调 0 · 取消通知 0", {
        exact: true,
      }),
    ).toBeVisible();
    if (failCleanup) await page.getByLabel("注入消费者清理失败").check();
    await page.getByLabel("界面布局").selectOption("combo-owner");
    await expect(
      page.getByText("组合提供者视图：切换离开将注入释放失败", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("界面布局").selectOption("default");
    const owner = page.locator("article").filter({ hasText: "组合提供者" });
    const middle = page.locator("article").filter({ hasText: "组合中间层" });
    const leaf = page.locator("article").filter({ hasText: "组合叶节点" });
    await expect(owner).toContainText("清理未完成");
    await expect(middle).toContainText(failCleanup ? "清理未完成" : "等待条件");
    await expect(leaf).toContainText("等待条件");
    await expect(leaf).toContainText("0 项资源 · 0 个在途任务");
    await expect(
      page.getByRole("button", { name: "启用 combo.provider", exact: true }),
    ).toBeDisabled();
    if (failCleanup)
      await expect(
        page.getByRole("button", { name: "启用 combo.middle", exact: true }),
      ).toBeDisabled();
    else await expect(middle).toContainText("0 项资源 · 0 个在途任务");
    await page.getByLabel("界面布局").selectOption("combo-controls");
    await page.getByRole("button", { name: "发送组合事件" }).click();
    await expect(
      page.getByText("旧服务调用 2 · 已取消 2 · 清理回调 2 · 取消通知 3", {
        exact: true,
      }),
    ).toBeVisible();
  });
}
