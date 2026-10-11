import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it("uses authoritative preparation reasons, preserves repair identifiers and drops outdated readiness replies", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-readiness-ui-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await build({
      stdin: {
        contents: `
          import React, {useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {AgentReadiness} from './packages/desktop/src/components/AgentReadiness.tsx';
          import {ComponentConfigDialog} from './packages/desktop/src/dialogs/ComponentConfigDialog.tsx';
          import {AgentSetup} from './packages/desktop/src/dialogs/AgentSetup.tsx';
          import {ManagerProvider} from './packages/desktop/src/state/ManagerStore.tsx';
          const state = window.fixture = {calls:[], pending:[], fixed:[]};
          window.manager = {onAgentState:()=>()=>{},onRefresh:()=>()=>{},call(method, args) {
            if(method==='tierPlan') return Promise.resolve({current:{grants:[],tier:{ceiling:'sandbox',projects:[],readOnly:[]}},selection:{ceiling:'sandbox',projects:[],readOnly:[],components:[]},entries:[]});
            if(method==='desktopSettings') return Promise.resolve({});
            if(method==='agentState') return Promise.resolve(null);
            if(['list','library','cacheStatus'].includes(method)) return Promise.resolve([]);
            state.calls.push({method,args});
            return new Promise((resolve,reject) => state.pending.push({resolve,reject}));
          }};
          const resources = [{id:'component',name:'Fixture component',enabled:true,
            settings:{values:{first:'saved'},secrets:{},schema:{required:['secret'],properties:{
              first:{type:'string',title:'First field'},
              'a/b~c':{type:'string',title:'Special field'},
              secret:{type:'string',title:'Secret field','x-secret':true}
            }}}}];
          const setupResources = [
            {id:'first',name:'First component',kind:'connector',manifest:{formatVersion:'2.0',permissions:[]},
              settings:{values:{},secrets:{},schema:{properties:{key:{type:'string',title:'First key','x-secret':true}},required:['key']}}},
            {id:'second',name:'Second component',kind:'extension',manifest:{formatVersion:'2.0',permissions:[]},
              settings:{values:{},secrets:{},schema:{properties:{mode:{type:'string',title:'Second mode'}},required:['mode']}}},
          ];
          function Fixture() {
            const [id,select]=useState('first'), [revision,reload]=useState(resources);
            const [config,showConfig]=useState(false), [errorPath,setErrorPath]=useState('');
            const [setup,showSetup]=useState(false), [setupError,setSetupError]=useState('');
            window.select=select; window.reload=()=>reload([...resources]);
            window.openConfig=()=>showConfig(true);
            window.openSetup=()=>{state.failSetup=true;state.started=0;showConfig(false);showSetup(true);setErrorPath('');};
            if(setup) return <ManagerProvider><AgentSetup record={{instanceId:'fixture',name:'Partial save',agent:{version:'1.0.0'}}}
              resources={setupResources} busy={false} error={setupError} errorPath={errorPath}
              onClose={()=>showSetup(false)} onEdit={()=>{}} onStart={async()=>{state.started++;}}
              onSave={async(id)=>{
                setSetupError('');setErrorPath('');
                if(id==='second' && state.failSetup) {
                  setSetupError('Second save failed');setErrorPath('/settings/mode');throw Error('fixture failure');
                }
              }}/></ManagerProvider>;
            if(config) return <ComponentConfigDialog resource={resources[0]} busy={false}
              error={errorPath ? 'Check the field' : ''} errorPath={errorPath}
              focusField="secret" onClose={()=>showConfig(false)}
              onSave={()=>setErrorPath('/settings/a~1b~0c')}/>;
            return <AgentReadiness instanceId={id} resources={revision} onFix={r=>state.fixed.push(r)}/>;
          }
          createRoot(document.getElementById('root')).render(<Fixture/>);
        `,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      outfile: path.join(dir, "renderer.js"),
      nodePaths: [path.resolve("packages/desktop/node_modules")],
      bundle: true,
      platform: "browser",
      jsx: "automatic",
    });
    await writeFile(
      path.join(dir, "index.html"),
      `<main id="root"></main><script src="./renderer.js"></script>`,
    );
    await writeFile(
      path.join(dir, "main.cjs"),
      `const{app,BrowserWindow}=require('electron');app.setPath('userData',__dirname);app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadFile(__dirname+'/index.html')});`,
    );
    const require = createRequire(
      path.resolve("packages/desktop/package.json"),
    );
    app = await electron.launch({
      executablePath: require("electron"),
      args: [path.join(dir, "main.cjs")],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await page.waitForFunction(
      () => (window as any).fixture.pending.length === 1,
    );
    await page.evaluate(() => (window as any).select("second"));
    await page.waitForFunction(
      () => (window as any).fixture.pending.length === 2,
    );
    await page.evaluate(() =>
      (window as any).fixture.pending[1].resolve({
        evidence: "declared",
        prepared: false,
        reasons: [
          {
            code: "SETTINGS_REQUIRED",
            blocking: true,
            action: "settings",
            packageId: "component",
            field: "a/b~c",
          },
          {
            code: "PROTOCOL_REQUIRED",
            blocking: true,
            action: "connections",
            packageId: "component",
            requirementId: "protocol-slot",
          },
          {
            code: "PROJECT_UNAVAILABLE",
            blocking: true,
            action: "permissions",
            packageId: "component",
            engineId: "engine-entry",
          },
          { code: "RESOURCE_PAGE", blocking: false, action: "resources" },
        ],
      }),
    );
    await page.getByText("还有 3 项准备条件待处理", { exact: true }).waitFor();
    await page.evaluate(() =>
      (window as any).fixture.pending[0].resolve({
        evidence: "declared",
        prepared: true,
        reasons: [],
      }),
    );
    expect(
      await page.getByText("声明与准备条件已满足", { exact: true }).count(),
    ).toBe(0);
    expect(await page.getByText(/Special field/).count()).toBe(1);
    for (const label of ["填写配置", "查看连接", "查看权限", "查看资源"])
      await page.getByRole("button", { name: label, exact: true }).click();
    const fixes = await page.evaluate(() => (window as any).fixture.fixed);
    expect(
      fixes.map((r: any) => [r.field, r.requirementId, r.engineId]),
    ).toEqual([
      ["a/b~c", undefined, undefined],
      [undefined, "protocol-slot", undefined],
      [undefined, undefined, "engine-entry"],
      [undefined, undefined, undefined],
    ]);
    await page.getByRole("button", { name: "重新读取清单" }).click();
    await page.waitForFunction(
      () => (window as any).fixture.pending.length === 3,
    );
    await page.evaluate(() => (window as any).reload());
    await page.waitForFunction(
      () => (window as any).fixture.pending.length === 4,
    );
    await page.evaluate(() => {
      (window as any).fixture.pending[3].resolve({
        evidence: "declared",
        prepared: true,
        reasons: [],
      });
      (window as any).fixture.pending[2].reject(Error("outdated failure"));
    });
    await page.getByText("声明与准备条件已满足", { exact: true }).waitFor();
    expect(await page.getByRole("alert").count()).toBe(0);
    expect(await page.locator("body").innerText()).toContain(
      "不验证外部服务或调用成功",
    );
    await page.getByRole("button", { name: "重新读取清单" }).click();
    await page.waitForFunction(
      () => (window as any).fixture.pending.length === 5,
    );
    await page.evaluate(() =>
      (window as any).fixture.pending[4].reject(Error("fixture failure")),
    );
    await page.getByRole("alert").waitFor();
    expect(
      await page.getByText("声明与准备条件已满足", { exact: true }).count(),
    ).toBe(0);
    expect(
      await page.evaluate(() =>
        (window as any).fixture.calls.every(
          (c: any) =>
            c.method === "agentReadinessPlan" &&
            ["first", "second"].includes(c.args.instanceId),
        ),
      ),
    ).toBe(true);
    await page.evaluate(() => (window as any).openConfig());
    const secret = page.getByLabel("Secret field", { exact: true });
    await expect
      .poll(() => secret.evaluate((el) => el === document.activeElement))
      .toBe(true);
    await secret.fill("fake-credential-only-for-ui");
    const field = page.getByLabel("Special field", { exact: true });
    await field.fill("unsaved value");
    await page.getByRole("button", { name: "保存设置" }).click();
    await expect.poll(() => field.getAttribute("aria-invalid")).toBe("true");
    await expect
      .poll(() => field.evaluate((el) => el === document.activeElement))
      .toBe(true);
    expect(await field.inputValue()).toBe("unsaved value");
    expect(await secret.inputValue()).toBe("fake-credential-only-for-ui");
    expect(await secret.getAttribute("type")).toBe("password");
    expect(await page.locator("body").innerText()).not.toContain(
      "fake-credential-only-for-ui",
    );
    expect(await page.getByTestId("config-dialog").innerText()).toContain(
      "有未保存的修改",
    );
    expect(
      await field.evaluate(
        (el) => !!document.getElementById(el.getAttribute("aria-describedby")!),
      ),
    ).toBe(true);
    await page.evaluate(() => (window as any).openSetup());
    await page
      .getByLabel("First key", { exact: true })
      .fill("fake-partial-save-key");
    await page.getByLabel("Second mode", { exact: true }).fill("retained mode");
    await page.getByRole("button", { name: "开始使用" }).click();
    await page.getByText("Second save failed", { exact: true }).waitFor();
    const second = page.getByLabel("Second mode", { exact: true });
    await expect
      .poll(() => second.evaluate((el) => el === document.activeElement))
      .toBe(true);
    expect(
      await page.getByLabel("First key", { exact: true }).inputValue(),
    ).toBe("");
    expect(
      await page
        .getByLabel("First key", { exact: true })
        .evaluate((el) => (el as HTMLInputElement).required),
    ).toBe(false);
    expect(await second.inputValue()).toBe("retained mode");
    expect(await page.getByTestId("setup-dialog").innerText()).toContain(
      "1 个组件有未保存的修改",
    );
    expect(await page.evaluate(() => (window as any).fixture.started)).toBe(0);
    await page.evaluate(() => {
      (window as any).fixture.failSetup = false;
    });
    await page.getByRole("button", { name: "开始使用" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).fixture.started))
      .toBe(1);
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
