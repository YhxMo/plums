import { expect, test, type Locator } from "@playwright/test";
import { manage } from "./helpers";

// WebKit does not focus buttons on click, so focus returned to an opener
// would match :focus-visible; reproduce that pointer path without focusing.
const tap = async (target: Locator) => {
  await target.dispatchEvent("pointerdown");
  await target.dispatchEvent("click");
};
const outline = (target: Locator) =>
  target.evaluate((element) => getComputedStyle(element).outlineStyle);

test("focus returned after pointer use stays quiet until the keyboard is used", async ({
  page,
}) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "应用菜单", exact: true });
  await tap(menu);
  await tap(page.getByRole("menuitem", { name: "角色卡设置", exact: true }));
  const roles = page.getByRole("dialog", { name: "角色卡设置", exact: true });
  await tap(roles.getByRole("button", { name: "关闭", exact: true }));
  await expect(roles).not.toBeVisible();
  await expect(menu).toBeFocused();
  expect(await outline(menu)).toBe("none");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(menu).toBeFocused();
  expect(await outline(menu)).toBe("solid");
});

test("the file picker shows its ring for the keyboard only", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  const pick = page.locator("label").filter({ hasText: "选择扩展文件" });
  const input = page.getByLabel("选择扩展文件");
  await pick.dispatchEvent("pointerdown");
  await input.focus();
  expect(await outline(pick)).toBe("none");
  await page.keyboard.press("Shift");
  await input.focus();
  expect(await outline(pick)).toBe("solid");
});
