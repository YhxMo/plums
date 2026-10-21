import { addAgent, manage, legacyEntry, chooseLayout } from "./helpers";
import { test, expect, type Page } from "@playwright/test";
async function authorize(page: Page) {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "授权并启动", exact: true })
    .click();
}
async function start(page: Page) {
  await page.goto("/");
  await (await legacyEntry(page)).click();
  await authorize(page);
  await expect(page.getByRole("heading", { name: "文本工作台" })).toBeVisible();
}
async function run(page: Page, input: string, output: string) {
  await page.getByRole("textbox", { name: "待处理文本" }).fill(input);
  await page.getByRole("button", { name: "运行并保存" }).click();
  await expect(page.locator("[data-output]")).toHaveText(output);
  await expect(page.locator("[data-phase]")).toHaveText("已保存");
}
test("replaces complete UI and restores persisted state after reload", async ({
  page,
}) => {
  await start(page);
  await run(page, "plums", "PLUMS");
  await chooseLayout(page, "board");
  await expect(
    page.getByRole("navigation", { name: "画布导航" }),
  ).toBeVisible();
  await page.reload();
  await (await legacyEntry(page)).click();
  await authorize(page);
  await expect(page.getByRole("heading", { name: "工作画布" })).toBeVisible();
  await expect(page.locator("[data-output]")).toHaveText("PLUMS");
  await manage(page, true);
  await page.getByRole("button", { name: "停用当前布局" }).click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "文本工作台" })).toBeVisible();
});
test("rebinds consumer and remounts a view when the provider changes", async ({
  page,
}) => {
  await start(page);
  await run(page, "abc", "ABC");
  await manage(page, true);
  await page.getByRole("button", { name: "替换服务" }).click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.locator("[data-provider]")).toHaveText("Reverse");
  await run(page, "abc", "cba");
});
test("cancel prevents a new result from being persisted", async ({ page }) => {
  await start(page);
  await run(page, "saved", "SAVED");
  await page.getByRole("textbox", { name: "待处理文本" }).fill("do not save");
  await page.getByRole("button", { name: "运行并保存" }).click();
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect(page.locator("[data-phase]")).toContainText("已取消");
  await expect(page.locator("[data-output]")).toHaveText("SAVED");
  await page.reload();
  await (await legacyEntry(page)).click();
  await authorize(page);
  await expect(page.getByRole("textbox")).toHaveValue("saved");
});
test("failed storage preserves prior state and can retry", async ({ page }) => {
  await start(page);
  await run(page, "saved", "SAVED");
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("textbox").fill("failed");
  await page.getByRole("button", { name: "运行并保存" }).click();
  await expect(page.locator("[data-error]")).toContainText("注入的写入故障");
  await expect(page.locator("[data-output]")).toHaveText("SAVED");
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").uncheck();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await run(page, "retry", "RETRY");
});
test("revoking capability suspends consumers, and regrant restores the UI", async ({
  page,
}) => {
  await start(page);
  await run(page, "saved", "SAVED");
  await manage(page, true);
  await page.getByRole("button", { name: "撤销状态写入", exact: true }).click();
  await expect(
    page.locator("article").filter({ hasText: "文本工作台" }),
  ).toContainText("等待条件");
  await (await legacyEntry(page)).click();
  await authorize(page);
  await expect(page.locator("[data-output]")).toHaveText("SAVED");
});
test("broken layout recovers to the working default without losing management", async ({
  page,
}) => {
  await start(page);
  await manage(page, true);
  await page.getByRole("button", { name: "测试故障布局" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "布局不可用" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "文本工作台" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "应用菜单", exact: true }),
  ).toBeEnabled();
});
// The development build's defaults, already offered once and turned off.
const defaults = [
  "transform.upper",
  "connector.models",
  "agents.local",
  "ui.agents",
];
test("a failed preferred layout keeps a non-empty selection instead of persisting an empty layout", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((defaults) => {
    localStorage.setItem(
      "plums:m1:host.shell",
      JSON.stringify({
        schema: 1,
        revision: 1,
        value: {
          version: 1,
          theme: "light",
          layout: "broken",
          layoutIntent: "explicit",
          agents: [],
          composition: {
            schema: 1,
            enabled: [{ id: "ui.broken", version: "1.0.0" }],
            offered: defaults,
          },
        },
      }),
    );
  }, defaults);
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "布局不可用" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "切换到深色模式", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("plums:m1:host.shell")!).revision,
      ),
    )
    .toBe(2);
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value,
  );
  expect(saved.theme).toBe("dark");
  expect(saved.layout).toBe("broken");
});
test("enabling a workspace with a missing dependency explains the wait in Chinese", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((defaults) => {
    localStorage.setItem(
      "plums:m1:host.shell",
      JSON.stringify({
        schema: 1,
        revision: 1,
        value: {
          version: 1,
          agents: [],
          composition: { schema: 1, enabled: [], offered: defaults },
        },
      }),
    );
  }, defaults);
  await page.reload();
  await manage(page);
  await page
    .getByRole("button", { name: "启用 ui.agents", exact: true })
    .click();
  const notice = page.getByRole("status").filter({ hasText: "扩展尚未运行" });
  await expect(notice).toContainText("依赖暂不可用：agents@1");
  await expect(notice).not.toContainText("Dependency unavailable");
});
test("ordinary UI fits a narrow viewport and works with keyboard input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await start(page);
  await run(page, "narrow screen", "NARROW SCREEN");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await chooseLayout(page, "board");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("textbox").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("keyboard");
  await expect(page.getByRole("textbox")).toHaveValue("keyboard");
});
test("loads and enables an unknown external view through the public catalog and management UI", async ({
  page,
}) => {
  await page.route("**/catalog.json", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      json: [
        ...catalog,
        {
          id: "external.view",
          url: "/external-view.js",
          label: "未知作者界面",
        },
      ],
    });
  });
  await page.route("**/external-view.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export default {manifest:{id:"external.view",version:"1.0.0",apiVersion:1},activate(ctx){ctx.view({id:"external",label:"未知界面",mount(root){const h=document.createElement("h1");h.textContent="独立模块的新交互";root.append(h);return()=>root.replaceChildren();}})}}',
    }),
  );
  await start(page);
  await manage(page);
  await page
    .getByRole("button", { name: "启用 external.view", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await chooseLayout(page, "external");
  await expect(
    page.getByRole("heading", { name: "独立模块的新交互" }),
  ).toBeVisible();
  await manage(page, true);
  await page.getByRole("button", { name: "停用当前布局" }).click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "文本工作台" })).toBeVisible();
});

test("a broken layout with no remaining layout exposes a truthful host recovery path", async ({
  page,
}) => {
  await start(page);
  await manage(page);
  await page
    .getByRole("button", { name: "停用 ui.agents", exact: true })
    .click();
  await page
    .getByRole("button", { name: "停用 ui.default", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工作画布" })).toBeVisible();
  await manage(page);
  await page
    .getByRole("button", { name: "停用 ui.board", exact: true })
    .click();
  await page
    .getByRole("button", { name: "启用 ui.broken", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "扩展正在等待条件。" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText("已恢复默认界面");
  await page.getByRole("button", { name: "恢复权限与默认界面" }).click();
  await authorize(page);
  await expect(page.getByRole("heading", { name: "文本工作台" })).toBeVisible();
});

test("an async release failure stays visible in the React management path", async ({
  page,
}) => {
  await page.route("**/catalog.json", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      json: [
        ...catalog,
        {
          id: "cleanup.fixture",
          url: "/cleanup-fixture.js",
          label: "异步释放夹具",
        },
      ],
    });
  });
  await page.route("**/cleanup-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'export default {manifest:{id:"cleanup.fixture",version:"1.0.0",apiVersion:1},activate(ctx){ctx.view({id:"cleanup",label:"释放夹具",mount(root){root.textContent="等待释放";return async()=>{await Promise.resolve();throw Error("teardown failed")}}})}}',
    }),
  );
  await start(page);
  await manage(page);
  await page
    .getByRole("button", { name: "启用 cleanup.fixture", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await chooseLayout(page, "cleanup");
  await expect(page.getByText("等待释放", { exact: true })).toBeVisible();
  await chooseLayout(page, "default");
  await expect(page.getByRole("heading", { name: "文本工作台" })).toBeVisible();
  await manage(page);
  await expect(
    page.locator("article").filter({ hasText: "异步释放夹具" }),
  ).toContainText("清理未完成");
  await expect(
    page.getByRole("button", { name: "启用 cleanup.fixture", exact: true }),
  ).toBeDisabled();
});

test("the desktop rail switches between the workspace and extension management", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto("/");
  const rail = page.getByRole("navigation", { name: "应用导航" });
  const workspace = rail.getByRole("button", {
    name: "Agent 界面",
    exact: true,
  });
  const extensions = rail.getByRole("button", {
    name: "扩展管理",
    exact: true,
  });
  await expect(workspace).toHaveAttribute("aria-current", "page");
  await extensions.click();
  await expect(page.getByRole("heading", { name: "扩展与状态" })).toBeVisible();
  await expect(extensions).toHaveAttribute("aria-current", "page");
  await expect(workspace).not.toHaveAttribute("aria-current", "page");
  await workspace.click();
  await expect(page.getByRole("heading", { name: "扩展与状态" })).toBeHidden();
  await expect(workspace).toHaveAttribute("aria-current", "page");
  await rail.getByRole("button", { name: "应用菜单", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "应用设置" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Phones keep these actions in the title bar instead.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(rail).toBeHidden();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "应用菜单" }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`the rail, list and conversation are three tones, both panes lighter than the rail, in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1180, height: 800 });
    await page.goto("/");
    await addAgent(page, "分层");
    // Reads the first non-transparent background at or above each element.
    const [rail, list, conversation] = await page.evaluate(() =>
      [
        document.querySelector('nav[aria-label="应用导航"]'),
        document.querySelector('aside[aria-label="Agent 列表"]'),
        document.querySelector('section[aria-label$="的会话"]'),
      ].map((start) => {
        for (let element = start; element; element = element.parentElement) {
          const color = getComputedStyle(element).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)") return color;
        }
        return "";
      }),
    );
    expect(list).not.toBe(conversation);
    expect(conversation).not.toBe(rail);
    const luminance = (color: string) =>
      color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .reduce((sum, channel) => sum + Number(channel), 0);
    expect(luminance(list)).toBeGreaterThan(luminance(rail));
    expect(luminance(conversation)).toBeGreaterThan(luminance(rail));
  });
}
