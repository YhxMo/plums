import { expect, test } from "@playwright/test";
import { manage } from "./helpers";

test("a sent message appears at once and the input clears before the reply", async ({
  page,
}) => {
  // A model that answers only when the test says so.
  await page.route("**/slow-chat.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export default {
  manifest: { id: "chat.slow", version: "1", apiVersion: 1, provides: { chat: 1 } },
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "慢模型",
      models: () => [{ id: "slow", label: "慢", description: "" }],
      subscribe: () => () => {},
      reply: ({ input }) =>
        new Promise((done) => { window.answer = () => done("答：" + input); }),
    });
  },
};`,
    }),
  );
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await page.getByLabel("扩展 ID", { exact: true }).fill("chat.slow");
  await page.getByLabel("模块路径", { exact: true }).fill("/slow-chat.js");
  await page.getByRole("button", { name: "加载模块", exact: true }).click();
  await page
    .getByRole("button", { name: "启用 chat.slow", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("即时助手");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await page.getByRole("combobox", { name: "切换模型", exact: true }).click();
  await page
    .getByRole("listbox", { name: "切换模型" })
    .getByRole("option", { name: /^慢/ })
    .click();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("show me now");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log.getByText("show me now", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(log.getByRole("status")).toBeVisible();
  await page.evaluate(() => (window as unknown as { answer(): void }).answer());
  await expect(log.getByText("答：show me now", { exact: true })).toBeVisible();
  await expect(log.getByRole("status")).toHaveCount(0);
  await expect(log.getByText("show me now", { exact: true })).toHaveCount(1);
});
