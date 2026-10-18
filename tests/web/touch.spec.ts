import { expect, test } from "@playwright/test";

test("touch taps are not held for double-tap zoom or painted with the WebView highlight", async ({
  page,
}) => {
  await page.goto("/");
  const style = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      touchAction: root.touchAction,
      highlight: root.getPropertyValue("-webkit-tap-highlight-color"),
    };
  });
  expect(style.touchAction).toBe("manipulation");
  expect(style.highlight).toBe("rgba(0, 0, 0, 0)");
});
