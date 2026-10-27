import { addAgent, manage, backToWorkspace } from "./helpers";
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
    // Management opens with that extension's details over it.
    await expect(page.getByRole("dialog", { name: echo })).toBeVisible();
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
    await expect(detail.getByRole("switch")).toBeChecked();
    // ...and back on again.
    await on.click();
    await expect(on).toHaveAttribute("aria-pressed", "true");
    // Stopping an extension in use asks first and names who uses it.
    await detail
      .getByRole("switch", { name: "启用 chat.echo", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: `停用 ${echo}` });
    await expect(confirm).toContainText("「写作助手」正在使用此扩展");
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(detail.getByRole("switch")).toBeChecked();
    await detail
      .getByRole("switch", { name: "启用 chat.echo", exact: true })
      .click();
    await confirm.getByRole("button", { name: "停用", exact: true }).click();
    // A stopped model keeps the Agent's choice, so its details still say
    // who relies on it, and the Agent resumes once it is started again.
    await expect(detail.getByRole("switch")).not.toBeChecked();
    await expect(detail).toContainText("写作助手");
    await detail
      .getByRole("switch", { name: "启用 chat.echo", exact: true })
      .click();
    await expect(detail.getByRole("switch")).toBeChecked();
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
  const draft = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(draft).toBeVisible();
  await draft.fill("停用时保留草稿");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await draft.press("Enter");
  await draft.evaluate((input) => input.closest("form")!.requestSubmit());
  await expect(page.getByRole("log")).not.toContainText("停用时保留草稿");
  await expect(
    page.getByRole("status").filter({ hasText: `已关闭「${echo}」` }),
  ).toBeVisible();
  const enable = page.getByRole("button", { name: "开启", exact: true });
  // Recovery changes readiness, but must never submit the surrounding composer.
  expect(
    await enable.evaluate((button) => (button as HTMLButtonElement).type),
  ).toBe("button");
  await enable.click();
  await expect(model).toBeChecked();
  await expect(draft).toHaveValue("停用时保留草稿");
  await expect(page.getByRole("log")).not.toContainText("停用时保留草稿");
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
    .getByRole("switch", { name: "启用 chat.echo", exact: true })
    .click();
  await backToWorkspace(page);
  await addAgent(page, "甲");
  const emptyBox = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(emptyBox).toHaveAttribute(
    "placeholder",
    "为 甲 选一个模型，它就能回复你…",
  );
  await expect(
    page.getByRole("button", { name: "添加附件", exact: true }),
  ).toBeVisible();
  await emptyBox.fill("先写好");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await emptyBox.press("Enter");
  await emptyBox.evaluate((input) => input.closest("form")!.requestSubmit());
  await expect(page.getByRole("log")).not.toContainText("先写好");
  // The browser preview cannot run the built-in connector, so no running
  // connector has a page to add models on: connecting leads to the extensions.
  await page.getByRole("button", { name: "切换模型", exact: true }).click();
  await page.getByRole("menuitem", { name: "连接模型", exact: true }).click();
  await page
    .getByRole("switch", { name: "启用 chat.echo", exact: true })
    .click();
  await backToWorkspace(page);
  // Nothing picked: the same message box shows, with the picker saying so.
  const box = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(box).toHaveValue("先写好");
  await expect(box).toHaveAttribute(
    "placeholder",
    "为 甲 选一个模型，它就能回复你…",
  );
  const picker = page.getByRole("combobox", { name: "切换模型", exact: true });
  await expect(picker).toHaveText("未选择模型");
  await box.fill("先写好");
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await box.press("Enter");
  await expect(page.getByRole("log").getByText("先写好")).toHaveCount(0);
  await picker.click();
  const choices = page.getByRole("listbox", { name: "切换模型" });
  // Models are grouped under the provider that offers them.
  await expect(choices.getByRole("group", { name: /回显模型/ })).toBeVisible();
  await choices.getByRole("option", { name: /^回显 B/ }).click();
  await expect(choices).toBeHidden();
  await expect(picker).toHaveText(/回显 B/);
  await box.fill("");
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  };
  await send("我是 nanan");
  await send("我是谁？");
  await expect(page.getByRole("log")).toContainText(
    /echo-b｜第 2 轮｜说明：你是「甲」。今天是 .* 简洁、友好地回答用户的问题。｜最早：我是 nanan｜我是谁？/,
  );
  // A new Agent starts on the first model, apart from 甲's choice.
  await addAgent(page, "乙");
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

for (const width of [375, 700]) {
  test(`an empty model catalog keeps the composer and its draft at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    await manage(page);
    await page
      .getByRole("switch", { name: "启用 chat.echo", exact: true })
      .click();
    await backToWorkspace(page);
    await addAgent(page, "未接入");
    const box = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute(
      "placeholder",
      "为 未接入 选一个模型，它就能回复你…",
    );
    await expect(
      page.getByRole("button", { name: "添加附件", exact: true }),
    ).toBeVisible();
    const picker = page.getByRole("button", { name: "切换模型", exact: true });
    await expect(picker).toHaveText("未选择模型");
    await box.fill("尚未连接也能准备草稿");
    await expect(
      page.getByRole("button", { name: "发送", exact: true }),
    ).toBeDisabled();
    await box.press("Enter");
    await expect(box).toHaveValue("尚未连接也能准备草稿");
    await picker.click();
    await page.getByRole("menuitem", { name: "连接模型", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "扩展", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "返回工作区", exact: true })
      .filter({ visible: true })
      .click();
    await expect(box).toHaveValue("尚未连接也能准备草稿");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}
