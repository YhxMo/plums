import { test, expect, type Page } from "@playwright/test";
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "授予实验能力并启动" }).click();
  await expect(
    page.getByRole("heading", { name: "让扩展开始工作。" }),
  ).toBeVisible();
}
async function run(page: Page, input: string, output: string) {
  await page.getByRole("textbox", { name: "待处理文本" }).fill(input);
  await page.getByRole("button", { name: "运行并保存" }).click();
  await expect(page.locator("[data-output]")).toHaveText(output);
  await expect(page.locator("[data-phase]")).toHaveText("已保存");
}
test("replaces complete UI and restores persisted state after reload", async ({
  page,
}) => {
  await start(page);
  await run(page, "plums", "PLUMS");
  await page.getByLabel("界面布局").selectOption("board");
  await expect(
    page.getByRole("navigation", { name: "画布导航" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "授予实验能力并启动" }).click();
  await expect(
    page.getByRole("heading", { name: "把工作铺开。" }),
  ).toBeVisible();
  await expect(page.locator("[data-output]")).toHaveText("PLUMS");
  await page.getByRole("button", { name: "停用当前布局" }).click();
  await expect(
    page.getByRole("heading", { name: "让扩展开始工作。" }),
  ).toBeVisible();
});
test("rebinds consumer and remounts a view when the provider changes", async ({
  page,
}) => {
  await start(page);
  await run(page, "abc", "ABC");
  await page.getByRole("button", { name: "替换服务" }).click();
  await expect(page.locator("[data-provider]")).toHaveText("Reverse");
  await run(page, "abc", "cba");
});
test("cancel prevents a new result from being persisted", async ({ page }) => {
  await start(page);
  await run(page, "saved", "SAVED");
  await page.getByRole("textbox", { name: "待处理文本" }).fill("do not save");
  await page.getByRole("button", { name: "运行并保存" }).click();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.locator("[data-phase]")).toContainText("已取消");
  await expect(page.locator("[data-output]")).toHaveText("SAVED");
  await page.reload();
  await page.getByRole("button", { name: "授予实验能力并启动" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("saved");
});
test("failed storage preserves prior state and can retry", async ({ page }) => {
  await start(page);
  await run(page, "saved", "SAVED");
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("textbox").fill("failed");
  await page.getByRole("button", { name: "运行并保存" }).click();
  await expect(page.locator("[data-error]")).toContainText("注入的写入故障");
  await expect(page.locator("[data-output]")).toHaveText("SAVED");
  await page.getByLabel("注入存储写入失败").uncheck();
  await run(page, "retry", "RETRY");
});
test("revoking capability suspends consumers, and regrant restores the UI", async ({
  page,
}) => {
  await start(page);
  await run(page, "saved", "SAVED");
  await page.getByRole("button", { name: "撤销状态写入", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "扩展正在等待条件。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "恢复权限与默认界面" }).click();
  await expect(page.locator("[data-output]")).toHaveText("SAVED");
});
test("broken layout recovers to the working default without losing management", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "测试故障布局" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "布局不可用" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "让扩展开始工作。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "扩展管理", exact: true }),
  ).toBeEnabled();
});
test("ordinary UI fits a narrow viewport and works with keyboard input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await run(page, "narrow screen", "NARROW SCREEN");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("界面布局").selectOption("board");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("textbox").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("keyboard");
  await expect(page.getByRole("textbox")).toHaveValue("keyboard");
});
test("loads and enables an unknown external view through the public catalog and management UI", async ({
  page,
}) => {
  await page.route("**/catalog.json", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      json: [
        ...catalog,
        {
          id: "external.view",
          url: "/external-view.js",
          label: "未知作者界面",
        },
      ],
    });
  });
  await page.route("**/external-view.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export default {manifest:{id:"external.view",version:"1.0.0",apiVersion:1},activate(ctx){ctx.view({id:"external",label:"未知界面",mount(root){const h=document.createElement("h1");h.textContent="独立模块的新交互";root.append(h);return()=>root.replaceChildren();}})}}',
    }),
  );
  await start(page);
  await page
    .getByRole("button", { name: "启用 external.view", exact: true })
    .click();
  await page.getByLabel("界面布局").selectOption("external");
  await expect(
    page.getByRole("heading", { name: "独立模块的新交互" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停用当前布局" }).click();
  await expect(
    page.getByRole("heading", { name: "让扩展开始工作。" }),
  ).toBeVisible();
});

test("a broken layout with no remaining layout exposes a truthful host recovery path", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "停用 ui.default", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "把工作铺开。" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "停用 ui.board", exact: true })
    .click();
  await page
    .getByRole("button", { name: "启用 ui.broken", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "扩展正在等待条件。" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText("已恢复默认界面");
  await page.getByRole("button", { name: "恢复权限与默认界面" }).click();
  await expect(
    page.getByRole("heading", { name: "让扩展开始工作。" }),
  ).toBeVisible();
});

test("an async release failure stays visible in the React management path", async ({
  page,
}) => {
  await page.route("**/catalog.json", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      json: [
        ...catalog,
        {
          id: "cleanup.fixture",
          url: "/cleanup-fixture.js",
          label: "异步释放夹具",
        },
      ],
    });
  });
  await page.route("**/cleanup-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export default {manifest:{id:"cleanup.fixture",version:"1.0.0",apiVersion:1},activate(ctx){ctx.view({id:"cleanup",label:"释放夹具",mount(root){root.textContent="等待释放";return async()=>{await Promise.resolve();throw Error("teardown failed")}}})}}',
    }),
  );
  await start(page);
  await page
    .getByRole("button", { name: "启用 cleanup.fixture", exact: true })
    .click();
  await page.getByLabel("界面布局").selectOption("cleanup");
  await expect(page.getByText("等待释放", { exact: true })).toBeVisible();
  await page.getByLabel("界面布局").selectOption("default");
  await expect(
    page.getByRole("heading", { name: "让扩展开始工作。" }),
  ).toBeVisible();
  await expect(
    page.locator("article").filter({ hasText: "异步释放夹具" }),
  ).toContainText("清理未完成");
  await expect(
    page.getByRole("button", { name: "启用 cleanup.fixture", exact: true }),
  ).toBeDisabled();
});
