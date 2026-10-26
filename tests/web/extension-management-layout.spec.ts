import { expect, test } from "@playwright/test";
import { addAgent, manage } from "./helpers";

for (const width of [768, 960, 1280]) {
  test(`extension management keeps a readable list and details at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 680 });
    await page.goto("/");
    await manage(page);
    const card = page.locator('[data-extension-id="agents.local"]');
    await card.getByRole("button", { name: "Agent 核心", exact: true }).click();
    const detail = page.getByRole("region", { name: "所选扩展详情" });
    await expect(detail).toBeVisible();
    await expect(card.getByRole("region")).toHaveCount(0);
    const listBounds = (await card.boundingBox())!;
    const detailBounds = (await detail.boundingBox())!;
    expect(detailBounds.x).toBeGreaterThan(listBounds.x + listBounds.width);
    expect(listBounds.width).toBeGreaterThanOrEqual(280);
    expect(detailBounds.width).toBeGreaterThanOrEqual(320);
    expect(detailBounds.x + detailBounds.width).toBeLessThanOrEqual(width);
    expect(
      await page
        .locator("#extension-manager")
        .evaluate((manager) =>
          [manager, ...manager.querySelectorAll("div, section")].every(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ),
    ).toBe(true);
  });
}

test("built-in extensions explain their purpose and can be selected by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await manage(page);
  const detail = page.getByRole("region", { name: "所选扩展详情" });
  for (const [id, label, description] of [
    [
      "agents.local",
      "Agent 核心",
      "管理 Agent 的角色资料、会话和消息记录，并通过所选模型生成回复。",
    ],
    [
      "ui.agents",
      "默认 Agent 界面",
      "提供 Agent 列表、对话和详情界面，支持切换会话、选择模型与发送附件。",
    ],
  ]) {
    const title = page
      .locator(`[data-extension-id="${id}"]`)
      .getByRole("button", { name: label, exact: true });
    await title.focus();
    await title.press("Enter");
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute("aria-pressed", "true");
    await expect(
      detail.getByText(description, { exact: true }),
    ).toBeInViewport();
  }
});

test("narrow management keeps the selected description accessible through resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await manage(page);
  const card = page.locator('[data-extension-id="ui.agents"]');
  await card
    .getByRole("button", { name: "默认 Agent 界面", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "所选扩展详情" });
  for (const width of [767, 735, 375, 320, 960]) {
    await page.setViewportSize({ width, height: 680 });
    await expect(detail).toHaveCount(1);
    await expect(detail).toContainText("支持切换会话、选择模型与发送附件");
    if (width < 768) await expect(card.getByRole("region")).toHaveCount(1);
    else await expect(card.getByRole("region")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const paragraph = detail.locator("p").first();
    await paragraph.scrollIntoViewIfNeeded();
    await expect(paragraph).toBeInViewport();
  }
});

for (const width of [375, 960]) {
  test(`management hides the unrelated workspace sidebar control at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 680 });
    await page.goto("/");
    await addAgent(page, "上下文助手");
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("返回后继续写");
    const toggle = page.getByRole("button", {
      name: "展开或收起右侧栏",
      exact: true,
    });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await manage(page);
    await expect(toggle).toBeHidden();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(input).toHaveValue("返回后继续写");
  });
}

test("management is one list beside the details: name, purpose and a switch per row, grey for the selected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await manage(page);
  const manager = page.getByRole("complementary", { name: "扩展管理" });
  await expect(
    manager.getByRole("heading", { name: "扩展", exact: true }),
  ).toBeVisible();
  await expect(manager.getByText(/^\d+ 个$/)).toBeVisible();
  const list = manager.getByRole("list", { name: "扩展", exact: true });
  const row = list.locator('[data-extension-id="agents.local"]');
  // A row, not a card: no edge or shadow of its own.
  expect(
    await row.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.borderTopWidth, style.boxShadow];
    }),
  ).toEqual(["0px", "none"]);
  // Its purpose in one line and its switch; running needs no word, and
  // the id, version and users wait in the details.
  await expect(row).toContainText(
    "管理 Agent 的角色资料、会话和消息记录，并通过所选模型生成回复。",
  );
  await expect(
    row.getByRole("switch", { name: "启用 agents.local", exact: true }),
  ).toBeChecked();
  await expect(row.locator("[data-slot=status]")).toHaveCount(0);
  await expect(row.locator("code")).toHaveCount(0);
  await expect(row.getByRole("button")).toHaveCount(1);
  await row.getByRole("button", { name: "Agent 核心", exact: true }).click();
  await expect(row).toHaveAttribute("data-selected", "true");
  expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(240, 240, 240)",
  );
  // The details sit beside the list on the page, not in a card, and
  // carry the id, the running status and what else it offers.
  const detail = page.getByRole("region", { name: "所选扩展详情" });
  await expect(detail.locator("code")).toHaveText("agents.local");
  const status = detail.locator("[data-slot=status]");
  await expect(status).toHaveText("运行中");
  expect(
    await status
      .locator("[data-slot=status-dot]")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(48, 164, 108)");
  await list
    .locator('[data-extension-id="memory.local"]')
    .getByRole("button")
    .click();
  await expect(
    detail.getByRole("button", { name: "打开 记忆", exact: true }),
  ).toBeVisible();
  expect(
    await detail.evaluate((el) => getComputedStyle(el).borderTopWidth),
  ).toBe("0px");
});
