import { expect, test, type Locator, type Page } from "@playwright/test";
import { legacyEntry } from "./helpers";

async function authorization(page: Page) {
  await page.goto("/");
  const trigger = await legacyEntry(page);
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "授权并启动扩展" });
  await expect(dialog).toBeVisible();
  return {
    trigger,
    dialog,
    first: dialog.getByRole("button", { name: "关闭", exact: true }),
    last: dialog.getByRole("button", { name: "授权并启动", exact: true }),
  };
}

// Synthetic dispatch isolates modifier recognition from OS-owned shortcuts.
async function dispatchTab(
  target: Locator,
  init: Pick<
    KeyboardEventInit,
    "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "keyCode"
  > = {},
) {
  await target.focus();
  return target.evaluate((node, init) => {
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    node.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
  test(`focus loops only consume navigation modifiers on ${platform}`, async ({
    page,
  }) => {
    await page.addInitScript((platform) => {
      Object.defineProperty(navigator, "platform", { value: platform });
    }, platform);
    const { first, last } = await authorization(page);
    expect(await dispatchTab(last)).toBe(true);
    await expect(first).toBeFocused();
    expect(await dispatchTab(first, { shiftKey: true })).toBe(true);
    await expect(last).toBeFocused();
    const mac = platform === "MacIntel";
    expect(await dispatchTab(last, { altKey: true })).toBe(mac);
    await expect(mac ? first : last).toBeFocused();
    expect(await dispatchTab(first, { altKey: true, shiftKey: true })).toBe(
      mac,
    );
    await expect(mac ? last : first).toBeFocused();
    for (const modifiers of [
      { ctrlKey: true },
      { metaKey: true },
      { ctrlKey: true, altKey: true },
      { metaKey: true, altKey: true },
    ]) {
      expect(await dispatchTab(last, modifiers)).toBe(false);
      await expect(last).toBeFocused();
    }
  });
}

test("composition-owned Tab does not wrap or select another control", async ({
  page,
}) => {
  const { last } = await authorization(page);
  for (const composing of [{ isComposing: true }, { keyCode: 229 }]) {
    for (const altKey of [false, true]) {
      expect(await dispatchTab(last, { ...composing, altKey })).toBe(false);
      await expect(last).toBeFocused();
    }
  }
});

test("a nested explanation keeps Option-Tab in its scope then restores the parent", async ({
  page,
  browserName,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "添加 Agent",
    exact: true,
  });
  await trigger.click();
  const parent = page.getByRole("dialog", { name: "添加 Agent", exact: true });
  await parent
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("键盘草稿");
  const tip = parent.getByRole("button", { name: "组成扩展说明", exact: true });
  await tip.click();
  const explanation = page.getByRole("dialog", {
    name: "组成扩展说明",
    exact: true,
  });
  await expect(explanation).toBeFocused();
  const tab =
    browserName === "webkit" && process.platform === "darwin"
      ? "Alt+Tab"
      : "Tab";
  for (const key of [tab, `Shift+${tab}`]) {
    await page.keyboard.press(key);
    await expect(explanation).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(explanation).toBeHidden();
  await expect(tip).toBeFocused();
  await expect(parent).toBeVisible();
  const first = parent.getByRole("button", { name: "关闭", exact: true });
  const last = parent.getByRole("button", { name: "添加", exact: true });
  await last.focus();
  await page.keyboard.press(tab);
  await expect(first).toBeFocused();
  await page.keyboard.press(`Shift+${tab}`);
  await expect(last).toBeFocused();
  await expect(
    parent.getByRole("textbox", { name: "名称", exact: true }),
  ).toHaveValue("键盘草稿");
  await page.keyboard.press("Escape");
  await expect(parent).toBeHidden();
  await expect(trigger).toBeFocused();
});
