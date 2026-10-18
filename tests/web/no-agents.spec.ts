import { test, expect } from "@playwright/test";
import { manage } from "./helpers";

for (const width of [375, 1180]) {
  test(`alternative combination boots, manages and restores without agents at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/src/application.ts", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: 'export { boot } from "/tests/fixtures/no-agents.ts";',
      }),
    );
    await page.route("**/catalog.json", (route) => route.fulfill({ json: [] }));
    await page.addInitScript(() => {
      if (!localStorage.getItem("plums:m1:host.shell"))
        localStorage.setItem(
          "plums:m1:host.shell",
          JSON.stringify({
            schema: 1,
            revision: 1,
            value: {
              version: 1,
              agents: { externalFormat: true },
              layout: "notes",
            },
          }),
        );
    });
    await page.goto("/");
    await page.getByLabel("笔记草稿").fill("未保存的独立草稿");
    await manage(page);
    await expect(
      page.getByRole("heading", { name: "扩展与状态" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "启用 agents.local", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(page.getByLabel("笔记草稿")).toHaveValue("未保存的独立草稿");
    await page.getByRole("button", { name: "保存笔记", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "笔记已保存" }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("笔记草稿")).toHaveValue("未保存的独立草稿");
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value.agents,
      ),
    ).toEqual({ externalFormat: true });
    await manage(page);
    await page.getByRole("button", { name: "停用 notes", exact: true }).click();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "从一个可替换的界面开始。" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "授予实验能力并启动", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "查看本地扩展", exact: true })
      .click();
    await page.getByRole("button", { name: "启用 notes", exact: true }).click();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(page.getByLabel("笔记草稿")).toHaveValue("未保存的独立草稿");
    expect(errors).toEqual([]);
    await page.screenshot({ path: `.cache/no-agents-${width}.png` });
  });
}
