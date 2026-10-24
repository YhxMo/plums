import { expect, test, type Page } from "@playwright/test";
import { manage, extensionDetail, persisted, installByPath } from "./helpers";

const nodeId = "example.local-text-node";
const pageId = "example.local-proof-pages";
const boardId = "ui.workbench-board";
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "工作台页面" });
const card = (page: Page, id: string) =>
  page.locator("article").filter({
    has: page.locator("code").filter({ hasText: `${id} ·` }),
  });

async function install(page: Page, name: string) {
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "安装扩展" });
  await installByPath(page, `/examples/${name}/`);
  await expect(dialog).not.toBeVisible();
}
async function enable(page: Page, id: string) {
  await page.getByRole("button", { name: `启用 ${id}`, exact: true }).click();
}
async function workspace(page: Page) {
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
}
async function prepare(page: Page) {
  await page.goto("/");
  await manage(page);
  // The independent contributor starts before either required provider.
  await install(page, "local-proof-pages");
  await enable(page, pageId);
  await expect(card(page, pageId)).toContainText("等待条件");
  await install(page, "local-text-node");
  await enable(page, nodeId);
  await expect(card(page, pageId)).toContainText("等待条件");
  await enableBoard(page);
  await expect(
    page.getByRole("button", { name: `停用 ${pageId}`, exact: true }),
  ).toBeVisible();
  await workspace(page);
  await nav(page)
    .getByRole("button", { name: "交稿检查", exact: true })
    .click();
}
async function enableBoard(page: Page) {
  await enable(page, boardId);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "授权并启动", exact: true })
    .click();
}

for (const [width, colorScheme] of [
  [375, "dark"],
  [1440, "light"],
] as const) {
  test(`independent nested page installs, checks text and releases old input at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await prepare(page);
    await page
      .getByRole("button", { name: "填入检查示例", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "码点数" }),
    ).toHaveText("码点数 16 · 非空白码点 10 · 非空行 3 · 段落 2");
    await expect(
      page.getByText("第 2 行：行尾有空格或制表符", { exact: true }),
    ).toBeVisible();
    const oldClear = await page
      .getByRole("button", { name: "清空文本", exact: true })
      .elementHandle();
    await nav(page).getByRole("button", { name: "结果", exact: true }).click();
    await oldClear!.evaluate((button) => (button as HTMLButtonElement).click());
    await nav(page)
      .getByRole("button", { name: "交稿检查", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: /待检查文本/ })).toHaveValue(
      "你好 A😀\nTODO  \n\n待补",
    );
    await page
      .getByRole("button", { name: "刷新节点清理计数", exact: true })
      .click();
    await expect(
      page.getByText(/节点累计挂载 2 · 已清理 1 · 活跃 1 · 订阅 1/),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: /待检查文本/ })
      .fill("<img src=x onerror=alert(1)>");
    await expect(
      page.locator('[data-page-host="local-proof"] img'),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 375) {
      const height = await page
        .getByRole("button", { name: "填入检查示例", exact: true })
        .evaluate((button) => button.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });
}

test("independent dynamic pages resolve priority and ID conflicts and remove the visible winner", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "添加 Z（0）", exact: true }).click();
  await nav(page)
    .getByRole("button", { name: "交稿清单 · Z", exact: true })
    .click();
  await expect(
    page.getByText("当前贡献：example.local-proof.z；优先级 0。", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加 A（0）", exact: true }).click();
  await expect(
    page.getByText("当前贡献：example.local-proof.a；优先级 0。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/存在 1 处导航冲突/)).toBeVisible();
  await page
    .getByRole("button", { name: "添加 高优先级（10）", exact: true })
    .click();
  await expect(
    page.getByText("当前贡献：example.local-proof.priority；优先级 10。", {
      exact: true,
    }),
  ).toBeVisible();
  const remove = page.getByRole("button", {
    name: "移除当前贡献（观察同路由回退）",
    exact: true,
  });
  for (const id of ["a", "z"]) {
    await remove.click();
    await expect(
      page.getByText(`当前贡献：example.local-proof.${id}；优先级 0。`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  await remove.click();
  await expect(nav(page).getByRole("button", { name: /交稿清单/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByText(/页面 local-proof-review 暂不可用，原偏好已保留/),
  ).toBeVisible();
  await nav(page)
    .getByRole("button", { name: "交稿检查", exact: true })
    .click();
  await page.getByRole("button", { name: "添加 A（0）", exact: true }).click();
  await page.getByRole("button", { name: "添加 Z（0）", exact: true }).click();
  await expect(
    nav(page).getByRole("button", { name: "交稿清单 · A", exact: true }),
  ).toBeVisible();
  await expect(
    nav(page).getByRole("button", { name: "交稿清单 · Z", exact: true }),
  ).toHaveCount(0);
});

test("independent contributions stop, restore, and recover a missing persisted route through ordinary controls", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("button", { name: "添加 A（0）", exact: true }).click();
  await nav(page)
    .getByRole("button", { name: "交稿清单 · A", exact: true })
    .click();
  await persisted(page, pageId);
  await page.reload();
  // The board's permissions are remembered, so its dependents start again.
  await manage(page);
  await expect(
    page.getByRole("button", { name: `停用 ${pageId}`, exact: true }),
  ).toBeVisible();
  await workspace(page);
  // Dynamic contributions were activation-local; the missing preference survives.
  await expect(
    page.getByText(/页面 local-proof-review 暂不可用，原偏好已保留/),
  ).toBeVisible();
  await nav(page)
    .getByRole("button", { name: "交稿检查", exact: true })
    .click();
  await page.getByRole("button", { name: "填入检查示例", exact: true }).click();
  await manage(page);
  await page
    .getByRole("button", { name: `停用 ${pageId}`, exact: true })
    .click();
  await expect(await extensionDetail(page, card(page, pageId))).toContainText(
    "0 项资源 · 0 个在途任务",
  );
  await workspace(page);
  await expect(
    nav(page).getByRole("button", { name: "交稿检查", exact: true }),
  ).toHaveCount(0);
  await manage(page);
  await enable(page, pageId);
  await workspace(page);
  await nav(page)
    .getByRole("button", { name: "交稿检查", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: /待检查文本/ })).toHaveValue(
    "你好 A😀\nTODO  \n\n待补",
  );
  for (let cycle = 0; cycle < 3; cycle++) {
    await page
      .getByRole("button", { name: "添加 Z（0）", exact: true })
      .click();
    await page
      .getByRole("button", { name: "填入检查示例", exact: true })
      .click();
    await manage(page);
    await page
      .getByRole("button", { name: `停用 ${nodeId}`, exact: true })
      .click();
    await expect(card(page, pageId)).toContainText("等待条件");
    await expect(await extensionDetail(page, card(page, pageId))).toContainText(
      "0 项资源 · 0 个在途任务",
    );
    await expect(await extensionDetail(page, card(page, nodeId))).toContainText(
      "0 项资源 · 0 个在途任务",
    );
    await workspace(page);
    await expect(
      nav(page).getByRole("button", { name: "交稿检查", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav(page).getByRole("button", { name: /交稿清单/ }),
    ).toHaveCount(0);
    await manage(page);
    await enable(page, nodeId);
    await workspace(page);
    await nav(page)
      .getByRole("button", { name: "交稿检查", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: /待检查文本/ })).toHaveValue(
      "",
    );
    await page
      .getByRole("button", { name: "刷新节点清理计数", exact: true })
      .click();
    await expect(page.getByText(/活跃 1 · 订阅 1/)).toBeVisible();
  }
  await manage(page);
  await page
    .getByRole("button", { name: `停用 ${boardId}`, exact: true })
    .click();
  await expect(card(page, pageId)).toContainText("等待条件");
  await workspace(page);
  await expect(
    page.getByRole("heading", { name: "欢迎使用 Plums" }),
  ).toBeVisible();
  await manage(page);
  // The board keeps its grant, so enabling it again does not ask.
  await enable(page, boardId);
  await workspace(page);
  await expect(
    nav(page).getByRole("button", { name: "交稿检查", exact: true }),
  ).toBeVisible();
});
