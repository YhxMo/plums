import { expect, test } from "@playwright/test";
import {
  addAgent,
  connectorWithPage,
  installConnector,
  nextStep,
  openAddAgent,
} from "./helpers";

test("adding an Agent takes two steps: who it is, then its model and extensions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const describe = await openAddAgent(page);
  // Step one only describes the Agent; explanations wait behind ⓘ.
  await expect(
    describe.getByRole("textbox", { name: "名称", exact: true }),
  ).toBeVisible();
  await expect(
    describe.getByRole("textbox", { name: "设定", exact: true }),
  ).toHaveValue("简洁、友好地回答用户的问题。");
  await expect(
    describe.getByRole("button", { name: "设定说明", exact: true }),
  ).toBeVisible();
  await describe.getByRole("button", { name: "介绍说明", exact: true }).hover();
  await expect(
    page.getByRole("dialog", { name: "介绍说明", exact: true }),
  ).toHaveText(
    "给人看的简短说明，显示在 Agent 列表和详情里，不会发给模型。可以不填。",
  );
  await expect(describe.getByRole("switch")).toHaveCount(0);
  await expect(describe.getByRole("combobox")).toHaveCount(0);
  const next = describe.getByRole("button", { name: "下一步", exact: true });
  await expect(next).toBeDisabled();
  await describe
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("写作助手");
  await describe
    .getByRole("textbox", { name: "介绍", exact: true })
    .fill("帮你改稿。");
  await next.click();
  // Step two: the model and every installed part, preset on.
  const compose = page.getByRole("dialog", {
    name: "写作助手的扩展",
    exact: true,
  });
  await expect(
    compose.getByRole("combobox", { name: "新 Agent 使用的模型" }),
  ).toBeVisible();
  const parts = compose.getByRole("list", { name: "写作助手 的组成扩展" });
  await expect(parts.getByRole("switch").first()).toBeChecked();
  const core = compose.getByRole("switch", {
    name: "在 写作助手 中使用 Agent 核心",
  });
  await core.click();
  await expect(core).not.toBeChecked();
  // Back keeps what was written and switched.
  await compose.getByRole("button", { name: "上一步", exact: true }).click();
  await expect(
    describe.getByRole("textbox", { name: "介绍", exact: true }),
  ).toHaveValue("帮你改稿。");
  await next.click();
  await expect(core).not.toBeChecked();
  await core.click();
  await compose.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "写作助手 的会话", exact: true }),
  ).toBeVisible();
});

test("a long single-line role card stays inside the import dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入角色卡", exact: true }).click();
  const raw = page.getByRole("textbox", { name: "内容", exact: true });
  // Latin text has no break opportunities; CJK text would wrap anyway.
  await raw.fill(
    JSON.stringify({ name: "长卡", description: "a".repeat(300) }),
  );
  const dialog = page.getByRole("dialog");
  // Nothing but a one-line input scrolls sideways; the text wraps in its box.
  const widths = await dialog.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .filter((e) => e.tagName !== "INPUT")
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => e.getAttribute("data-slot") ?? e.tagName),
  );
  expect(widths).toEqual([]);
  const box = (await dialog.boundingBox())!;
  const field = (await raw.boundingBox())!;
  expect(field.x).toBeGreaterThanOrEqual(box.x);
  expect(field.x + field.width).toBeLessThanOrEqual(box.x + box.width);
});

test("closing a connector's page opened from adding an Agent returns to that step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectorWithPage(page, "chat.paged", "另一家的连接");
  await page.goto("/");
  await installConnector(page, "chat.paged");
  const describe = await openAddAgent(page);
  await describe
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("写作助手");
  const compose = await nextStep(page, "写作助手");
  await compose
    .getByRole("switch", { name: "在 写作助手 中使用 Agent 核心" })
    .click();
  await compose.getByRole("button", { name: /模型连接$/ }).click();
  const connections = page.getByRole("dialog", {
    name: "另一家的连接",
    exact: true,
  });
  await expect(connections).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(connections).toBeHidden();
  await expect(
    compose.getByRole("button", { name: /模型连接$/ }),
  ).toBeFocused();
  await compose.getByRole("button", { name: /模型连接$/ }).click();
  await connections.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(connections).toBeHidden();
  // The step comes back as it was left, not the bare list behind it.
  await expect(compose).toBeVisible();
  await expect(
    compose.getByRole("switch", { name: "在 写作助手 中使用 Agent 核心" }),
  ).not.toBeChecked();
});

test("after adding an Agent focus rests on the workspace, not on the add button or the input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "甲");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addAgent(page, "乙");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-slot="agent-workspace"]')).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("removing an Agent leaves focus on the workspace too", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "甲");
  await addAgent(page, "乙");
  await page
    .getByRole("complementary", { name: "Agent 列表" })
    .getByRole("button", { name: "乙", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "移除 Agent", exact: true }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-slot="agent-workspace"]')).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});
