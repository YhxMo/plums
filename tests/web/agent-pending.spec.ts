import { expect, test } from "@playwright/test";
import { answer, manage, slowAgent, openAddAgent } from "./helpers";

for (const width of [375, 1280])
  test(`a reply hidden by extension management stays unread until returning (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await slowAgent(page, "隐藏的会话");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("等我回来");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await input.fill("保留草稿");
    await manage(page);
    await expect(page.locator("[data-workspace]")).toBeHidden();
    await answer(page);
    const unread = () =>
      page.evaluate(() => {
        const owner = "plums:extension.agents.local";
        const index = JSON.parse(localStorage.getItem(owner)!).value;
        const session = index.agents[0].sessions[0];
        const { records } = JSON.parse(
          localStorage.getItem(`${owner}#records`)!,
        );
        return records.filter(
          (record: {
            collection: string;
            value: { role: string; at: number };
          }) =>
            record.collection === `session:${session.id}` &&
            record.value.role === "agent" &&
            record.value.at > session.lastReadAt,
        ).length;
      });
    await expect.poll(unread).toBe(1);
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("答：等我回来");
    await expect(input).toHaveValue("保留草稿");
    await expect.poll(unread).toBe(0);
  });

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
  await openAddAgent(page);
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

test("while one session waits, the others and the dialogs stay usable", async ({
  page,
}) => {
  await slowAgent(page, "慢助手");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("先问这个");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const chip = page.getByRole("button", { name: /^会话：/ });
  await chip.click();
  await expect(
    page.getByRole("menuitem", { name: "删除此会话", exact: true }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: "新建会话", exact: true }).click();
  const chat = page.getByRole("region", { name: "慢助手 的会话" });
  await expect(chat.locator("header")).not.toContainText("正在输入");
  // Sending waits for the other reply, and says where it is.
  await input.fill("再问那个");
  await expect(chat).toContainText(
    "正在等「未命名会话」里的回复，回复后才能再发一条。",
  );
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "停止处理", exact: true }),
  ).toHaveCount(0);
  // Adding an Agent does not wait for the reply.
  await openAddAgent(page);
  const add = page.getByRole("dialog", { name: "添加 Agent", exact: true });
  await add.getByRole("textbox", { name: "名称", exact: true }).fill("旁人");
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await expect(add).toBeHidden();
  await page
    .getByRole("complementary", { name: "Agent 列表" })
    .getByRole("button", { name: "慢助手", exact: true })
    .click();
  await chat.getByRole("button", { name: "查看", exact: true }).click();
  await expect(chat.locator("header")).toContainText("正在输入");
  await answer(page);
  await expect(page.getByRole("log")).toContainText("答：先问这个");
  // The previous Agent's header may still be fading out.
  await expect(
    page.getByRole("button", { name: "会话：先问这个", exact: true }),
  ).toBeVisible();
});
