import { expect, test } from "@playwright/test";
import { addAgent, shellButton } from "./helpers";

test("no button relies on a native title tooltip", async ({ page }) => {
  await page.goto("/");
  await expect(shellButton(page, "设置")).toBeVisible();
  await expect(page.locator("[title]")).toHaveCount(0);
});

for (const width of [375, 1180])
  test(`icon buttons explain themselves in a tooltip inside the window ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const theme = shellButton(page, "设置");
    const tip = page.getByRole("tooltip");
    await theme.hover();
    await expect(tip).toHaveText("设置");
    // The button sits near an edge; the tooltip stays on screen.
    const box = (await tip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await page.mouse.move(width / 2, 700);
    await theme.hover();
    await expect(tip).toBeVisible();
    // A real pointer passes through the space between; a single jump would
    // land inside the tooltip's hover grace area.
    await page.mouse.move(width / 2, 700, { steps: 10 });
    await expect(tip).toBeHidden();
    // A click acts on the button and hides the tooltip.
    await theme.hover();
    await expect(tip).toBeVisible();
    await theme.click();
    await expect(tip).toBeHidden();
  });

test("keyboard focus shows a tooltip until focus moves on", async ({
  page,
}) => {
  await page.goto("/");
  const theme = shellButton(page, "设置");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 20; i++) {
    if (await theme.evaluate((e) => e === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(theme).toBeFocused();
  // Tooltips of buttons tabbed past may still be fading out.
  await expect(page.getByRole("tooltip", { name: "设置" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("tooltip").filter({ hasText: /^设置$/ }),
  ).toHaveCount(0);
});

test("a tap acts without leaving a tooltip behind", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await page.goto("/");
  const extensions = shellButton(page, "扩展");
  await extensions.tap();
  await expect(extensions).toHaveAttribute("aria-current", "page");
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await context.close();
});

test("focus given back by a closing dialog or menu shows no tooltip", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto("/");
  await addAgent(page, "甲");
  const add = page.getByRole("button", { name: "添加", exact: true });
  await add.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /添加 Agent/ })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("乙");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(add).toBeFocused();
  const more = page.getByRole("button", { name: "更多操作" });
  await more.click();
  await page.getByRole("menuitem", { name: "置顶" }).click();
  await expect(more).toBeFocused();
  // Past the hover delay: nothing the pointer rests on opens one either.
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("an info button explains on hover, and a click keeps it open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  const info = page.getByRole("button", { name: "组成扩展说明", exact: true });
  const text = page.getByRole("dialog", { name: "组成扩展说明", exact: true });
  const away = async () => {
    const box = (await info.boundingBox())!;
    await page.mouse.move(box.x - 120, box.y + 160, { steps: 8 });
  };
  await info.hover();
  await expect(text).toBeVisible();
  // A look under the pointer leaves focus where it was.
  await expect(text).not.toBeFocused();
  await away();
  await expect(text).toBeHidden();
  // A click keeps it open past the pointer, until Escape.
  await info.click();
  await expect(text).toBeFocused();
  await away();
  await page.waitForTimeout(300);
  await expect(text).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(text).toBeHidden();
  await expect(info).toBeFocused();
});
