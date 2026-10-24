import { expect, test, type Page } from "@playwright/test";
import { addAgent } from "./helpers";

const reply = /^echo-a｜/;
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(`｜${text}`);
}

test("a deleted message comes back with 撤销 in the notice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "撤销助手");
  await send(page, "hi");
  const log = page.getByRole("log");
  await log.locator("p", { hasText: reply }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除" }).click();
  await expect(log.locator("p", { hasText: reply })).toHaveCount(0);
  await expect(page.getByText("已删除消息")).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(log.locator("p", { hasText: reply })).toHaveCount(1);
  await expect(page.getByText("已恢复")).toBeVisible();
  // Restored for good: it is saved, not only shown.
  await page.reload();
  await page.getByRole("button", { name: "撤销助手", exact: true }).click();
  await expect(
    page.getByRole("log").locator("p", { hasText: reply }),
  ).toHaveCount(1);
});

test("a deleted session comes back, opened, with 撤销 in the notice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "撤销助手");
  await send(page, "留下");
  const chip = page.getByRole("button", { name: /^会话：/ });
  await chip.click();
  await page.getByRole("menuitem", { name: "删除此会话" }).click();
  const dialog = page.getByRole("dialog", { name: "删除会话" });
  await expect(dialog).toContainText("删除后可以在提示中撤销");
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(chip).toHaveAccessibleName("会话：未命名会话");
  await expect(page.getByText("已删除会话")).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(chip).toHaveAccessibleName("会话：留下");
  await expect(page.getByRole("log")).toContainText("｜留下");
  await chip.click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(1);
});
