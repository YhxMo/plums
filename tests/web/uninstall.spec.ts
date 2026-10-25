import { expect, test, type Page } from "@playwright/test";
import { manage, installByPath } from "./helpers";
async function install(page: Page) {
  await page.goto("/");
  await manage(page, true);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, "/examples/counter/");
  await page
    .getByRole("button", { name: "启用 sample.counter", exact: true })
    .click();
}
test("cancel keeps installed extension and returns focus to removal trigger", async ({
  page,
}) => {
  await install(page);
  const button = page.getByRole("button", {
    name: "卸载 sample.counter",
    exact: true,
  });
  await button.click();
  await page
    .getByRole("dialog", { name: "卸载扩展" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(button).toBeFocused();
  await expect(
    page.getByRole("button", { name: "停用 sample.counter", exact: true }),
  ).toBeVisible();
});
test("uninstall preserves extension data and cold reload does not restore import", async ({
  page,
}) => {
  await install(page);
  const raw = JSON.stringify({
    schema: 1,
    revision: 1,
    value: { synthetic: "keep" },
  });
  await page.evaluate(
    (raw) => localStorage.setItem("plums:extension.sample.counter", raw),
    raw,
  );
  await page
    .getByRole("button", { name: "卸载 sample.counter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保留数据并卸载", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "卸载扩展" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "卸载 sample.counter", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "扩展", exact: true }),
  ).toBeFocused();
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("button", { name: "卸载 sample.counter", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("plums:extension.sample.counter"),
    ),
  ).toBe(raw);
});
test("failed removal save remains retryable and never reports success", async ({
  page,
}) => {
  await install(page);
  await page.getByLabel("注入存储写入失败").check();
  await page
    .getByRole("button", { name: "卸载 sample.counter", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "卸载扩展" });
  await dialog
    .getByRole("button", { name: "保留数据并卸载", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("卸载未完成");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用 sample.counter", exact: true }),
  ).toBeVisible();
  await page.getByLabel("注入存储写入失败").uncheck();
  await page
    .getByRole("button", { name: "卸载 sample.counter", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "保留数据并卸载", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});
