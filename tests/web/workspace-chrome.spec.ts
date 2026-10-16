import { expect, test, type Page } from "@playwright/test";
import { manage } from "./helpers";

async function install(page: Page, id: string) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await page.getByLabel("扩展 ID", { exact: true }).fill(id);
  await page.getByLabel("模块路径", { exact: true }).fill(`/${id}.js`);
  await page.getByRole("button", { name: "加载模块", exact: true }).click();
  await page.getByRole("button", { name: `启用 ${id}`, exact: true }).click();
}

test("workspace-owned chrome publishes titles, scopes sidebars, and releases on stop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of ["test.unrelated", "test.context"])
    await page.route(`**/${id}.js`, (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export default {
          manifest: {id:"${id}",version:"1",apiVersion:1},
          activate(ctx) {
            ctx.view({id:"${id}.sidebar",label:"${id}",presentation:"sidebar",
              mount(root) {root.textContent="${id} sidebar";return()=>root.replaceChildren();}});
          }
        };`,
      }),
    );
  await page.route("**/test.workspace.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export default {
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
    }),
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
  await expect(topbar).not.toContainText("更新后的任务标题");
  await expect(
    page.getByRole("complementary", { name: "test.context", exact: true }),
  ).toHaveCount(0);
});

for (const failure of ["snapshot", "subscribe", "notification"]) {
  test(`a workspace chrome ${failure} failure preserves host recovery`, async ({
    page,
  }) => {
    await page.route("**/test.broken.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export default {
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
      }),
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
      page.getByRole("heading", { name: "扩展与状态" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "欢迎使用 Plums" }),
    ).toBeVisible();
    await expect(page.getByRole("banner")).not.toContainText("工作区故障夹具");
  });
}

test("Agent links never reveal an entity in an unrelated workspace", async ({
  page,
}) => {
  await page.route("**/test.tasks.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export default {
        manifest:{id:"test.tasks",version:"1",apiVersion:1},
        activate(ctx) {
          const reveal=id=>{document.body.dataset.wrongReveal=id};
          const state={title:"任务工作区"};
          ctx.view({id:"test.tasks",label:"任务工作区",chrome:{
            getSnapshot(){return state},subscribe(){return()=>{}},
            reveal,navigation:{entityType:"test.task",reveal}
          },mount(root){root.textContent="任务正文";return()=>root.replaceChildren()}});
        }
      };`,
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("代码助手");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await install(page, "test.tasks");
  await page
    .locator("#extension-manager article")
    .filter({ hasText: "本地 Agent 提供者" })
    .click();
  const reveal = page.getByRole("button", { name: "跳转到 Agent →" }).first();
  await expect(reveal).toBeDisabled();
  await expect(reveal).toHaveAttribute(
    "title",
    "当前工作区不支持 Agent 导航，请先切换到 Agent 界面",
  );
  await expect(page.locator("body")).not.toHaveAttribute("data-wrong-reveal");
});

for (const scenario of ["resize", "dynamic"]) {
  test(`contextual and default details stay exclusive after ${scenario}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: scenario === "resize" ? 375 : 1440,
      height: 900,
    });
    await page.route("**/test.agents.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `export default {
          manifest:{id:"test.agents",version:"1",apiVersion:1,provides:{agents:1}},
          activate(ctx){
            const agents=[{id:"external",name:"外部角色",description:"侧栏夹具",status:"idle",
              pinned:false,extensionId:"test.agents",capabilities:[],multiSession:false,
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
      }),
    );
    await page.goto("/");
    await manage(page);
    await page
      .getByRole("button", { name: "停用 agents.local", exact: true })
      .click();
    await install(page, "test.agents");
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await page
      .getByRole("button", { name: "与 外部角色 交互", exact: true })
      .click();
    if (scenario === "resize") {
      await page.getByRole("button", { name: "查看 Agent 详情" }).click();
      await expect(
        page.getByRole("dialog", { name: "Agent 详情" }),
      ).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
    } else {
      await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
      await expect(
        page.getByRole("complementary", { name: "Agent 详情" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "应用菜单", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "侧栏贡献控制", exact: true })
        .click();
      await page.getByRole("button", { name: "注册上下文侧栏" }).click();
      await page
        .getByRole("dialog", { name: "侧栏贡献控制" })
        .getByRole("button", { name: "关闭", exact: true })
        .click();
    }
    await expect(
      page.getByRole("complementary", { name: "Agent 详情" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    await expect(
      page.getByRole("complementary", { name: "外部角色上下文" }),
    ).toContainText("扩展专属详情");
    await expect(
      page.getByRole("complementary", { name: "Agent 详情" }),
    ).toHaveCount(0);
  });
}
