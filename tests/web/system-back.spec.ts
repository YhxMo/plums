import { expect, test, type Page } from "@playwright/test";
import { manage, legacyEntry } from "./helpers";

const back = (page: Page) =>
  page.evaluate(() =>
    window.dispatchEvent(new Event("plums:back", { cancelable: true })),
  );

async function createAgent(page: Page) {
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("Back probe");
  await page.getByLabel("允许多个会话").check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
}

for (const width of [375, 1180]) {
  test(`system Back returns from management without losing a draft at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    await createAgent(page);
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("unsent draft");
    await manage(page);
    expect(await back(page)).toBe(false);
    await expect(page.getByRole("button", { name: "返回工作区" })).toBeHidden();
    await expect(input).toHaveValue("unsent draft");
    if (width === 375) {
      expect(await back(page)).toBe(false);
      const agent = page.getByRole("button", {
        name: "与 Back probe 交互",
        exact: true,
      });
      await expect(agent).toBeVisible();
      await expect(agent).toBeFocused();
      expect(await back(page)).toBe(true);
      await agent.click();
      await expect(input).toHaveValue("unsent draft");
    } else expect(await back(page)).toBe(true);
  });
}

test("system Back dismisses only the top dialog and returns focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 820 });
  await page.goto("/");
  await createAgent(page);
  const trigger = page.getByRole("button", { name: "查看 Agent 详情" });
  await trigger.click();
  const detail = page.getByRole("dialog", { name: "Agent 详情", exact: true });
  const remove = detail.getByRole("button", {
    name: "删除会话 未命名会话",
    exact: true,
  });
  await remove.click();
  expect(await back(page)).toBe(false);
  await expect(
    page.getByRole("dialog", { name: "删除会话", exact: true }),
  ).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(remove).toBeFocused();
  expect(await back(page)).toBe(false);
  await expect(detail).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const throws of [false, true]) {
  test(`workspace Back keeps its receiver and isolates failures (${throws})`, async ({
    page,
  }) => {
    await page.route("**/back-probe.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export default {
        manifest:{id:'back.probe',version:'1.0.0',apiVersion:1},
        activate(ctx) {
          const output=document.createElement('output');
          const state={title:'Receiver',back() {
            if(this.title!=='Receiver') throw Error('lost receiver');
            ${throws ? "throw Error('back failure');" : "output.textContent='receiver preserved';"}
          }};
          ctx.view({id:'back-probe',label:'Back probe',chrome:{getSnapshot:()=>state,subscribe:()=>()=>{}},
            mount(root){root.append(output);return ()=>output.remove();}});
        }
      };`,
      }),
    );
    await page.goto("/");
    await manage(page);
    await page.getByRole("button", { name: "安装扩展", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "安装扩展" });
    await dialog.getByLabel("扩展 ID", { exact: true }).fill("back.probe");
    await dialog.getByLabel("模块路径", { exact: true }).fill("/back-probe.js");
    await dialog.getByRole("button", { name: "加载模块", exact: true }).click();
    await page
      .getByRole("button", { name: "启用 back.probe", exact: true })
      .click();
    await page.getByRole("button", { name: "返回工作区" }).click();
    expect(await back(page)).toBe(false);
    if (throws) {
      await expect(page.getByText(/back failure/).first()).toBeVisible();
      expect(await back(page)).toBe(true);
    } else {
      await expect(page.locator("output")).toHaveText("receiver preserved");
      await manage(page);
      await page
        .getByRole("button", { name: "停用 back.probe", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "启用 back.probe", exact: true }),
      ).toBeEnabled();
      await expect(page.locator("output")).toHaveCount(0);
      expect(await back(page)).toBe(false);
      await expect(
        page.getByRole("button", { name: "返回工作区" }),
      ).toBeHidden();
      expect(await back(page)).toBe(true);
    }
  });
}

test("system Back dismisses menu, then authorization, without granting", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "应用菜单", exact: true });
  await trigger.click();
  expect(await back(page)).toBe(false);
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(trigger).toBeFocused();
  const launch = await legacyEntry(page);
  await launch.click();
  expect(await back(page)).toBe(false);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(launch).toBeFocused();
  await expect(page.getByRole("button", { name: "返回工作区" })).toBeVisible();
  expect(await back(page)).toBe(false);
  await expect(page.getByRole("button", { name: "返回工作区" })).toBeHidden();
  expect(await back(page)).toBe(true);
});
