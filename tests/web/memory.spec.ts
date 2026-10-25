import { expect, test, type Page } from "@playwright/test";
import {
  addAgent,
  installByPath,
  manage,
  serveModule,
  openAddAgent,
} from "./helpers";

const memoryPage = (page: Page) =>
  page.getByRole("dialog", { name: "记忆", exact: true });
const details = (page: Page) =>
  page.getByRole("button", { name: "展开或收起右侧栏", exact: true });
async function send(page: Page, text: string) {
  const replies = page.getByRole("log").getByText(/^echo-a｜/);
  const before = await replies.count();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(replies).toHaveCount(before + 1);
}
/** Adds another Agent through the add menu. */
async function addAnother(page: Page, name: string) {
  await openAddAgent(page);
  const add = page.getByRole("dialog", { name: "添加 Agent", exact: true });
  await add.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  await add.getByRole("button", { name: "添加", exact: true }).click();
}
/** The echo model prints what it was told, so the last reply shows the prompt. */
const lastReply = (page: Page) =>
  page
    .getByRole("log")
    .getByText(/^echo-a｜/)
    .last();

test("the avatar opens what every Agent knows about you, and each Agent reads it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "甲");
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "记忆", exact: true })
    .click();
  const dialog = memoryPage(page);
  await expect(
    dialog.getByRole("combobox", { name: "查看谁的记忆" }),
  ).toHaveText(/关于我/);
  await dialog.getByRole("textbox", { name: "新的记忆" }).fill("我叫小叶");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "关于我" })).toContainText(
    "我叫小叶",
  );
  await page.keyboard.press("Escape");
  await send(page, "你好");
  await expect(lastReply(page)).toContainText(
    "关于对方 对方写给所有 Agent 的资料： - 我叫小叶",
  );
  await page.reload();
  await page.getByRole("button", { name: "甲", exact: true }).click();
  await send(page, "还记得吗");
  await expect(lastReply(page)).toContainText("我叫小叶");
});

test("an Agent's memory opens from its details, reaches only it, and stops when switched off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "乙");
  await addAnother(page, "甲");
  await details(page).click();
  const drawer = page.getByRole("complementary", { name: "Agent 详情" });
  const row = drawer.getByRole("button", { name: "打开 记忆", exact: true });
  await expect(row).toContainText("还没有记下什么");
  await row.click();
  const dialog = memoryPage(page);
  await expect(
    dialog.getByRole("combobox", { name: "查看谁的记忆" }),
  ).toHaveText(/甲/);
  await dialog.getByRole("textbox", { name: "新的记忆" }).fill("对花生过敏");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  // Something that already ended is kept apart and no longer told.
  await dialog.getByRole("textbox", { name: "新的记忆" }).fill("上周的考试");
  await dialog
    .getByLabel("到期（可选，过后不再告诉 Agent）")
    .fill("2020-01-01T09:00");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  await expect(
    dialog.getByRole("list", { name: "已过期的记忆" }),
  ).toContainText("上周的考试");
  await page.keyboard.press("Escape");
  await expect(row).toContainText("记得 1 件事");
  // The avatar opens the shared page, not the Agent's last opened.
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "记忆", exact: true })
    .click();
  await expect(
    memoryPage(page).getByRole("combobox", { name: "查看谁的记忆" }),
  ).toHaveText(/关于我/);
  await page.keyboard.press("Escape");
  await send(page, "晚饭吃什么");
  await expect(lastReply(page)).toContainText("你记得的事");
  await expect(lastReply(page)).toContainText("对花生过敏");
  await expect(lastReply(page)).not.toContainText("上周的考试");
  await drawer
    .getByRole("switch", { name: "在 甲 中使用 记忆", exact: true })
    .click();
  await expect(drawer).toContainText("已关闭：它不会记得以前会话里的事");
  await send(page, "再问一次");
  await expect(lastReply(page)).not.toContainText("对花生过敏");
  await page.getByRole("button", { name: "乙", exact: true }).click();
  await expect(page.getByRole("log").getByText(/^echo-a｜/)).toHaveCount(0);
  await send(page, "你好");
  await expect(lastReply(page)).not.toContainText("花生");
});

test("a consolidation the model cannot answer says why and keeps the conversation pending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "甲");
  await send(page, "我下周三有吉他课");
  await details(page).click();
  await page
    .getByRole("complementary", { name: "Agent 详情" })
    .getByRole("button", { name: "打开 记忆", exact: true })
    .click();
  const dialog = memoryPage(page);
  await dialog.getByRole("button", { name: "现在整理", exact: true }).click();
  // The echo model answers in prose, not the JSON a consolidation needs.
  await expect(dialog.getByRole("status").first()).toContainText("JSON");
  await expect(dialog.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(dialog.getByText("还没有记下什么")).toBeVisible();
});

test("a cheaper model consolidates, says where the conversation goes, and the result can be undone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await serveModule(
    page,
    "note-chat",
    `export default {
  manifest: { id: "chat.note", version: "1", apiVersion: 1, provides: { chat: 1 } },
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "记录模型",
      models: () => [{ id: "note", label: "便宜模型", description: "" }],
      subscribe: () => () => {},
      reply: async ({ instructions }) =>
        instructions.startsWith("你负责整理")
          ? '{"add":[{"text":"对花生过敏"}],"update":[],"delete":[]}'
          : "好的",
    });
  },
};`,
  );
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, "/note-chat/");
  await page
    .getByRole("button", { name: "启用 chat.note", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, "甲");
  await send(page, "我对花生过敏");
  await details(page).click();
  await page
    .getByRole("complementary", { name: "Agent 详情" })
    .getByRole("button", { name: "打开 记忆", exact: true })
    .click();
  const dialog = memoryPage(page);
  await dialog
    .getByRole("combobox", { name: "这个 Agent 整理记忆用的模型" })
    .click();
  await page.getByRole("option", { name: /^便宜模型/ }).click();
  await expect(dialog.getByRole("note")).toContainText(
    "整理时，「甲」的对话会发送到「chat.note」",
  );
  await dialog.getByRole("button", { name: "现在整理", exact: true }).click();
  await expect(dialog.getByRole("list", { name: "甲 记得的事" })).toContainText(
    "对花生过敏",
  );
  const toast = page.getByText("「甲」记下了“对花生过敏”");
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(dialog.getByText("还没有记下什么")).toBeVisible();
});
