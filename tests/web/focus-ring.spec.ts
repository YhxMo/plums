import { expect, test, type Locator } from "@playwright/test";
import { manage } from "./helpers";

// WebKit does not focus buttons on click, so focus returned to an opener
// would match :focus-visible; reproduce that pointer path without focusing.
const tap = async (target: Locator) => {
  await target.dispatchEvent("pointerdown");
  await target.dispatchEvent("click");
};
// Controls mark keyboard focus with a 3px ring (box-shadow), not an outline;
// it fades in, so a shown ring is polled for.
const ringed = (target: Locator) =>
  target.evaluate((element) =>
    getComputedStyle(element).boxShadow.includes(" 0px 0px 0px 3px"),
  );

test("focus returned after pointer use stays quiet until the keyboard is used", async ({
  page,
}) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "应用菜单", exact: true });
  await tap(menu);
  await tap(page.getByRole("menuitem", { name: "应用设置", exact: true }));
  const settings = page.getByRole("dialog", { name: "应用设置", exact: true });
  await tap(settings.getByRole("button", { name: "关闭", exact: true }));
  await expect(settings).not.toBeVisible();
  await expect(menu).toBeFocused();
  expect(await ringed(menu)).toBe(false);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(menu).toBeFocused();
  await expect.poll(() => ringed(menu)).toBe(true);
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
  expect(await ringed(pick)).toBe(false);
  await page.keyboard.press("Shift");
  await input.focus();
  await expect.poll(() => ringed(pick)).toBe(true);
});
