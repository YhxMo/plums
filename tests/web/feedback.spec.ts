import { expect, test } from "@playwright/test";
import { shellButton } from "./helpers";

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
