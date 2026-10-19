import { manage } from "./helpers";
import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`Agent details link to the extensions they use, which list the Agent, at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 860 });
    await page.goto("/");
    await page
      .getByRole("button", { name: "从头添加 Agent", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("写作助手");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加", exact: true })
      .click();
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
      card.getByRole("button", { name: "大写转换服务" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("1 个 Agent 在使用");
    const detail = page.getByRole("region", { name: "所选扩展详情" });
    await expect(detail).toBeInViewport();
    await expect(detail).toContainText("transform.upper");
    await expect(
      detail.getByRole("listitem").filter({ hasText: "写作助手" }),
    ).toBeVisible();
    // A second text service can take the Agent over from its own details.
    const reverse = page.locator(
      'article[data-extension-id="transform.reverse"]',
    );
    await reverse
      .getByRole("button", { name: "启用 transform.reverse", exact: true })
      .click();
    await reverse
      .getByRole("button", { name: "逆序转换服务", exact: true })
      .click();
    await detail
      .getByRole("button", { name: "让 写作助手 改用 逆序转换服务" })
      .click();
    await expect(reverse).toContainText("1 个 Agent 在使用");
    await expect(card).not.toContainText("在使用");
    // Stopping it asks first and says where the Agent goes.
    await reverse
      .getByRole("button", { name: "停用 transform.reverse", exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "停用 逆序转换服务" });
    await expect(confirm).toContainText("写作助手」将改用「大写转换服务」");
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(reverse).toContainText("运行中");
    await reverse
      .getByRole("button", { name: "停用 transform.reverse", exact: true })
      .click();
    await confirm.getByRole("button", { name: "停用", exact: true }).click();
    await expect(card).toContainText("1 个 Agent 在使用");
    await card
      .getByRole("button", { name: "停用 transform.upper", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "停用 大写转换服务" }),
    ).toContainText("将暂时无法使用");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "停用", exact: true })
      .click();
    await expect(card).not.toContainText("在使用");
  });
}

test("an Agent's details choose which text service replies", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "启用 transform.reverse", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("测试");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await page
    .getByRole("button", { name: "展开或收起右侧栏", exact: true })
    .click();
  const sources = page.getByRole("radiogroup", { name: "回复来源" });
  await expect(
    sources.getByRole("radio", { name: "大写转换服务" }),
  ).toBeChecked();
  await sources.getByRole("radio", { name: "逆序转换服务" }).click();
  await expect(
    sources.getByRole("radio", { name: "逆序转换服务" }),
  ).toBeChecked();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("abc");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("cba");
});
