import { expect, test, type Page } from "@playwright/test";
import { addAgent } from "./helpers";

const chip = (page: Page) => page.getByRole("button", { name: /^会话：/ });

test("a session is renamed from its menu and keeps the name", async ({
  page,
}) => {
  await page.goto("/");
  await addAgent(page, "整理者");
  await chip(page).click();
  await page.getByRole("menuitem", { name: "重命名会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "重命名会话", exact: true });
  const name = dialog.getByRole("textbox", { name: "名称", exact: true });
  await expect(name).toHaveValue("未命名会话");
  await name.fill("  周报  ");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(chip(page)).toBeFocused();
  await expect(chip(page)).toHaveAccessibleName("会话：周报");
  // The first message no longer names it.
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("开始");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("echo-a｜第 1 轮");
  await page.reload();
  await page.getByRole("button", { name: "整理者", exact: true }).click();
  await expect(chip(page)).toHaveAccessibleName("会话：周报");
});

test("more than eight sessions get a filter that takes the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await addAgent(page, "多会话");
  const menuItem = (name: string) =>
    page.getByRole("menuitem", { name, exact: true });
  await chip(page).click();
  await expect(page.getByRole("textbox", { name: "筛选会话" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (let i = 0; i < 8; i++) {
    await chip(page).click();
    await menuItem("新建会话").click();
  }
  await chip(page).click();
  await menuItem("重命名会话").click();
  const dialog = page.getByRole("dialog", { name: "重命名会话", exact: true });
  await dialog
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("旅行计划");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  // Opening the menu puts the cursor in the filter; letters stay there.
  await chip(page).click();
  const filter = page.getByRole("textbox", { name: "筛选会话" });
  await expect(filter).toBeFocused();
  await page.keyboard.type("旅行");
  await expect(filter).toHaveValue("旅行");
  const sessions = page.getByRole("menuitemradio");
  await expect(sessions).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await expect(sessions.first()).toBeFocused();
  await filter.fill("没有这个");
  await expect(sessions).toHaveCount(0);
  await expect(page.getByRole("menu")).toContainText("没有找到会话");
  await filter.fill("");
  await expect(sessions).toHaveCount(9);
  await sessions.first().click();
  await expect(chip(page)).toHaveAccessibleName("会话：未命名会话");
});
