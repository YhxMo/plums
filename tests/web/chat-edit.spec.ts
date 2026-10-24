import { expect, test, type Page } from "@playwright/test";
import { addAgent } from "./helpers";

const replies = (page: Page) =>
  page.getByRole("log").locator("p", { hasText: /^echo-a｜/ });
const own = (page: Page, text: string) =>
  page.getByRole("log").locator("p", { hasText: new RegExp(`^${text}$`) });
const input = (page: Page) =>
  page.getByRole("textbox", { name: "消息", exact: true });

async function start(page: Page, ...texts: string[]) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "改写助手");
  for (const [i, text] of texts.entries()) {
    await input(page).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(replies(page)).toHaveCount(i + 1);
  }
}
async function choose(page: Page, line: ReturnType<typeof own>, name: string) {
  await line.click({ button: "right" });
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("editing the last message sends the new text in its place, and 撤销 brings the old one back", async ({
  page,
}) => {
  await start(page, "hi");
  await input(page).fill("草稿");
  await choose(page, own(page, "hi"), "编辑");
  await expect(page.getByText("编辑消息")).toBeVisible();
  await expect(input(page)).toHaveValue("hi");
  await expect(input(page)).toBeFocused();
  await input(page).fill("hello");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(replies(page)).toHaveCount(1);
  await expect(replies(page)).toContainText("｜hello");
  await expect(own(page, "hi")).toHaveCount(0);
  await expect(page.getByText("编辑消息")).toBeHidden();
  // The draft from before editing comes back.
  await expect(input(page)).toHaveValue("草稿");
  await expect(page.getByText("已按修改重新发送")).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(own(page, "hi")).toHaveCount(1);
  // The replaced reply leaves with its exit animation.
  await expect(replies(page)).toHaveCount(1);
  await expect(replies(page)).toContainText("｜hi");
  await expect(own(page, "hello")).toHaveCount(0);
});

test("Escape leaves editing and keeps the earlier draft", async ({ page }) => {
  await start(page, "hi");
  await input(page).fill("草稿");
  await choose(page, own(page, "hi"), "编辑");
  await expect(input(page)).toHaveValue("hi");
  await page.keyboard.press("Escape");
  await expect(page.getByText("编辑消息")).toBeHidden();
  await expect(input(page)).toHaveValue("草稿");
  await choose(page, own(page, "hi"), "编辑");
  await page.getByRole("button", { name: "取消编辑", exact: true }).click();
  await expect(input(page)).toHaveValue("草稿");
});

test("editing an earlier message asks before dropping the turns after it", async ({
  page,
}) => {
  await start(page, "one", "two");
  await choose(page, own(page, "one"), "编辑");
  await input(page).fill("uno");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除后续消息" });
  await expect(dialog).toContainText("2 条");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(replies(page)).toHaveCount(2);
  await expect(input(page)).toHaveValue("uno");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await expect(replies(page)).toHaveCount(1);
  await expect(replies(page)).toContainText("｜uno");
  await expect(own(page, "two")).toHaveCount(0);
});

test("a reply is regenerated in place; an earlier one asks first", async ({
  page,
}) => {
  await start(page, "one", "two");
  await choose(page, replies(page).last(), "重新生成");
  await expect(page.getByText("已重新生成")).toBeVisible();
  await expect(replies(page)).toHaveCount(2);
  await choose(page, replies(page).first(), "重新生成");
  const dialog = page.getByRole("dialog", { name: "删除后续消息" });
  await expect(dialog).toContainText("2 条");
  await dialog.getByRole("button", { name: "继续", exact: true }).click();
  await expect(replies(page)).toHaveCount(1);
  await expect(own(page, "two")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(replies(page)).toHaveCount(2);
});
