import { expect, test, type Page } from "@playwright/test";
import { addAgent, answer, slowAgent } from "./helpers";

const replies = (page: Page) =>
  page.getByRole("log").locator("p", { hasText: /^echo-a｜/ });
const own = (page: Page, text: string) =>
  page.getByRole("log").locator("p", { hasText: new RegExp(`^${text}`) });

/** A conversation long enough to scroll, read from its top. */
async function scrolledUp(page: Page) {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  await addAgent(page, "跟随助手");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  for (let i = 1; i <= 4; i++) {
    await input.fill(`第${i}条\n${"很长的一段话\n".repeat(6)}`);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(replies(page)).toHaveCount(i);
  }
  await page
    .getByRole("log")
    .evaluate((log) => log.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => atEnd(page)).toBe(false);
}
const atEnd = (page: Page) =>
  page.getByRole("log").evaluate(
    // Within a pixel: WebKit scrolls in fractions on a 2x screen.
    (log) => log.scrollHeight - log.scrollTop - log.clientHeight <= 1,
  );
async function choose(page: Page, line: ReturnType<typeof own>, name: string) {
  await line.click({ button: "right" });
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("regenerating an earlier reply goes to the newest message", async ({
  page,
}) => {
  await scrolledUp(page);
  await choose(page, replies(page).first(), "重新生成");
  await page
    .getByRole("dialog", { name: "删除后续消息" })
    .getByRole("button", { name: "继续", exact: true })
    .click();
  await expect(page.getByText("已重新生成")).toBeVisible();
  await expect.poll(() => atEnd(page)).toBe(true);
});

test("sending an edit of an earlier message goes to the newest message", async ({
  page,
}) => {
  await scrolledUp(page);
  await choose(page, own(page, "第1条"), "编辑");
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("改过");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除后续消息" })
    .getByRole("button", { name: "继续", exact: true })
    .click();
  await expect(page.getByText("已按修改重新发送")).toBeVisible();
  await expect.poll(() => atEnd(page)).toBe(true);
  // Undoing the edit brings the old turns back and goes to their end too.
  await page
    .getByRole("log")
    .evaluate((log) => log.scrollTo({ top: 0, behavior: "instant" }));
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(replies(page)).toHaveCount(4);
  await expect.poll(() => atEnd(page)).toBe(true);
});

test("undoing the deletion of an earlier message goes to the newest message", async ({
  page,
}) => {
  await scrolledUp(page);
  await choose(page, own(page, "第1条"), "删除");
  await expect(page.getByText("已删除消息")).toBeVisible();
  await page
    .getByRole("log")
    .evaluate((log) => log.scrollTo({ top: 0, behavior: "instant" }));
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(own(page, "第1条")).toHaveCount(1);
  await expect.poll(() => atEnd(page)).toBe(true);
});

test.describe("on a 2x screen", () => {
  test.use({ deviceScaleFactor: 2 });
  test("a sent message reaches the end at once and stays there while waiting", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 940, height: 640 });
    await slowAgent(page, "慢助手");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    for (let i = 1; i <= 3; i++) {
      await input.fill(`第${i}条\n${"很长的一段话\n".repeat(8)}`);
      await page.keyboard.press("Enter");
      await expect.poll(() => atEnd(page), { timeout: 800 }).toBe(true);
      await page.waitForTimeout(600);
      expect(await atEnd(page)).toBe(true);
      await answer(page);
      await expect(page.getByRole("log")).toContainText(`答：第${i}条`);
      await expect.poll(() => atEnd(page), { timeout: 800 }).toBe(true);
    }
  });
});
