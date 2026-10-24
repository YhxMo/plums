import { expect, type Locator, type Page } from "@playwright/test";
/** The rail's (or, on phones, the title bar's) button with this name. */
export const shellButton = (page: Page, name: "扩展" | "设置") =>
  page
    .getByRole("navigation", { name: "应用导航" })
    .or(page.getByRole("banner"))
    .getByRole("button", { name, exact: true })
    .filter({ visible: true });
export async function manage(page: Page, diagnostics = false) {
  const manager = page.getByRole("heading", { name: "扩展与状态" });
  if (!(await manager.isVisible())) await shellButton(page, "扩展").click();
  if (diagnostics) {
    const panel = page.getByRole("button", { name: "诊断与实验" });
    if ((await panel.getAttribute("aria-expanded")) !== "true")
      await panel.click();
  }
}
/** Opens application settings from the rail or the phone title bar. */
export async function openSettings(page: Page) {
  await shellButton(page, "设置").click();
  return page.getByRole("dialog", { name: "应用设置" });
}
/** Switches light/dark in settings, then closes them. */
export async function switchAppearance(page: Page, to: "深色" | "浅色") {
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: `切换到${to}模式` }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
/** Opens the model connections dialog from its extension's card in management. */
export async function openConnections(page: Page) {
  await manage(page);
  await page
    .getByRole("button", { name: "打开 模型连接", exact: true })
    .click();
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
  const dialog = await openSettings(page);
  const button = dialog.getByRole("radio", {
    name: `使用 ${names[id]}`,
    exact: true,
  });
  await button.click();
  await expect(dialog).not.toBeVisible();
}
/** Messages saved for an Agent's first session, read from its stored records. */
export function firstSessionMessageCount(page: Page, agent: string) {
  return page.evaluate((agent) => {
    const owner = "plums:extension.agents.local";
    const index = JSON.parse(localStorage.getItem(owner)!).value;
    const entry = index.agents.find(
      (item: { name: string }) => item.name === agent,
    );
    const stored = localStorage.getItem(`${owner}#records`);
    const records: { collection: string }[] = stored
      ? JSON.parse(stored).records
      : [];
    const collection = `session:${entry.sessions[0].id}`;
    return records.filter((record) => record.collection === collection).length;
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
  await expect(page.getByRole("banner").filter({ hasText: agent })).toHaveCount(
    0,
  );
}
/** Waits until the enabled set recorded for the next start has `id` on or off. */
export async function persisted(page: Page, id: string, enabled = true) {
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const saved = JSON.parse(
          localStorage.getItem("plums:host.shell") ?? "null",
        );
        return (saved?.value?.composition?.enabled ?? []).some(
          (entry: { id: string }) => entry.id === id,
        );
      }, id),
    )
    .toBe(enabled);
}
