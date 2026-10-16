import { manage, legacyEntry } from "./helpers";
import { test, expect } from "@playwright/test";

test("cancel returns to the initiating control even when activation does not focus it", async ({
  page,
}) => {
  await page.goto("/");
  const launch = await legacyEntry(page);
  // macOS WebKit pointer activation does not necessarily focus a button.
  await launch.evaluate((button: HTMLButtonElement) => button.click());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "暂不授权" })
    .click();
  await expect(launch).toBeFocused();
});

test("authorization can be cancelled and restores keyboard focus", async ({
  page,
}) => {
  await page.goto("/");
  const launch = await legacyEntry(page);
  await launch.click();
  const dialog = page.getByRole("dialog", { name: "授权并启动扩展" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("读取隔离状态");
  await expect(dialog).toContainText("写入隔离状态");
  await expect(dialog.getByRole("button", { name: "暂不授权" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "授权并启动", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "暂不授权" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(launch).toBeFocused();
  await manage(page);
  const workbench = page.locator("article").filter({ hasText: "文本工作台" });
  await expect(workbench).toContainText("已停用");
  await workbench.getByText("扩展详情", { exact: true }).click();
  await expect(workbench).toContainText("/services/workbench.js");
  await workbench
    .getByRole("button", { name: "启用 workbench", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "暂不授权" }).click();
  await expect(workbench).toContainText("已停用");
});

for (const width of [375, 1280]) {
  test(`inspect, authorize, run, stop and resume preserve state at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await manage(page);
    await expect(
      page.getByRole("heading", { name: "扩展与状态" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回工作区" }).click();
    await (await legacyEntry(page)).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "待处理文本" })
      .fill("full journey");
    await page.getByRole("button", { name: "运行并保存" }).click();
    await expect(page.locator("[data-phase]")).toHaveText("已保存");
    await page.getByRole("textbox").fill("unsaved draft");
    await manage(page);
    await page.getByRole("button", { name: "返回工作区" }).click();
    await expect(page.getByRole("textbox")).toHaveValue("unsaved draft");
    await manage(page);
    const workbench = page.locator("article").filter({ hasText: "文本工作台" });
    await expect(workbench).toContainText("运行中");
    await workbench
      .getByRole("button", { name: "停用 workbench", exact: true })
      .click();
    await expect(workbench).toContainText("0 项资源 · 0 个在途任务");
    await workbench
      .getByRole("button", { name: "启用 workbench", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await expect(workbench).toContainText("运行中");
    await page.getByRole("button", { name: "返回工作区" }).click();
    await expect(page.locator("[data-output]")).toHaveText("FULL JOURNEY");
  });
}

test("management and authorization fit narrow and intermediate screens", async ({
  page,
}) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await manage(page);
    await expect(
      page.getByRole("heading", { name: "扩展与状态" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(() =>
        [
          document.documentElement,
          ...document.querySelectorAll("[data-workspace], main, aside"),
        ].every((node) => node.scrollWidth <= node.clientWidth),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "返回工作区" }).click();
    await (await legacyEntry(page)).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeInViewport();
    await dialog
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await expect(page.getByRole("textbox")).toBeVisible();
    expect(
      await page.evaluate(() =>
        [
          document.documentElement,
          ...document.querySelectorAll("[data-workspace], main, aside"),
        ].every((node) => node.scrollWidth <= node.clientWidth),
      ),
    ).toBe(true);
  }
});

test("dismissible fallback notice, independent extension manager page and topbar controls work end-to-end", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "plums:m1:host.shell",
      JSON.stringify({
        schema: 1,
        revision: 1,
        value: {
          version: 1,
          theme: "light",
          layout: "default",
          agents: [],
        },
      }),
    );
  });
  await page.reload();
  const fallback = page.getByRole("status").filter({ hasText: "所选界面" });
  await expect(fallback).toContainText("工作台 (default)");
  await expect(fallback).toContainText("尚未启用");
  await fallback.getByRole("button", { name: "查看原因", exact: true }).click();
  await expect(page.getByRole("heading", { name: "扩展与状态" })).toBeVisible();
  await expect(page.locator("[data-workspace]")).toBeHidden();
  await expect(
    page.getByRole("region", { name: "所选扩展与关联 Agent 详情" }),
  ).toContainText("ui.default");
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.locator("[data-workspace]")).toBeVisible();
  await fallback
    .getByRole("button", { name: "关闭所选界面提示", exact: true })
    .click();
  await expect(fallback).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value.layout,
    ),
  ).toBe("default");

  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("代码助手");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  const sidebarToggle = page.getByRole("button", {
    name: "展开或收起右侧栏",
    exact: true,
  });
  await sidebarToggle.click();
  await expect(
    page.getByRole("complementary", { name: "Agent 详情" }),
  ).toBeVisible();
  await sidebarToggle.click();
  await expect(
    page.getByRole("complementary", { name: "Agent 详情" }),
  ).toHaveCount(0);

  await manage(page);
  await expect(
    page.locator("#extension-manager").getByText("代码助手").first(),
  ).toBeVisible();
  await page
    .locator("#extension-manager article")
    .filter({ hasText: "本地 Agent 提供者" })
    .click();
  await page.getByRole("button", { name: "跳转到 Agent →" }).first().click();
  await expect(page.locator("[data-workspace]")).toBeVisible();
});
