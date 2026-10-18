import { expect, type Page } from "@playwright/test";
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
