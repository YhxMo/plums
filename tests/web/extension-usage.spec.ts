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
    await card
      .getByRole("button", { name: "停用 transform.upper", exact: true })
      .click();
    await expect(detail.getByRole("listitem")).toHaveCount(0);
    await expect(card).not.toContainText("在使用");
  });
}
