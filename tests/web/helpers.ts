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
    const panel = page.getByRole("button", { name: "诊断与实验" });
    if ((await panel.getAttribute("aria-expanded")) !== "true")
      await panel.click();
  }
}
/** Opens the model connections dialog from the app menu. */
export async function openConnections(page: Page) {
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "模型连接", exact: true }).click();
  return page.getByRole("dialog", { name: "模型连接", exact: true });
}
/** Adds an Agent from scratch through the add dialog. */
export async function addAgent(
  page: Page,
  name: string,
  { description }: { description?: string } = {},
) {
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  if (description)
    await page.getByRole("textbox", { name: "介绍" }).fill(description);
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
  const button = dialog.getByRole("radio", {
    name: `使用 ${names[id]}`,
    exact: true,
  });
  await button.click();
  await expect(dialog).not.toBeVisible();
}
/** Messages saved for an Agent's first session, read from its stored pages. */
export function firstSessionMessageCount(page: Page, agent: string) {
  return page.evaluate((agent) => {
    const owner = "plums:m1:extension.agents.local";
    const index = JSON.parse(localStorage.getItem(owner)!).value;
    const entry = index.agents.find(
      (item: { name: string }) => item.name === agent,
    );
    const json = (entry.sessions[0].pages as string[])
      .map(
        (key) =>
          JSON.parse(localStorage.getItem(`${owner}+${key}`)!).value.part,
      )
      .join("");
    return json ? JSON.parse(json).length : 0;
  }, agent);
}

/** Selects an extension's card and returns the details shown for it. */
export async function extensionDetail(page: Page, card: Locator) {
  await card.click({ position: { x: 6, y: 6 } });
  return page.getByRole("region", { name: "所选扩展详情" });
}

/** The conversation names itself in its own header; the title bar never repeats it. */
export async function expectConversationTitle(
  page: Page,
  _width: number,
  agent: string,
  session: string,
) {
  const header = page
    .getByRole("region", { name: `${agent} 的会话` })
    .locator("header");
  await expect(header.getByRole("heading", { name: agent })).toBeVisible();
  await expect(
    header.getByRole("button", { name: `会话：${session}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).not.toContainText(agent);
}
/** Waits until the enabled set recorded for the next start has `id` on or off. */
export async function persisted(page: Page, id: string, enabled = true) {
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const saved = JSON.parse(
          localStorage.getItem("plums:m1:host.shell") ?? "null",
        );
        return (saved?.value?.composition?.enabled ?? []).some(
          (entry: { id: string }) => entry.id === id,
        );
      }, id),
    )
    .toBe(enabled);
}
