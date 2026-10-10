import { it, expect } from "vitest";
import { _electron as electron, expect as uiExpect } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";

it("test-only chat UI handles empty history, pending replies, escaped content, errors and responsive widths", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-scenario-chat-ui-"),
  );
  await mkdir(path.resolve(".build-cache/scenarios"), { recursive: true });
  const file = path.resolve(
    "packages/host/test/fixtures/extensions/agent-loop/index.html",
  );
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  await writeFile(
    path.join(directory, "preload.cjs"),
    `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('plums',{invoke:(kind,name,input)=>ipcRenderer.invoke('fixture',kind,name,input)});`,
  );
  await writeFile(
    path.join(directory, "main.cjs"),
    `
    const {app,BrowserWindow,ipcMain}=require('electron');
    const history=[];
    ipcMain.handle('fixture',async (_event,kind,name,input)=>{
      if(kind!=='commands')throw Error('wrong kind');
      if(name==='history')return history;
      if(name!=='chat'||typeof input.text!=='string')throw Error('wrong input');
      await new Promise(resolve=>setTimeout(resolve,150));
      if(input.text==='failure')throw Error('synthetic failure');
      history.push({role:'user',content:input.text},{role:'assistant',content:'<script>window.executed=true</script> Synthetic reply'});
      return {message:history.at(-1)};
    });
    app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:900,height:800,webPreferences:{contextIsolation:true,nodeIntegration:false,preload:require('node:path').join(__dirname,'preload.cjs')}});w.loadFile(${JSON.stringify(file)});});
  `,
  );
  const application = await electron.launch({
    executablePath: require("electron"),
    args: [path.join(directory, "main.cjs")],
  });
  try {
    const page = await application.firstWindow();
    await uiExpect(page.getByRole("status")).toHaveText(
      "发送消息，开始测试对话。",
    );
    for (const width of [320, 375, 760, 1440]) {
      const windowHandle = await application.browserWindow(page);
      await windowHandle.evaluate(
        (w, size) => w.setContentSize(size, 800),
        width,
      );
      await uiExpect(page.getByRole("button", { name: "发送" })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: path.resolve(
          `.build-cache/scenarios/scenario-chat-ui-${width}.png`,
        ),
      });
    }
    await page
      .getByLabel("消息", { exact: true })
      .fill("<img src=x onerror=alert(1)> user text");
    await page.getByRole("button", { name: "发送" }).click();
    await uiExpect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    await uiExpect(page.getByRole("status")).toHaveText("回复已保存。");
    await uiExpect(page.getByRole("listitem")).toHaveCount(2);
    await uiExpect(page.getByRole("listitem").last()).toContainText(
      "<script>window.executed=true</script> Synthetic reply",
    );
    expect(await page.locator("#messages img, #messages script").count()).toBe(
      0,
    );
    expect(await page.evaluate(() => (window as any).executed)).toBeUndefined();
    await page.getByLabel("消息", { exact: true }).fill("failure");
    await page.getByRole("button", { name: "发送" }).click();
    await uiExpect(page.getByRole("status")).toContainText(
      "请求失败：FIXTURE_FAILED",
    );
    await uiExpect(page.getByLabel("消息", { exact: true })).toHaveValue(
      "failure",
    );
    await uiExpect(page.getByRole("button", { name: "发送" })).toBeEnabled();
    await uiExpect(page.getByRole("listitem")).toHaveCount(2);
    await page
      .getByLabel("消息", { exact: true })
      .fill("recovered".repeat(100));
    await page.getByRole("button", { name: "发送" }).click();
    await uiExpect(page.getByRole("status")).toHaveText("回复已保存。");
    await uiExpect(page.getByRole("listitem")).toHaveCount(4);
    await page.screenshot({
      path: path.resolve(
        ".build-cache/scenarios/scenario-chat-ui-conversation.png",
      ),
    });
    const windowHandle = await application.browserWindow(page);
    await windowHandle.evaluate((w) => w.setContentSize(320, 800));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.resolve(
        ".build-cache/scenarios/scenario-chat-ui-conversation-narrow.png",
      ),
    });
  } finally {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
