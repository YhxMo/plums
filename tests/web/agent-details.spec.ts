import { expect, test } from "@playwright/test";
import { addAgent } from "./helpers";

test("details show who the Agent is without a title, explain 设定 on hover and lead into memory", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "写作助手", { description: "帮你改稿。" });
  await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
  const details = page.getByRole("complementary", { name: "Agent 详情" });
  await expect(
    details.getByRole("heading", { name: "写作助手" }),
  ).toBeVisible();
  // The drawer names itself to assistive technology only.
  await expect(details.getByText("Agent 详情", { exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "设定说明", exact: true }).hover();
  await expect(
    page.getByRole("dialog", { name: "设定说明", exact: true }),
  ).toHaveText(
    "告诉模型这个 Agent 是谁、怎么说话、有哪些边界。每次对话都会发给模型，不会显示在列表里，也不会给别人看。",
  );
  // The memory row opens its own page, marked with a chevron.
  const memory = details.getByRole("button", { name: "打开 记忆" });
  await expect(memory.locator("[data-slot=part-chevron]")).toBeVisible();
  await expect(
    details.getByRole("button", { name: "扩展管理", exact: true }),
  ).toBeVisible();
});
