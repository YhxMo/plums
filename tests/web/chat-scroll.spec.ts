import { expect, test, type Locator, type Page } from "@playwright/test";
import { answer, slowAgent } from "./helpers";

/** Pixels between the bottom of the log's content and its visible end. */
const gap = (log: Locator) =>
  log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

/** Sends a long message and lets the slow model answer it. */
async function turn(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await answer(page);
  await expect(page.getByRole("log")).toContainText(`答：${text}`);
}

test("the log follows replies only from the bottom, and offers a way back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await slowAgent(page, "长谈");
  const log = page.getByRole("log");
  for (let i = 0; i < 4; i++)
    await turn(page, `第 ${i} 段 ${"内容 ".repeat(120)}`);
  await expect.poll(() => gap(log)).toBeLessThan(2);
  const back = page.getByRole("button", { name: /回到最新/ });
  await expect(back).toHaveCount(0);

  // Sending always shows the message; scrolling up while waiting stays put.
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill(`等待中 ${"内容 ".repeat(120)}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => gap(log)).toBeLessThan(2);
  await log.hover();
  await page.mouse.wheel(0, -3000);
  await expect(back).toHaveAccessibleName("回到最新");
  const away = await log.evaluate((el) => el.scrollTop);
  await answer(page);
  await expect(log).toContainText("答：等待中");
  // The reply did not pull the view down; the button says it is there.
  await expect(back).toHaveAccessibleName("新消息，回到最新");
  expect(await log.evaluate((el) => el.scrollTop)).toBe(away);

  await back.click();
  await expect.poll(() => gap(log)).toBeLessThan(2);
  await expect(back).toHaveCount(0);

  // Back at the bottom, the next reply is followed again.
  await turn(page, `再来 ${"内容 ".repeat(120)}`);
  await expect.poll(() => gap(log)).toBeLessThan(2);
});

test("scrolled up, sending a message brings the view down to it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await slowAgent(page, "长谈");
  const log = page.getByRole("log");
  for (let i = 0; i < 3; i++)
    await turn(page, `第 ${i} 段 ${"内容 ".repeat(120)}`);
  await log.hover();
  await page.mouse.wheel(0, -3000);
  await expect(page.getByRole("button", { name: "回到最新" })).toBeVisible();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("新问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => gap(log)).toBeLessThan(2);
  await expect(page.getByRole("button", { name: /回到最新/ })).toHaveCount(0);
});
