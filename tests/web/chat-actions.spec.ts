import { expect, test, type Page } from "@playwright/test";

/** The echo model's replies. */
const reply = /^echo-a｜/;
async function startChat(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("助手");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("hi");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("log").locator("p", { hasText: reply }),
  ).toHaveCount(1);
}

test("desktop messages show a time, copy, edit, regenerate and delete from hover and right-click", async ({
  page,
  context,
  browserName,
}) => {
  // Playwright's WebKit has no clipboard permissions; it checks the feedback.
  const readable = browserName === "chromium";
  if (readable)
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await startChat(page, 1280);
  const log = page.getByRole("log");
  await expect(log.locator("time")).toHaveCount(1);
  const own = log.locator("p", { hasText: /^hi$/ });
  await own.hover();
  await page.getByRole("button", { name: "复制", exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  if (readable)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "hi",
    );

  await own.hover();
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toBeVisible();
  // A second turn, so one reply can go while another stays.
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("hi");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(log.locator("p", { hasText: reply })).toHaveCount(2);

  await own.first().click({ button: "right" });
  const menu = page.getByRole("menu", { name: "消息操作" });
  await expect(menu.getByRole("menuitem")).toHaveText(["复制", "编辑", "删除"]);
  await expect(menu.getByRole("menuitem", { name: "复制" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(
    page.getByRole("button", { name: "复制", exact: true }).first(),
  ).toBeFocused();

  await log.locator("p", { hasText: reply }).first().click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "复制",
    "重新生成",
    "删除",
  ]);
  await menu.getByRole("menuitem", { name: "删除" }).click();
  await expect(log.locator("p", { hasText: reply })).toHaveCount(1);
  await expect(log.locator("p", { hasText: /^hi$/ })).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "助手", exact: true }).click();
  await expect(log.locator("p", { hasText: reply })).toHaveCount(1);
  await expect(log.locator("time")).toHaveCount(1);
});

test("phones keep the chat layout without hover actions or a pointer menu", async ({
  page,
}) => {
  await startChat(page, 375);
  await expect(page.getByRole("button", { name: "复制" })).toBeHidden();
  await page
    .getByRole("log")
    .locator("p", { hasText: reply })
    .click({ button: "right" });
  await expect(page.getByRole("menu", { name: "消息操作" })).toHaveCount(0);
  const send = page.getByRole("button", { name: "发送", exact: true });
  const box = await send.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(40);
  const log = await page.getByRole("log").boundingBox();
  const mine = await page
    .getByRole("log")
    .locator("p", { hasText: /^hi$/ })
    .boundingBox();
  expect(log!.x + log!.width - (mine!.x + mine!.width)).toBeLessThan(24);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim(),
    ),
  ).toBe("#fcfcfc");
});
