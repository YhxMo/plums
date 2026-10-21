import { addAgent, manage } from "./helpers";
import { expect, test } from "@playwright/test";

const echo = "回显模型（开发）";
for (const width of [375, 1280]) {
  test(`Agent details link to the extensions they use, which list the Agent, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    await addAgent(page, "写作助手");
    await page
      .getByRole("button", { name: "展开或收起右侧栏", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "查看扩展 Agent 核心" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: `查看扩展 ${echo}`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "扩展与状态" }),
    ).toBeVisible();
    const card = page.locator('article[data-extension-id="chat.echo"]');
    await expect(
      card.getByRole("button", { name: echo, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("1 个 Agent 在使用");
    const detail = page.getByRole("region", { name: "所选扩展详情" });
    await expect(detail).toBeInViewport();
    await expect(detail).toContainText("chat.echo");
    const on = detail.getByRole("button", {
      name: `在 写作助手 中使用 ${echo}`,
      exact: true,
    });
    await expect(on).toHaveAttribute("aria-pressed", "true");
    // Switched off for the Agent without stopping the extension...
    await on.click();
    await expect(on).toHaveAttribute("aria-pressed", "false");
    await expect(card).not.toContainText("在使用");
    await expect(card).toContainText("运行中");
    // ...and back on again.
    await on.click();
    await expect(card).toContainText("1 个 Agent 在使用");
    // Stopping an extension in use asks first and names who uses it.
    await card
      .getByRole("button", { name: "停用 chat.echo", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: `停用 ${echo}` });
    await expect(confirm).toContainText("「写作助手」正在使用此扩展");
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(card).toContainText("运行中");
    await card
      .getByRole("button", { name: "停用 chat.echo", exact: true })
      .click();
    await confirm.getByRole("button", { name: "停用", exact: true }).click();
    // A stopped model keeps the Agent's choice, so the card still says who
    // relies on it, and the Agent resumes once it is started again.
    await expect(card).toContainText("已停用");
    await expect(card).toContainText("1 个 Agent 在使用");
    await card
      .getByRole("button", { name: "启用 chat.echo", exact: true })
      .click();
    await expect(card).toContainText("运行中");
  });
}

test("replies come from the Agent's model, which its details can switch off", async ({
  page,
}) => {
  await page.goto("/");
  await addAgent(page, "测试");
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  };
  await send("abc");
  await expect(page.getByRole("log")).toContainText("echo-a｜第 1 轮");
  await page
    .getByRole("button", { name: "展开或收起右侧栏", exact: true })
    .click();
  const details = page.getByRole("complementary", { name: "Agent 详情" });
  const model = details.getByRole("switch", { name: `在 测试 中使用 ${echo}` });
  await expect(model).toBeChecked();
  await model.click();
  await expect(details).toContainText("已关闭：它不会回复");
  await expect(page.getByRole("textbox", { name: "消息" })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: `已关闭「${echo}」` }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开启", exact: true }).click();
  await expect(model).toBeChecked();
  await send("xyz");
  await expect(page.getByRole("log")).toContainText("echo-a｜第 2 轮");
});

test("each Agent picks its own model and the model receives the conversation so far", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "停用 chat.echo", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, "甲");
  await expect(page.getByRole("status")).toContainText(
    "先连接一个 AI 模型，它才能理解和回复你。",
  );
  // The browser preview cannot hold keys, so the connector page is unavailable.
  await page.getByRole("button", { name: "连接模型", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "模型连接" });
  await dialog.getByRole("button", { name: "查看扩展", exact: true }).click();
  await page
    .getByRole("button", { name: "启用 chat.echo", exact: true })
    .click();
  // Management opened from the connections page returns there.
  await page.getByRole("button", { name: "返回模型连接", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "为 甲 选一个模型，它就能回复你。",
  );
  const picker = page.getByRole("combobox", {
    name: "甲 使用的模型",
    exact: true,
  });
  await picker.click();
  const choices = page.getByRole("listbox", { name: "甲 使用的模型" });
  // Models are grouped under the provider that offers them.
  await expect(choices.getByRole("group", { name: /回显模型/ })).toBeVisible();
  await choices.getByRole("option", { name: /^回显 B/ }).click();
  await expect(choices).toBeHidden();
  // Once picked, the same choice moves to the composer.
  await expect(
    page.getByRole("combobox", { name: "切换模型", exact: true }),
  ).toHaveText(/回显 B/);
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  };
  await send("我是 nanan");
  await send("我是谁？");
  await expect(page.getByRole("log")).toContainText(
    "echo-b｜第 2 轮｜说明：简洁、友好地回答用户的问题。｜最早：我是 nanan｜我是谁？",
  );
  // A new Agent starts on the first model, apart from 甲's choice.
  await page.getByRole("button", { name: "添加", exact: true }).first().click();
  await page
    .getByRole("dialog", { name: "添加", exact: true })
    .getByRole("button", { name: /^添加 Agent/ })
    .click();
  const add = page.getByRole("dialog", { name: "添加 Agent", exact: true });
  await add.getByRole("textbox", { name: "名称", exact: true }).fill("乙");
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await send("你好");
  await expect(page.getByRole("log")).toContainText("echo-a｜第 1 轮");
  // The composer switches the same per-Agent model without opening details.
  const composer = page.getByRole("combobox", {
    name: "切换模型",
    exact: true,
  });
  await expect(composer).toHaveText(/回显 A/);
  await composer.click();
  await page
    .getByRole("listbox", { name: "切换模型" })
    .getByRole("option", { name: /^回显 B/ })
    .click();
  await expect(composer).toHaveText(/回显 B/);
  await send("再来");
  await expect(page.getByRole("log")).toContainText("echo-b｜第 2 轮");
});
