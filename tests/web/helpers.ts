import { expect, type Locator, type Page } from "@playwright/test";
/** The rail's (or, on phones, the title bar's) button with this name. */
export const shellButton = (page: Page, name: "扩展" | "设置") =>
  page
    .getByRole("navigation", { name: "应用导航" })
    .or(page.getByRole("banner"))
    .getByRole("button", { name, exact: true })
    .filter({ visible: true });
export async function manage(page: Page, diagnostics = false) {
  const manager = page.getByRole("heading", { name: "扩展", exact: true });
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
  return page.getByRole("dialog", { name: "设置", exact: true });
}
/** Picks the interface in the open settings. */
export async function pickLayout(page: Page, label: string) {
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByRole("button", { name: /^界面，/ })
    .click();
  await page.getByRole("menuitemradio", { name: label, exact: true }).click();
}
/** Picks a theme, by its label, in the open settings. */
export async function pickTheme(page: Page, label: string) {
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByRole("button", { name: /^主题，/ })
    .click();
  await page
    .getByRole("menuitemradio", { name: new RegExp(`^${label}`) })
    .click();
}
/** Switches the colour in settings, then closes them. */
export async function switchAppearance(
  page: Page,
  to: "跟随系统" | "深色" | "浅色",
) {
  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: to, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
/** Opens an extension's details in management: its pages, settings and removal. */
export async function selectExtension(page: Page, id: string) {
  if (await page.getByRole("region", { name: "所选扩展详情" }).count())
    await closeDetails(page);
  await page
    .locator(`[data-extension-id="${id}"] [data-slot=extension-title]`)
    .click();
}
/** Opens the model connections dialog from its extension's details in management. */
export async function openConnections(page: Page) {
  await manage(page);
  await page
    .locator('[data-extension-id="connector.models"]')
    .getByRole("button", { name: "模型连接", exact: true })
    .click();
  await page
    .getByRole("region", { name: "所选扩展详情" })
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
/**
 * From the first step of adding an Agent, goes on to its model and
 * extensions; returns that second step.
 */
export async function nextStep(page: Page, name: string) {
  await page
    .getByRole("dialog", { name: "添加 Agent", exact: true })
    .getByRole("button", { name: "下一步", exact: true })
    .click();
  return page.getByRole("dialog", { name: `${name}的扩展`, exact: true });
}
/** Adds an Agent through both steps of the add dialog, keeping the defaults. */
export async function addAgent(
  page: Page,
  name: string,
  { description }: { description?: string } = {},
) {
  const dialog = await openAddAgent(page);
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill(name);
  if (description)
    await dialog.getByRole("textbox", { name: "介绍" }).fill(description);
  const compose = await nextStep(page, name);
  await compose.getByRole("button", { name: "添加", exact: true }).click();
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
  await pickLayout(page, names[id]);
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
/** Leaves management for the workspace, closing any details left open. */
export async function backToWorkspace(page: Page) {
  if (await page.getByRole("region", { name: "所选扩展详情" }).count())
    await closeDetails(page);
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
}
/** Closes an extension's details, which cover the page while open. */
export async function closeDetails(page: Page) {
  await page
    .getByRole("dialog")
    .filter({ has: page.getByRole("region", { name: "所选扩展详情" }) })
    .getByRole("button", { name: "完成", exact: true })
    .click();
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
    .getByRole("switch", { name: "启用 chat.slow", exact: true })
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

/** Serves a model connector with no models and its own page for adding them. */
export async function connectorWithPage(page: Page, id: string, label: string) {
  await serveModule(
    page,
    id,
    `export default {
  manifest: { id: "${id}", name: "${label}", version: "1", apiVersion: 1, provides: { chat: 1 } },
  activate(ctx) {
    ctx.view({
      id: "${id}.page",
      label: "${label}",
      presentation: "dialog",
      mount(root) {
        root.append("在这里填写${label}的密钥");
        return () => {};
      },
    });
    ctx.provide("chat", 1, {
      name: "${label}",
      manage: "${id}.page",
      models: () => [],
      subscribe: () => () => {},
      reply: async () => "",
    });
  },
};`,
  );
}

/** Installs and starts a connector served by `connectorWithPage`, then returns to the workspace. */
export async function installConnector(page: Page, id: string) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, `/${id}/`);
  await page.getByRole("switch", { name: `启用 ${id}`, exact: true }).click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
}
