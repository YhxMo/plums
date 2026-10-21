import { readFileSync } from "node:fs";
import {
  addAgent,
  expectConversationTitle,
  firstSessionMessageCount,
  manage,
} from "./helpers";
import { expect, test, type Page } from "@playwright/test";
const sidebarToggle = (page: Page) =>
  page.getByRole("button", { name: "展开或收起右侧栏", exact: true });
const add = (page: Page, name = "编程助手") =>
  addAgent(page, name, { description: "帮助整理代码与文字。" });
/** Opens the conversation header's session menu. */
const sessions = (page: Page, title: string) =>
  page.getByRole("button", { name: `会话：${title}`, exact: true });
for (const width of [375, 1180]) {
  test(`welcome is reserved for zero Agents and existing Agent navigation survives reload at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    const welcome = page.getByRole("main");
    await expect(
      welcome.getByRole("button", { name: /导入角色卡/ }),
    ).toBeVisible();
    await expect(
      welcome.getByRole("button", { name: /安装扩展/ }),
    ).toBeVisible();
    await add(page, "已有角色");
    await page.reload();
    const existing = page.getByRole("button", {
      name: "与 已有角色 交互",
      exact: true,
    });
    await expect(existing).toBeVisible();
    if (width === 1180) {
      await expect(
        page.getByRole("heading", { name: "欢迎使用 Plums" }),
      ).toHaveCount(0);
      await expect(welcome.getByRole("img", { name: "Plums" })).toBeVisible();
      await expect(welcome.getByRole("button")).toHaveCount(0);
      await manage(page);
      await page
        .getByRole("button", { name: "返回工作区", exact: true })
        .click();
      await expect(welcome.getByRole("img", { name: "Plums" })).toBeVisible();
    } else {
      await expect(welcome).toBeHidden();
    }
    await existing.click();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeVisible();
    if (width === 375) {
      await page.getByRole("button", { name: "返回 Agent 列表" }).click();
      await expect(existing).toBeVisible();
      await expect(welcome).toBeHidden();
    }
  });
}
for (const width of [375, 1440]) {
  test(`agent creation, pinning, sessions and reload at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "欢迎使用 Plums" }),
    ).toBeVisible();
    await expect(page.locator("select")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    await add(page);
    await expectConversationTitle(page, width, "编程助手", "未命名会话");
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("hello agent");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    const reply = /^echo-a｜第 1 轮｜.*hello agent$/;
    await expect(page.getByRole("log").getByText(reply)).toBeVisible();
    await expectConversationTitle(page, width, "编程助手", "hello agent");
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "设为特别关注", exact: true })
      .click();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await expectConversationTitle(page, width, "编程助手", "未命名会话");
    await expect(page.getByRole("log").getByText(reply)).toHaveCount(0);
    await page.reload();
    const row = page.getByRole("button", {
      name: "与 编程助手 交互",
      exact: true,
    });
    await expect(page.locator('[data-slot="agent-tile"]')).toHaveCount(1);
    await row.click();
    await sessions(page, "未命名会话").click();
    await page
      .getByRole("menuitemradio", { name: "hello agent", exact: true })
      .click();
    await expect(page.getByRole("log").getByText(reply)).toBeVisible();
    if (width === 375)
      await page.getByRole("button", { name: "返回 Agent 列表" }).click();
    // Every Agent row has the same menu on a right click.
    await row.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "移除 Agent", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除" }).click();
    await expect(
      page.getByRole("heading", { name: "欢迎使用 Plums" }),
    ).toBeVisible();
  });
}
test("an imported role card introduces the Agent in the conversation and details", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /导入角色卡/ }).click();
  await page.getByLabel("角色卡文件").setInputFiles({
    name: "role.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        name: "写作助手",
        description: "协助理解文稿边界",
      }),
    ),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "写作助手 的会话", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("log")).toContainText("协助理解文稿边界");
  await sidebarToggle(page).click();
  const details = page.getByRole("complementary", { name: "Agent 详情" });
  await expect(details).toContainText("协助理解文稿边界");
  await expect(
    details.getByRole("list", { name: "写作助手 的组成扩展" }),
  ).toBeVisible();
});
test("custom app menu keyboard and theme draft retention", async ({ page }) => {
  await page.goto("/");
  await add(page, "本地助手");
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("draft");
  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveValue("draft");
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "扩展管理", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "应用设置" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "应用菜单", exact: true }),
  ).toBeFocused();
});

test("agent save failure retains draft and can recover without duplicate messages", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "恢复助手");
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("retain this draft");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("注入的写入故障");
  await expect(input).toHaveValue("retain this draft");
  await expect(page.getByRole("log")).not.toContainText("retain this draft");
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").uncheck();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log.getByText(/^echo-a｜.*retain this draft$/)).toHaveCount(1);
  await expect(log.getByText("retain this draft", { exact: true })).toHaveCount(
    1,
  );
  await expect(input).toHaveValue("");
});

test("mobile details trap focus, and the session menu and list rename work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await add(page);
  const trigger = page.getByRole("button", { name: "展开或收起右侧栏" });
  await trigger.click();
  const detail = page.getByRole("dialog", { name: "Agent 详情", exact: true });
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(
    await detail.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await detail.getByRole("button", { name: "收起详情", exact: true }).click();
  await expect(trigger).toBeFocused();
  // Deleting the only session leaves a fresh one, and focus on its menu.
  await sessions(page, "未命名会话").click();
  await page.getByRole("menuitem", { name: "删除此会话", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除会话", exact: true })
    .getByRole("button", { name: "确认删除" })
    .click();
  await expect(sessions(page, "未命名会话")).toBeFocused();
  await page.getByRole("button", { name: "返回 Agent 列表" }).click();
  await page
    .getByRole("button", { name: "编程助手 的操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("重命名后");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "与 重命名后 交互", exact: true }),
  ).toBeVisible();
});

test("imports persist and an external agent provider drives the default UI", async ({
  page,
}) => {
  await page.route("**/external-agents.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    export default {manifest:{id:'external.agents',apiVersion:1,version:'2.1.0',provides:{agents:1}},activate(ctx){
      const session={id:'s',title:'外部会话',createdAt:1,lastMessageAt:1,messages:[]};
      let agents=[{id:'external',name:'外部角色',description:'独立作者的角色说明',status:'online',pinned:false,extensionId:'external.agents',currentSessionId:'s',sessions:[session]}];
      const listeners=new Set();ctx.provide('agents',1,{agents,listeners,info:{label:'独立提供者',version:'2.1.0',description:'外部回声服务'},list(){return this.agents},subscribe(f){this.listeners.add(f);return()=>this.listeners.delete(f)},async send(id,text){this.agents=this.agents.map(a=>({...a,sessions:[{...session,messages:[{id:'m1',role:'user',text},{id:'m2',role:'agent',text:'外部：'+text}]}]}));this.listeners.forEach(f=>f())},cancel(){}});
    }};`,
    }),
  );
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await page.getByLabel("扩展 ID", { exact: true }).fill("external.agents");
  await page
    .getByLabel("模块路径", { exact: true })
    .fill("/external-agents.js");
  await page.getByRole("button", { name: "加载模块", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("模块路径已保存");
  await page.reload();
  await manage(page);
  await page
    .getByRole("button", { name: "停用 agents.local", exact: true })
    .click();
  await page
    .getByRole("button", { name: "启用 external.agents", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page
    .getByRole("button", { name: "与 外部角色 交互", exact: true })
    .click();
  await expect(page.getByRole("log")).toContainText("独立作者的角色说明");
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("contract");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("外部：contract");
  await sidebarToggle(page).click();
  await expect(
    page.getByRole("button", { name: "查看扩展 独立提供者" }),
  ).toBeVisible();
});

test("unavailable saved import retains startup and offers removal and retry", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "plums:m1:host.shell",
      JSON.stringify({
        schema: 1,
        revision: 1,
        value: {
          version: 1,
          theme: "light",
          layout: "agents",
          imports: [
            { id: "missing.extension", url: "/missing.js", label: "missing" },
          ],
        },
      }),
    ),
  );
  await page.route("**/missing.js", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "欢迎使用 Plums" }),
  ).toBeVisible();
  await manage(page);
  await expect(
    page.getByRole("button", {
      name: "重试加载 missing.extension",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "移除路径 missing.extension", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "移除路径 missing.extension",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value.imports,
    ),
  ).toEqual([]);
});

test("mobile list failures stay visible and rename cancel restores the operation trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await add(page);
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "返回 Agent 列表" }).click();
  const trigger = page.getByRole("button", {
    name: "编程助手 的操作",
    exact: true,
  });
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "设为特别关注", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("注入的写入故障");
  await expect(page.getByRole("alert")).toBeHidden({ timeout: 15000 });
  await trigger.click();
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

for (const width of [375, 1440])
  test(`the introduction is edited in details and persists at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await add(page, "角色设置");
    await sidebarToggle(page).click();
    await page.getByRole("button", { name: "编辑介绍", exact: true }).click();
    await page
      .getByRole("textbox", { name: "介绍", exact: true })
      .fill("新的角色边界与工作方式");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "介绍", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "收起详情" }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "与 角色设置 交互", exact: true })
      .click();
    await expect(page.getByRole("log")).toContainText("新的角色边界与工作方式");
  });

test("reinstalling a failed import replaces its path and remains bootable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("plums:m1:host.shell"))
      localStorage.setItem(
        "plums:m1:host.shell",
        JSON.stringify({
          schema: 1,
          revision: 1,
          value: {
            version: 1,
            imports: [
              { id: "recover.extension", url: "/missing.js", label: "recover" },
            ],
          },
        }),
      );
  });
  await page.route("**/missing.js", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.route("**/recovered.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export default {manifest:{id:"recover.extension",version:"1.0.0",apiVersion:1},activate(){}};`,
    }),
  );
  await page.goto("/");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await page.getByLabel("扩展 ID", { exact: true }).fill("recover.extension");
  await page.getByLabel("模块路径", { exact: true }).fill("/recovered.js");
  await page.getByRole("button", { name: "加载模块" }).click();
  await expect(page.getByRole("status")).toContainText("模块路径已保存");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value.imports,
    ),
  ).toEqual([
    {
      id: "recover.extension",
      url: "/recovered.js",
      label: "recover.extension",
    },
  ]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "欢迎使用 Plums" }),
  ).toBeVisible();
  await manage(page);
  await expect(
    page.getByRole("button", { name: "启用 recover.extension", exact: true }),
  ).toBeVisible();
});

test("a failed introduction save shows inside the phone details and keeps the edit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await add(page);
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
  const detail = page.getByRole("dialog", { name: "Agent 详情", exact: true });
  await detail.getByRole("button", { name: "编辑介绍", exact: true }).click();
  const intro = detail.getByRole("textbox", { name: "介绍", exact: true });
  await intro.fill("保存不了的介绍");
  await detail.getByRole("button", { name: "保存", exact: true }).click();
  await expect(detail.getByRole("alert")).toContainText("注入的写入故障");
  await expect(intro).toHaveValue("保存不了的介绍");
});

for (const theme of ["light", "dark"] as const) {
  test(`dialog close is quiet on non-focusing open and shows pointer and keyboard feedback in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    const trigger = page
      .getByRole("button", { name: "添加", exact: true })
      .first();
    // Reproduce WebKit pointer activation without first focusing the opener.
    await trigger.evaluate((button: HTMLButtonElement) => button.click());
    const dialog = page.getByRole("dialog", { name: "添加", exact: true });
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    // Buttons show keyboard focus as a 3px ring.
    const ring = () =>
      close.evaluate((button) =>
        getComputedStyle(button).boxShadow.includes(" 0px 0px 0px 3px"),
      );
    await expect(close).toBeVisible();
    expect(await ring()).toBe(false);
    await close.hover();
    await expect
      .poll(() =>
        close.evaluate((button) => getComputedStyle(button).backgroundColor),
      )
      .not.toBe("rgba(0, 0, 0, 0)");
    await page.mouse.move(1, 1);
    expect(await ring()).toBe(false);
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await expect.poll(ring).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("button", { name: /^添加 Agent/ }).click();
    await expect(
      page
        .getByRole("dialog", { name: "添加 Agent", exact: true })
        .getByRole("textbox", { name: "名称", exact: true }),
    ).toBeFocused();
  });
}

for (const close of ["Escape", "button"] as const) {
  test(`non-focusing add activation returns focus after ${close}`, async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", {
      name: "从头添加 Agent",
      exact: true,
    });
    await trigger.evaluate((button) => (button as HTMLButtonElement).click());
    const dialog = page.getByRole("dialog", {
      name: "添加 Agent",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    if (close === "Escape") await page.keyboard.press("Escape");
    else
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
}

test("a non-focusing mobile detail returns to its trigger", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await add(page);
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.focus();
  const trigger = page.getByRole("button", { name: "展开或收起右侧栏" });
  await trigger.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(
    page.getByRole("dialog", { name: "Agent 详情", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("settings reports rejected layout and theme writes inside the modal and retries", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  const openSettings = async () => {
    await page.getByRole("button", { name: "应用菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "应用设置", exact: true }).click();
  };
  await openSettings();
  const dialog = page.getByRole("dialog", { name: "应用设置", exact: true });
  const before = await page.locator("html").getAttribute("data-theme");
  await dialog
    .getByRole("radio", { name: "使用 Agent 界面", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("注入的写入故障");
  await dialog.getByRole("button", { name: /切换到.*模式/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("注入的写入故障");
  await expect(page.locator("html")).toHaveAttribute("data-theme", before!);
  await page.keyboard.press("Escape");
  await page.getByLabel("注入存储写入失败").uncheck();
  await openSettings();
  await dialog.getByRole("button", { name: /切换到.*模式/ }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", before!);
  await dialog
    .getByRole("radio", { name: "使用 Agent 界面", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

test("service reply boundary rejects without losing draft and valid output survives reload", async ({
  page,
}) => {
  await page.route("**/boundary-chat.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: readFileSync("tests/fixtures/boundary-chat.js", "utf8"),
    }),
  );
  await page.goto("/");
  await add(page, "Boundary");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await page.getByLabel("扩展 ID", { exact: true }).fill("chat.boundary");
  await page.getByLabel("模块路径", { exact: true }).fill("/boundary-chat.js");
  await page.getByRole("button", { name: "加载模块", exact: true }).click();
  await page
    .getByRole("button", { name: "启用 chat.boundary", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page
    .getByRole("button", { name: "与 Boundary 交互", exact: true })
    .click();
  await page.getByRole("combobox", { name: "切换模型", exact: true }).click();
  await page
    .getByRole("listbox", { name: "切换模型" })
    .getByRole("option", { name: /^边界/ })
    .click();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("oversized");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本次结果未保存");
  await expect(input).toHaveValue("oversized");
  expect(await firstSessionMessageCount(page, "Boundary")).toBe(0);
  await input.fill("boundary");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect.poll(() => firstSessionMessageCount(page, "Boundary")).toBe(2);
  await page.reload();
  await page
    .getByRole("button", { name: "与 Boundary 交互", exact: true })
    .click();
  expect(
    await page
      .getByRole("log")
      .evaluate((el) =>
        [...el.querySelectorAll("p")].some(
          (p) => p.textContent === "x".repeat(1_000_000),
        ),
      ),
  ).toBe(true);
});

for (const width of [375, 1180]) {
  test(`removing a dialog opener restores an operable fallback at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    await add(page);
    if (width === 375)
      await page.getByRole("button", { name: "返回 Agent 列表" }).click();
    await page
      .getByRole("button", { name: "编程助手 的操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "移除 Agent", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    const fallback =
      width === 375
        ? page.getByRole("button", {
            name: "导入角色卡 从文件或链接，了解并添加 Agent 选择角色卡",
            exact: true,
          })
        : page
            .getByRole("complementary", { name: "Agent 列表", exact: true })
            .getByRole("button", { name: "添加", exact: true })
            .first();
    await expect(fallback).toBeFocused();
  });
}

test("a long conversation scrolls inside the log, never the whole workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto("/");
  await addAgent(page, "长对话");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  for (let i = 0; i < 6; i++) {
    await input.fill(`第 ${i} 句 ${"内容 ".repeat(80)}`);
    await input.press("Enter");
    // Wait for the reply before the next turn.
    await expect(
      page.getByRole("log").getByText(new RegExp(`^echo-a｜第 ${i + 1} 轮`)),
    ).toHaveCount(1);
  }
  // Hidden speaker labels are absolutely positioned. If their containing
  // block sits outside the log, WebKit counts them as overflow of the shell,
  // and wheel scrolling past the log's end slides the whole app up.
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[role=log] .sr-only")]
        .filter(
          (label) => !label.closest("[role=log]")!.contains(label.offsetParent),
        )
        .map((label) => label.textContent),
    ),
  ).toEqual([]);
});

test("a special-attention Agent moves to a large-avatar section above the rows", async ({
  page,
}) => {
  await page.goto("/");
  await add(page, "普通");
  await page.getByRole("button", { name: "添加", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /添加 Agent/ })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("关注者");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  const list = page.getByRole("complementary", { name: "Agent 列表" });
  const rows = list.locator('[data-slot="agent-row"]');
  const tiles = list.locator('[data-slot="agent-tile"]');
  const row = list.getByRole("button", { name: "与 关注者 交互", exact: true });
  await expect(rows.first()).toHaveAccessibleName("与 普通 交互");
  await page
    .getByRole("button", { name: "关注者 的操作", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "设为特别关注", exact: true })
    .click();
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toHaveAccessibleName("与 关注者 交互");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAccessibleName("与 普通 交互");
  await row.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "取消特别关注", exact: true })
    .click();
  await expect(tiles).toHaveCount(0);
  await expect(rows).toHaveCount(2);
});

test("each part of an Agent can be switched off, and says what that means", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "添加", exact: true }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /添加 Agent/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "添加 Agent" });
  await dialog.getByLabel("名称").fill("拼装");
  const provider = dialog.getByRole("switch", {
    name: "在 拼装 中使用 Agent 核心",
  });
  await expect(provider).toBeChecked();
  await provider.click();
  await expect(dialog).toContainText("已关闭：它不会回复");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  const message = page.getByRole("textbox", { name: "消息", exact: true });
  await expect(message).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "此 Agent 已关闭「Agent 核心」，开启后它才会回复。",
  );
  await sidebarToggle(page).click();
  const details = page.getByRole("complementary", { name: "Agent 详情" });
  await details
    .getByRole("switch", { name: "在 拼装 中使用 Agent 核心" })
    .click();
  await details
    .getByRole("switch", { name: "在 拼装 中使用 默认 Agent 界面" })
    .click();
  await expect(details).toContainText("已关闭：不能在这里和它对话");
  await expect(page.getByRole("status")).toContainText(
    "此 Agent 已关闭「默认 Agent 界面」",
  );
  await page.getByRole("button", { name: "开启", exact: true }).click();
  await message.fill("hello");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("echo-a｜第 1 轮");
});
