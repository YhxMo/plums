import { expect, test, type Page } from "@playwright/test";
import { addAgent, manage, installByPath, serveModule } from "./helpers";

async function install(page: Page, id: string) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, `/${id}/`);
  await page.getByRole("button", { name: `启用 ${id}`, exact: true }).click();
}

test("workspace-owned chrome publishes titles, scopes sidebars, and releases on stop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of ["test.unrelated", "test.context"])
    await serveModule(
      page,
      id,
      `export default {
          manifest: {id:"${id}",version:"1",apiVersion:1},
          activate(ctx) {
            ctx.view({id:"${id}.sidebar",label:"${id}",presentation:"sidebar",
              mount(root) {root.textContent="${id} sidebar";return()=>root.replaceChildren();}});
          }
        };`,
    );
  await serveModule(
    page,
    "test.workspace",
    `export default {
        manifest:{id:"test.workspace",version:"1",apiVersion:1},
        activate(ctx) {
          let state={title:"扩展任务标题",contextOwner:"test.context"};
          const listeners=new Set();
          const chrome={
            getSnapshot(){return state},
            subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}
          };
          ctx.view({id:"test.workspace",label:"测试工作区",chrome,
            mount(root){
              const button=document.createElement("button");button.textContent="更新工作区标题";
              button.onclick=()=>{state={...state,title:"更新后的任务标题"};listeners.forEach(fn=>fn())};
              root.append(button);return()=>root.replaceChildren();
            }
          });
        }
      };`,
  );
  await page.goto("/");
  await install(page, "test.unrelated");
  await install(page, "test.context");
  await install(page, "test.workspace");
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  const topbar = page.getByRole("banner");
  await expect(topbar).toContainText("扩展任务标题");
  await page.getByRole("button", { name: "更新工作区标题" }).click();
  await expect(topbar).toContainText("更新后的任务标题");
  await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
  await expect(
    page.getByRole("complementary", { name: "test.context", exact: true }),
  ).toContainText("test.context sidebar");
  await expect(
    page.getByRole("complementary", { name: "test.unrelated", exact: true }),
  ).toHaveCount(0);
  await manage(page);
  await page
    .getByRole("button", { name: "停用 test.workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(topbar.filter({ hasText: "更新后的任务标题" })).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "test.context", exact: true }),
  ).toHaveCount(0);
});

for (const failure of ["snapshot", "subscribe", "notification"]) {
  test(`a workspace chrome ${failure} failure preserves host recovery`, async ({
    page,
  }) => {
    await serveModule(
      page,
      "test.broken",
      `export default {
          manifest:{id:"test.broken",version:"1",apiVersion:1},
          activate(ctx) {
            let broken=${failure === "snapshot"};
            let listener;
            const state={title:"工作区故障夹具"};
            ctx.view({id:"test.broken",label:"故障工作区",chrome:{
              getSnapshot(){if(broken)throw Error("chrome snapshot failed");return state},
              subscribe(fn){
                ${failure === "subscribe" ? 'throw Error("chrome subscribe failed");' : "listener=fn;return()=>{listener=undefined};"}
              }
            },mount(root){
              const button=document.createElement("button");button.textContent="触发标题读取失败";
              button.onclick=()=>{broken=true;listener?.()};
              root.append(button);return()=>root.replaceChildren();
            }});
          }
        };`,
    );
    await page.goto("/");
    await install(page, "test.broken");
    if (failure === "notification") {
      await page
        .getByRole("button", { name: "返回工作区", exact: true })
        .click();
      await page.getByRole("button", { name: "触发标题读取失败" }).click();
    }
    await expect(page.getByRole("alert")).toContainText("chrome");
    await manage(page);
    await expect(
      page.getByRole("heading", { name: "扩展", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "还没有 Agent" }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").filter({ hasText: "工作区故障夹具" }),
    ).toHaveCount(0);
  });
}

for (const scenario of ["resize", "dynamic"]) {
  test(`an Agent's own details keep the sidebar button after ${scenario}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: scenario === "resize" ? 375 : 1440,
      height: 900,
    });
    await serveModule(
      page,
      "test.agents",
      `export default {
          manifest:{id:"test.agents",version:"1",apiVersion:1,provides:{agents:1}},
          activate(ctx){
            const agents=[{id:"external",name:"外部角色",description:"侧栏夹具",status:"idle",
              pinned:false,extensionId:"test.agents",
              currentSessionId:"s",sessions:[{id:"s",title:"外部会话",createdAt:1,lastMessageAt:1,messages:[]}]}];
            ctx.provide("agents",1,{
              info:{label:"外部提供者",version:"1",description:"上下文详情"},
              list(){return agents},subscribe(){return()=>{}}
            });
            const contribute=()=>ctx.view({
              id:"test.contextual",label:"外部角色上下文",presentation:"sidebar",
              mount(root){root.textContent="扩展专属详情";return()=>root.replaceChildren()}
            });
            ${scenario === "resize" ? "contribute();" : ""}
            ctx.view({id:"test.control",label:"侧栏贡献控制",presentation:"dialog",mount(root){
              const button=document.createElement("button");button.textContent="注册上下文侧栏";
              button.onclick=contribute;root.append(button);return()=>root.replaceChildren();
            }});
          }
        };`,
    );
    await page.goto("/");
    await manage(page);
    await page
      .getByRole("button", { name: "停用 agents.local", exact: true })
      .click();
    await install(page, "test.agents");
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await page.getByRole("button", { name: "外部角色", exact: true }).click();
    const toggle = page.getByRole("button", { name: "展开或收起右侧栏" });
    const details = page.getByRole("complementary", { name: "Agent 详情" });
    if (scenario === "resize") {
      // The provider's contribution does not take the button over.
      await toggle.click();
      await expect(
        page.getByRole("dialog", { name: "Agent 详情" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
    } else {
      await toggle.click();
      await expect(details).toBeVisible();
      await manage(page);
      await page
        .getByRole("button", { name: "打开 侧栏贡献控制", exact: true })
        .click();
      await page.getByRole("button", { name: "注册上下文侧栏" }).click();
      await page
        .getByRole("dialog", { name: "侧栏贡献控制" })
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page
        .getByRole("button", { name: "返回工作区", exact: true })
        .click();
    }
    await expect(details).toBeVisible();
    await toggle.click();
    await expect(details).toHaveCount(0);
    await toggle.click();
    await expect(details).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "外部角色上下文" }),
    ).toHaveCount(0);
  });
}

for (const width of [375, 1180]) {
  test(`ordinary chrome samples install through public paths at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    for (const name of ["workspace-context", "workspace-chrome"]) {
      await manage(page);
      await page.getByRole("button", { name: "安装扩展", exact: true }).click();
      await installByPath(page, `/examples/${name}/`);
      await page
        .getByRole("button", { name: `启用 example.${name}`, exact: true })
        .click();
    }
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(page.getByRole("banner")).toContainText("外部任务 · 1");
    await page
      .getByRole("button", { name: "更新任务标题", exact: true })
      .click();
    await expect(page.getByRole("banner")).toContainText("外部任务 · 2");
    await page
      .getByLabel("任务草稿", { exact: true })
      .fill("keep external draft");
    await page
      .getByRole("button", { name: "打开扩展管理", exact: true })
      .click();
    await expect(
      page.getByLabel("任务草稿", { exact: true }),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(page.getByLabel("任务草稿", { exact: true })).toHaveValue(
      "keep external draft",
    );
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    await expect(
      page.getByRole("complementary", { name: "实体侧栏", exact: true }),
    ).toContainText("实体拥有的上下文");
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    await page
      .getByRole("button", { name: "切换上下文归属", exact: true })
      .click();
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    await expect(
      page.getByRole("complementary", { name: "工作区侧栏", exact: true }),
    ).toContainText("工作区拥有的上下文");
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    await page
      .getByRole("button", { name: "模拟标题回调失败", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "workspace chrome sample failure",
    );
    await manage(page);
    await expect(
      page.getByRole("heading", { name: "扩展", exact: true }),
    ).toBeVisible();
  });
}

test("icon-only buttons keep their icon centred on phones and desktop", async ({
  page,
}) => {
  const offCentre = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("button")].flatMap((button) => {
        const icon = button.querySelector(":scope > svg");
        const box = button.getBoundingClientRect();
        if (!icon || button.textContent?.trim() || !box.width) return [];
        const inner = icon.getBoundingClientRect();
        const dx = inner.x + inner.width / 2 - (box.x + box.width / 2);
        const dy = inner.y + inner.height / 2 - (box.y + box.height / 2);
        return Math.abs(dx) > 1 || Math.abs(dy) > 1
          ? [button.getAttribute("aria-label")]
          : [];
      }),
    );
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  await addAgent(page, "手机");
  await expect(
    page.getByRole("button", { name: "更多操作", exact: true }),
  ).toBeVisible();
  expect(await offCentre()).toEqual([]);
  await manage(page);
  expect(await offCentre()).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await offCentre()).toEqual([]);
});

for (const width of [375, 700, 1280]) {
  test(`one sidebar button toggles details; the more menu holds Agent actions at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/");
    await addAgent(page, "菜单");
    const details = page.getByRole(width < 652 ? "dialog" : "complementary", {
      name: "Agent 详情",
    });
    await expect(page.getByRole("button", { name: /详情/ })).toHaveCount(0);
    const more = page.getByRole("button", { name: "更多操作", exact: true });
    await more.click();
    const menu = page.getByRole("menu", { name: "更多操作" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "置顶",
      "重命名",
      "移除 Agent",
    ]);
    await menu.getByRole("menuitem", { name: "重命名" }).click();
    await expect(page.getByRole("dialog", { name: /重命名/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    const toggle = page.getByRole("button", {
      name: "展开或收起右侧栏",
      exact: true,
    });
    await toggle.click();
    await expect(details).toBeVisible();
    if (width >= 652) {
      // A drawer above the chat that leaves it usable.
      await expect(
        page.getByRole("dialog", { name: "Agent 详情" }),
      ).toHaveAttribute("aria-modal", "false");
      await page.getByRole("textbox", { name: "消息", exact: true }).fill("在");
      await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
      await expect(details).toBeVisible();
      await toggle.click();
      await expect(details).toHaveCount(0);
    }
  });
}
