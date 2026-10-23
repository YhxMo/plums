import { expect, test, type Locator } from "@playwright/test";
import { manage } from "./helpers";

// Controls mark keyboard focus with a 3px ring (box-shadow), not an outline;
// it fades in, so a shown ring is polled for.
const ringed = (target: Locator) =>
  target.evaluate((element) =>
    getComputedStyle(element).boxShadow.includes(" 0px 0px 0px 3px"),
  );

// The browser's own :focus-visible decides: no ring when a click led to
// focus returning by code, a ring after keyboard navigation. WebKit, like the
// Mac app with default settings, reaches buttons with Option-Tab.
test("focus returned after a click stays quiet until the keyboard is used", async ({
  page,
  browserName,
}) => {
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.goto("/");
  const menu = page.getByRole("button", { name: "设置", exact: true });
  await menu.click();
  const settings = page.getByRole("dialog", { name: "应用设置", exact: true });
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(settings).not.toBeVisible();
  await expect(menu).toBeFocused();
  expect(await ringed(menu)).toBe(false);
  await page.keyboard.press(`Shift+${tab}`);
  await page.keyboard.press(tab);
  await expect(menu).toBeFocused();
  await expect.poll(() => ringed(menu)).toBe(true);
});

test("the file picker shows its ring for the keyboard only", async ({
  page,
  browserName,
}) => {
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  const pick = page.locator("label").filter({ hasText: "选择扩展文件" });
  const input = page.getByLabel("选择扩展文件");
  const chooser = page.waitForEvent("filechooser");
  await pick.click();
  await (await chooser).setFiles([]);
  expect(await ringed(pick)).toBe(false);
  await input.focus();
  await page.keyboard.press(`Shift+${tab}`);
  await page.keyboard.press(tab);
  await expect(input).toBeFocused();
  await expect.poll(() => ringed(pick)).toBe(true);
});
