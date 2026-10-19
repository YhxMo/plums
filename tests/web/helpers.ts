import { expect, type Locator, type Page } from "@playwright/test";
export async function manage(page: Page, diagnostics = false) {
  const manager = page.getByRole("heading", { name: "扩展与状态" });
  if (!(await manager.isVisible())) {
    await page.getByRole("button", { name: "应用菜单", exact: true }).click();
    await page
      .getByRole("menuitem", {
        name: diagnostics ? "诊断工具" : "扩展管理",
        exact: true,
      })
      .click();
  }
  if (diagnostics) {
    const details = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: "诊断与实验" }) });
    if (!(await details.evaluate((e) => e.hasAttribute("open"))))
      await page.getByText("诊断与实验", { exact: true }).click();
  }
}
/** Adds an Agent from scratch through the add dialog. */
export async function addAgent(
  page: Page,
  name: string,
  { description, multi }: { description?: string; multi?: boolean } = {},
) {
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  if (description)
    await page.getByRole("textbox", { name: "角色说明" }).fill(description);
  if (multi) await page.getByLabel("允许多个会话").check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
}
export async function legacyEntry(page: Page) {
  await manage(page, true);
  return page.getByRole("button", { name: "授予实验能力并启动", exact: true });
}
export async function chooseLayout(page: Page, id: string) {
  const names: Record<string, string> = {
    default: "工作台",
    board: "画布",
    agents: "Agent 界面",
    external: "未知界面",
    cleanup: "释放夹具",
    "combo-controls": "组合检查",
    "combo-owner": "组合所有者",
  };
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "应用设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "应用设置" });
  const button = dialog.getByRole("button", {
    name: `使用 ${names[id]}`,
    exact: true,
  });
  await button.click();
  await expect(dialog).not.toBeVisible();
}
/** Messages saved for the first Agent's first session (they live in its shard). */
export function firstSessionMessageCount(page: Page) {
  return page.evaluate(() => {
    const owner = "plums:m1:extension.agents.local";
    const index = JSON.parse(localStorage.getItem(owner)!).value;
    // A shard is written only once the session has messages.
    const shard = localStorage.getItem(
      `${owner}+${index.agents[0].sessions[0].shard}`,
    );
    return shard ? JSON.parse(shard).value.messages.length : 0;
  });
}

/** Selects an extension's card and returns the details shown for it. */
export async function extensionDetail(page: Page, card: Locator) {
  await card.click({ position: { x: 6, y: 6 } });
  return page.getByRole("region", { name: "所选扩展详情" });
}

/** Phones name the conversation in the title bar; desktop in its own header. */
export async function expectConversationTitle(
  page: Page,
  width: number,
  agent: string,
  session: string,
) {
  if (width < 768)
    return expect(page.getByRole("banner")).toContainText(
      `${agent} · ${session}`,
    );
  const header = page
    .getByRole("region", { name: `${agent} 的会话` })
    .locator("header");
  await expect(header.getByRole("heading", { name: agent })).toBeVisible();
  await expect(header).toContainText(`· ${session}`);
  await expect(page.getByRole("banner")).not.toContainText(agent);
}
