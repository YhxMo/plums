import { expect, test, type Page } from "@playwright/test";
import { addAgent, manage, installByPath, serveModule } from "./helpers";

/** Installs a model that answers only when the test calls `answer()`, and an Agent on it. */
async function slowAgent(page: Page, name: string) {
  await serveModule(
    page,
    "slow-chat",
    `export default {
  manifest: { id: "chat.slow", version: "1", apiVersion: 1, provides: { chat: 1 } },
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "慢模型",
      models: () => [{ id: "slow", label: "慢", description: "" }],
      subscribe: () => () => {},
      reply: ({ input }, signal) =>
        new Promise((done, reject) => {
          signal.throwIfAborted();
          const stop = () => reject(signal.reason);
          signal.addEventListener("abort", stop, { once: true });
          window.answer = () => {
            signal.removeEventListener("abort", stop);
            done("答：" + input);
          };
        }),
    });
  },
};`,
  );
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, "/slow-chat/");
  await page
    .getByRole("button", { name: "启用 chat.slow", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, name);
  await page.getByRole("combobox", { name: "切换模型", exact: true }).click();
  await page
    .getByRole("listbox", { name: "切换模型" })
    .getByRole("option", { name: /^慢/ })
    .click();
}

const answer = (page: Page) =>
  page.evaluate(() => (window as unknown as { answer(): void }).answer());

test("a sent message appears at once and the input clears before the reply", async ({
  page,
}) => {
  await slowAgent(page, "即时助手");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("show me now");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log.getByText("show me now", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  const chat = page.getByRole("region", { name: "即时助手 的会话" });
  await expect(chat.locator("header")).toContainText("正在输入");
  await expect(
    page.getByRole("status").filter({ hasText: "即时助手 正在输入" }),
  ).toHaveCount(1);
  await expect(log.getByRole("status")).toHaveCount(0);
  await expect(log).not.toContainText("正在输入");
  await expect(
    page.getByRole("button", { name: "停止处理", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "添加附件", exact: true }),
  ).toBeDisabled();
  await input.fill("下一条草稿");
  await input.press("Enter");
  await input.evaluate((box) => box.closest("form")!.requestSubmit());
  await expect(log).not.toContainText("下一条草稿");
  await answer(page);
  await expect(log.getByText("答：show me now", { exact: true })).toBeVisible();
  await expect(chat.locator("header")).not.toContainText("正在输入");
  // It arrived on screen, so nothing is left unread.
  await expect(
    page.getByRole("button", { name: "即时助手", exact: true }),
  ).not.toHaveAccessibleDescription(/未读/);
  await expect(log.getByText("show me now", { exact: true })).toHaveCount(1);
  await expect(input).toHaveValue("下一条草稿");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(log.getByText("下一条草稿", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "停止处理", exact: true }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "已取消，对方不会回复这条消息" }),
  ).toBeVisible();
  await expect(log.getByText("下一条草稿", { exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("下一条草稿");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
});

test("the list shows typing as a dot, and a reply that arrives elsewhere as unread until opened", async ({
  page,
}) => {
  await slowAgent(page, "慢助手");
  const list = page.getByRole("complementary", { name: "Agent 列表" });
  const row = (name: string) => list.getByRole("button", { name, exact: true });
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page
    .getByRole("dialog", { name: "添加", exact: true })
    .getByRole("button", { name: /^添加 Agent/ })
    .click();
  const add = page.getByRole("dialog", { name: "添加 Agent", exact: true });
  await add.getByRole("textbox", { name: "名称", exact: true }).fill("旁人");
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await row("慢助手").click();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("等我一下");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(row("慢助手")).toHaveAccessibleDescription(/正在输入/);
  // Said only to screen readers; the preview keeps the last message.
  await expect(list.getByText("正在输入")).toBeHidden();
  await expect(
    row("慢助手").locator('[data-slot="avatar-badge"][data-state="typing"]'),
  ).toBeVisible();

  await row("旁人").click();
  await expect(page.getByRole("region", { name: "旁人 的会话" })).toBeVisible();
  await answer(page);
  await expect(row("慢助手")).toHaveAccessibleDescription(/1 条未读$/);
  await expect(row("慢助手").getByText("1", { exact: true })).toBeVisible();
  await expect(row("慢助手")).toContainText("答：等我一下");

  await page.reload();
  await expect(row("慢助手")).toHaveAccessibleDescription(/1 条未读$/);
  await row("慢助手").click();
  await expect(page.getByRole("log")).toContainText("答：等我一下");
  await expect(row("慢助手")).not.toHaveAccessibleDescription(/未读/);
  await page.reload();
  await expect(row("慢助手")).not.toHaveAccessibleDescription(/未读/);
});
