import { addAgent, manage } from "./helpers";
import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`Agent details link to the extensions they use, which list the Agent, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    await addAgent(page, "写作助手");
    await page
      .getByRole("button", {
        name: width < 768 ? "查看 Agent 详情" : "展开或收起右侧栏",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "查看扩展 本地 Agent 提供者" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "查看扩展 大写转换服务", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "扩展与状态" }),
    ).toBeVisible();
    const card = page.locator('article[data-extension-id="transform.upper"]');
    await expect(
      card.getByRole("button", { name: "大写转换服务", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("1 个 Agent 在使用");
    const detail = page.getByRole("region", { name: "所选扩展详情" });
    await expect(detail).toBeInViewport();
    await expect(detail).toContainText("transform.upper");
    const on = (agent: string, extension: string) =>
      detail.getByRole("button", {
        name: `在 ${agent} 中使用 ${extension}`,
        exact: true,
      });
    await expect(on("写作助手", "大写转换服务")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Another text service can be switched on for the Agent as well.
    const reverse = page.locator(
      'article[data-extension-id="transform.reverse"]',
    );
    await reverse
      .getByRole("button", { name: "启用 transform.reverse", exact: true })
      .click();
    await reverse
      .getByRole("button", { name: "逆序转换服务", exact: true })
      .click();
    await expect(on("写作助手", "逆序转换服务")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await on("写作助手", "逆序转换服务").click();
    await expect(on("写作助手", "逆序转换服务")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(reverse).toContainText("1 个 Agent 在使用");
    await expect(card).toContainText("1 个 Agent 在使用");
    // ...and switched off for it without stopping the extension.
    await card
      .getByRole("button", { name: "大写转换服务", exact: true })
      .click();
    await on("写作助手", "大写转换服务").click();
    await expect(card).not.toContainText("在使用");
    await expect(card).toContainText("运行中");
    // Stopping an extension in use asks first and names who uses it.
    await reverse
      .getByRole("button", { name: "停用 transform.reverse", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "停用 逆序转换服务" });
    await expect(confirm).toContainText("「写作助手」正在使用此扩展");
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(reverse).toContainText("运行中");
    await reverse
      .getByRole("button", { name: "停用 transform.reverse", exact: true })
      .click();
    await confirm.getByRole("button", { name: "停用", exact: true }).click();
    await expect(reverse).not.toContainText("在使用");
    // A stopped extension keeps the Agent's switch and resumes with it.
    await reverse
      .getByRole("button", { name: "启用 transform.reverse", exact: true })
      .click();
    await expect(reverse).toContainText("1 个 Agent 在使用");
  });
}

test("an Agent's details switch each text extension on or off", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "启用 transform.reverse", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, "测试");
  await page
    .getByRole("button", { name: "展开或收起右侧栏", exact: true })
    .click();
  const details = page.getByRole("complementary", { name: "Agent 详情" });
  const upper = details.getByRole("switch", {
    name: "在 测试 中使用 大写转换服务",
  });
  const reverse = details.getByRole("switch", {
    name: "在 测试 中使用 逆序转换服务",
  });
  await expect(upper).toBeChecked();
  await expect(reverse).not.toBeChecked();
  await reverse.click();
  await expect(reverse).toBeChecked();
  await expect(details).toContainText(
    "回复依次经过：大写转换服务 → 逆序转换服务",
  );
  const send = async (text: string) => {
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
  };
  await send("abc");
  await expect(page.getByRole("log")).toContainText("CBA");
  await upper.click();
  await send("xyz");
  await expect(page.getByRole("log")).toContainText("zyx");
  await reverse.click();
  await expect(details).toContainText("此 Agent 暂时无法回复");
});

test("each Agent picks its own model and the model receives the conversation so far", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "停用 transform.upper", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, "甲");
  const toggleDetails = page.getByRole("button", {
    name: "展开或收起右侧栏",
    exact: true,
  });
  await toggleDetails.click();
  await expect(
    page.getByText("还没有可选的模型：添加服务商和它的模型后即可选择。"),
  ).toBeVisible();
  // The browser preview cannot hold keys, so the connector page is unavailable.
  await page.getByRole("button", { name: "添加模型连接", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "模型连接" });
  await dialog.getByRole("button", { name: "查看扩展", exact: true }).click();
  await page
    .getByRole("button", { name: "启用 chat.echo", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await toggleDetails.click();
  await page
    .getByRole("combobox", { name: "甲 使用的模型", exact: true })
    .selectOption({ label: "回显 B" });
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
});
