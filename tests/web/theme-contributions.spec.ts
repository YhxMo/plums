import { expect, test, type Page } from "@playwright/test";
import { manage } from "./helpers";
async function settings(page: Page) {
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "应用设置", exact: true }).click();
  return page.getByRole("dialog", { name: "应用设置" });
}
async function install(page: Page, name: string) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "安装扩展" });
  await dialog.getByLabel("扩展 ID").fill(`sample.theme-${name}`);
  await dialog.getByLabel("模块路径").fill(`/samples/theme-${name}.js`);
  await dialog.getByRole("button", { name: "加载模块", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: `启用 sample.theme-${name}`, exact: true })
    .click();
}
for (const width of [320, 375, 768, 1440])
  test(`public themes apply and recover at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await install(page, "ocean");
    await install(page, "ink");
    const dialog = await settings(page);
    await dialog.getByRole("button", { name: /^使用 海湾/ }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-id",
      "sample.ocean",
    );
    await expect(page.locator("html")).toHaveCSS("--accent", "#176B63");
    await dialog.getByRole("button", { name: /^使用 墨夜/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-id",
      "sample.ink",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.getByRole("button", { name: "关闭" }).click();
    await page
      .getByRole("button", { name: "保存当前组合", exact: true })
      .click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-id",
      "sample.ink",
    );
    await manage(page);
    await page
      .getByRole("button", { name: "停用 sample.theme-ink", exact: true })
      .click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-id");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "所选主题 sample.ink 暂不可用" }),
    ).toBeVisible();
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.style.getPropertyValue("--accent")),
    ).toBe("");
    await page
      .getByRole("button", { name: "启用 sample.theme-ink", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-id",
      "sample.ink",
    );
    const restored = await settings(page);
    await restored
      .getByRole("button", { name: "使用内置外观", exact: true })
      .click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-id");
    await restored.getByRole("button", { name: "关闭" }).click();
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-id");
  });

test("failed theme preference write keeps the applied palette", async ({
  page,
}) => {
  await page.goto("/");
  await install(page, "ocean");
  await install(page, "ink");
  const dialog = await settings(page);
  await dialog.getByRole("button", { name: /^使用 海湾/ }).click();
  await dialog.getByRole("button", { name: "关闭" }).click();
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  const failed = await settings(page);
  await failed.getByRole("button", { name: /^使用 墨夜/ }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-id",
    "sample.ocean",
  );
  await failed.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("alert")).toContainText("注入的写入故障");
});

test("a palette getter invalidating its scope cannot reserve a theme id", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const hostPath = "/modules/extension-host/host.ts";
    const { Host } = await import(hostPath);
    const samplePath = "/samples/theme-ocean.js";
    const { default: ocean } = await import(samplePath);
    const host = new Host({
      kind: "browser",
      available: () => false,
      grant: async () => {},
      call: async () => {},
    });
    let ctx: import("../../modules/sdk").ExtensionContext;
    let theme: import("../../modules/sdk").Theme;
    ocean.activate({
      theme: (value: import("../../modules/sdk").Theme) => {
        theme = value;
      },
    });
    host.install({
      manifest: { id: "broken", version: "1", apiVersion: 1 },
      activate(context: import("../../modules/sdk").ExtensionContext) {
        ctx = context;
        context.view({
          id: "broken.view",
          label: "broken",
          mount: () => () => {
            throw Error("Synthetic close failure");
          },
        });
      },
    });
    await host.start("broken");
    const close = host.mountView("broken.view", document.createElement("div"));
    let rejected = false;
    try {
      ctx!.theme({
        ...theme!,
        get label() {
          try {
            close();
          } catch {}
          return "invalidating getter";
        },
      });
    } catch (e) {
      rejected = String(e).includes("Extension stopped");
    }
    host.install({
      manifest: { id: "replacement", version: "1", apiVersion: 1 },
      activate(context: import("../../modules/sdk").ExtensionContext) {
        context.theme(theme!);
      },
    });
    await host.start("replacement");
    return { rejected, owner: host.themes()[0]?.owner };
  });
  expect(result).toEqual({ rejected: true, owner: "replacement" });
});
