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
/**
 * Opens adding an Agent: the welcome's button when there are none yet,
 * otherwise the list's add menu.
 */
export async function openAddAgent(page: Page) {
  const welcome = page
    .getByRole("main")
    .getByRole("button", { name: "添加 Agent", exact: true })
    .filter({ visible: true });
  const menu = page
    .getByRole("button", { name: "添加", exact: true })
    .filter({ visible: true })
    .first();
  await expect(welcome.or(menu).first()).toBeVisible();
  if (await welcome.count()) await welcome.click();
  else {
    await menu.click();
    await page
      .getByRole("menuitem", { name: "添加 Agent", exact: true })
      .click();
  }
  return page.getByRole("dialog", { name: "添加 Agent", exact: true });
}
/** Adds an Agent through the add dialog. */
export async function addAgent(
  page: Page,
  name: string,
  { description }: { description?: string } = {},
) {
  const dialog = await openAddAgent(page);
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  if (description)
    await dialog.getByRole("textbox", { name: "介绍" }).fill(description);
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
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

/**
 * Serves a test module as the extension folder `/<name>/`: main.js is the
 * module, and manifest.json the manifest it exports.
 */
export async function serveModule(page: Page, name: string, body: string) {
  const { default: definition } = await import(
    `data:text/javascript,${encodeURIComponent(body)}`
  );
  await page.route(`**/${name}/manifest.json`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(definition.manifest),
    }),
  );
  await page.route(`**/${name}/main.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body }),
  );
}
/** Loads an extension folder through the install dialog's developer path. */
export async function installByPath(page: Page, folder: string) {
  const dialog = page.getByRole("dialog", { name: "安装扩展" });
  if (!(await dialog.isVisible())) {
    await manage(page);
    await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  }
  await dialog.getByLabel("扩展文件夹路径", { exact: true }).fill(folder);
  await dialog.getByRole("button", { name: "加载扩展", exact: true }).click();
}

/** Installs a model that answers only when the test calls `answer()`, and an Agent on it. */
export async function slowAgent(page: Page, name: string) {
  await serveModule(
    page,
    "slow-chat",
    `export default {
  manifest: { id: "chat.slow", version: "1", apiVersion: 1, provides: { chat: 1 } },
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "慢模型",
      models: () => [{ id: "slow", label: "慢", description: "" }],
      subscribe: () => () => {},
      reply: ({ input }, signal) =>
        new Promise((done, reject) => {
          signal.throwIfAborted();
          const stop = () => reject(signal.reason);
          signal.addEventListener("abort", stop, { once: true });
          window.answer = () => {
            signal.removeEventListener("abort", stop);
            done("答：" + input);
          };
        }),
    });
  },
};`,
  );
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, "/slow-chat/");
  await page
    .getByRole("button", { name: "启用 chat.slow", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, name);
  await page.getByRole("combobox", { name: "切换模型", exact: true }).click();
  await page
    .getByRole("listbox", { name: "切换模型" })
    .getByRole("option", { name: /^慢/ })
    .click();
}

/** Lets the slow model answer the message it holds. */
export const answer = (page: Page) =>
  page.evaluate(() => (window as unknown as { answer(): void }).answer());
