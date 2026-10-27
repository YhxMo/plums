import { expect, test } from "@playwright/test";
import { addAgent, manage } from "./helpers";

for (const [width, columns] of [
  [375, 1],
  [940, 3],
  [1280, 4],
] as const) {
  test(`extensions fill the page as cards, ${columns} a row at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 680 });
    await page.goto("/");
    await manage(page);
    const cards = page
      .getByRole("list", { name: "扩展", exact: true })
      .locator("[data-extension-id]");
    await expect(cards.first()).toBeVisible();
    const tops = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top),
    );
    expect(tops.filter((top) => top === tops[0])).toHaveLength(columns);
    expect(
      await page
        .locator("#extension-manager")
        .evaluate((manager) =>
          [manager, ...manager.querySelectorAll("div, section, li")].every(
            (node) => node.scrollWidth <= node.clientWidth + 1,
          ),
        ),
    ).toBe(true);
  });
}

test("a card opens its details over the page and gives focus back on close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await manage(page);
  const title = page
    .locator('[data-extension-id="ui.agents"]')
    .getByRole("button", { name: "默认 Agent 界面", exact: true });
  await title.focus();
  await title.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "默认 Agent 界面",
    exact: true,
  });
  await expect(dialog).toContainText(
    "提供 Agent 列表、对话和详情界面，支持切换会话、选择模型与发送附件。",
  );
  await expect(dialog.locator("code")).toHaveText("ui.agents");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(title).toBeFocused();
  // Pressing anywhere on the card opens it too, but its switch only switches.
  const card = page.locator('[data-extension-id="agents.local"]');
  await card.getByRole("switch").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(card.getByRole("switch")).not.toBeChecked();
  await card.getByRole("switch").click();
  await expect(card.getByRole("switch")).toBeChecked();
  await card.click({ position: { x: 20, y: 70 } });
  await expect(
    page.getByRole("dialog", { name: "Agent 核心", exact: true }),
  ).toBeVisible();
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

test("a card is its name, purpose and switch; the details hold the rest", async ({
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
  const card = manager.locator('[data-extension-id="agents.local"]');
  // A flat card: an edge (a hairline, rounded up on 1x screens), no shadow.
  expect(
    await card.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.borderTopStyle, style.boxShadow];
    }),
  ).toEqual(["solid", "none"]);
  await expect(card).toContainText(
    "管理 Agent 的角色资料、会话和消息记录，并通过所选模型生成回复。",
  );
  await expect(
    card.getByRole("switch", { name: "启用 agents.local", exact: true }),
  ).toBeChecked();
  // Running needs no word; the id, version and users wait in the details.
  await expect(card.locator("[data-slot=status]")).toHaveCount(0);
  await expect(card.locator("code")).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(1);
  await card.getByRole("button", { name: "Agent 核心", exact: true }).click();
  const detail = page.getByRole("region", { name: "所选扩展详情" });
  await expect(detail.locator("code")).toHaveText("agents.local");
  const status = detail.locator("[data-slot=status]");
  await expect(status).toHaveText("运行中");
  expect(
    await status
      .locator("[data-slot=status-dot]")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(48, 164, 108)");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await manager
    .locator('[data-extension-id="memory.local"]')
    .getByRole("button")
    .click();
  await expect(
    detail.getByRole("button", { name: "打开 记忆", exact: true }),
  ).toBeVisible();
});

test("a card says how many Agents use it and names them in one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 940, height: 640 });
  await page.goto("/");
  await addAgent(page, "写作助手");
  await addAgent(page, "一个名字很长很长很长很长的翻译助手");
  await manage(page);
  const echo = page.locator('[data-extension-id="chat.echo"]');
  const users = echo.locator("[data-slot=extension-users]");
  // The count comes first, so a cut-off list still shows it.
  await expect(users).toHaveText(
    "2 个 Agent：写作助手、一个名字很长很长很长很长的翻译助手",
  );
  expect(
    await users.evaluate((el) => [
      getComputedStyle(el).textOverflow,
      el.scrollWidth > el.clientWidth,
    ]),
  ).toEqual(["ellipsis", true]);
  // Nothing relies on the upper-case service, so its card says nothing.
  await expect(
    page.locator(
      '[data-extension-id="transform.upper"] [data-slot=extension-users]',
    ),
  ).toHaveCount(0);
});
