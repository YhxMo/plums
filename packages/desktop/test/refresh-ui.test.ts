import { expect, it } from "vitest";
import { _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

it("measures polling and refresh bursts and isolates delayed task and manager replies", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-refresh-ui-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  const baseline = process.env.PLUMS_REFRESH_BASELINE === "1";
  const metrics: Record<string, unknown> = {};
  try {
    await build({
      stdin: {
        contents: `
          import React, {useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {ControlledTasks} from './packages/desktop/src/components/ControlledTasks.tsx';
          import {ManagerProvider,useManagerStore} from './packages/desktop/src/state/ManagerStore.tsx';
          const f=window.fixture={calls:[],pending:[],hold:false,hidden:false};
          Object.defineProperty(document,'hidden',{get:()=>f.hidden});
          Object.defineProperty(document,'visibilityState',{get:()=>f.hidden?'hidden':'visible'});
          window.manager={onAgentState:()=>()=>{},onRefresh:fn=>{f.refresh=fn;return()=>{};},call(method,args){
            f.calls.push({method,args});
            const value=method==='commonTasks'?(f.taskRows??[]):
              method==='list'?[{instanceId:'first'},{instanceId:'second'}]:
              method==='resources'?{record:{instanceId:args.instanceId,name:args.instanceId},packages:[]}:
              method==='library'?[]:method==='desktopSettings'?{}:null;
            if((f.hold && ['commonTasks','list'].includes(method)) || (f.holdMutation && method==='setComponentBackground'))
              return new Promise((resolve,reject)=>f.pending.push({method,args,resolve,reject,value}));
            return Promise.resolve(value);
          }};
          const resources=[{id:'fixture',name:'Fixture',manifest:{permissions:[],payload:{plumsDesktop:{common:{background:true}}}}}];
          function Tasks(){const[id,select]=useState('first'),[items,setItems]=useState(resources);f.select=select;f.drop=()=>setItems([]);
            return <ControlledTasks key={'tasks:'+id} record={{instanceId:id,roots:{}}} resources={items}/>;}
          function Manager(){const{state,load}=useManagerStore();f.load=load;
            return <p>{state.record?.name??'loading'} {state.loadError}</p>;}
          const root=createRoot(document.getElementById('root'));
          f.start=mode=>root.render(mode==='tasks'?<Tasks/>:<ManagerProvider><Manager/></ManagerProvider>);
          f.visibility=hidden=>{f.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));};
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
      '<main id="root"></main><script src="./renderer.js"></script>',
    );
    await writeFile(
      path.join(dir, "main.cjs"),
      "const{app,BrowserWindow}=require('electron');app.setPath('userData',__dirname);app.whenReady().then(()=>new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}).loadFile(__dirname+'/index.html'));",
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
    await page.clock.install();
    await page.evaluate(() => (window as any).fixture.start("tasks"));
    await page.getByText("当前没有受控任务。").waitFor();
    await page.clock.runFor(10_000);
    metrics.emptyTaskReads = await page.evaluate(
      () =>
        (window as any).fixture.calls.filter(
          (c: any) => c.method === "commonTasks",
        ).length,
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.visibility(true);
      f.calls = [];
    });
    await page.clock.runFor(10_000);
    metrics.hiddenTaskReads = await page.evaluate(
      () => (window as any).fixture.calls.length,
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.hold = true;
      f.visibility(false);
    });
    // Existing interval polling needs a tick; visibility-aware polling reads immediately.
    await page.clock.runFor(1000);
    await page.waitForFunction(
      () => (window as any).fixture.pending.length > 0,
    );
    await page.clock.runFor(3000);
    metrics.overlappingTaskReads = await page.evaluate(
      () => (window as any).fixture.pending.length,
    );
    await page.evaluate(() => (window as any).fixture.select("second"));
    await page.waitForFunction(() =>
      (window as any).fixture.pending.some(
        (p: any) => p.args.instanceId === "second",
      ),
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      for (const p of f.pending.filter(
        (p: any) => p.args.instanceId === "second",
      ))
        p.resolve([]);
      for (const p of f.pending.filter(
        (p: any) => p.args.instanceId === "first",
      ))
        p.reject(Error("outdated task failure"));
      f.pending = [];
      f.hold = false;
    });
    await page.getByText("当前没有受控任务。").waitFor();
    expect(await page.getByRole("alert").count()).toBe(0);
    if (!baseline) {
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.taskRows = [
          {
            description: {
              taskId: "synthetic-task",
              owner: { componentId: "fixture" },
              lifetime: "agent",
            },
            snapshot: {
              status: { state: "running", executionState: "not_started" },
            },
            takeoverCandidates: [],
          },
        ];
      });
      await page.getByRole("button", { name: "刷新任务状态" }).click();
      await page.getByRole("button", { name: "停止任务" }).waitFor();
      await page.evaluate(() => {
        (window as any).fixture.calls = [];
      });
      await page.clock.runFor(3000);
      metrics.activeTaskReads = await page.evaluate(
        () => (window as any).fixture.calls.length,
      );
      expect(metrics.activeTaskReads).toBe(3);
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.hold = true;
        f.holdMutation = true;
      });
      await page.clock.runFor(1000);
      await page.waitForFunction(
        () => (window as any).fixture.pending.length === 1,
      );
      await page.getByRole("checkbox").check();
      await page.waitForFunction(
        () => (window as any).fixture.pending.length === 2,
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.pending[0].reject(Error("outdated pre-mutation failure"));
        f.pending[1].resolve(null);
      });
      await page.waitForFunction(
        () => (window as any).fixture.pending.length === 3,
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.taskRows = [];
        f.pending[2].resolve([]);
        f.pending = [];
        f.hold = false;
      });
      await page.getByText("当前没有受控任务。").waitFor();
      await expect
        .poll(() => page.getByRole("checkbox").isEnabled())
        .toBe(true);
      expect(await page.getByRole("alert").count()).toBe(0);
      await page.getByRole("checkbox").uncheck();
      await page.waitForFunction(
        () => (window as any).fixture.pending.length === 1,
      );
      await page.evaluate(() => {
        const f = (window as any).fixture;
        f.pending[0].reject(Error("mutation failed"));
        f.holdMutation = false;
      });
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("checkbox").isChecked()).toBe(true);
      expect(await page.getByRole("alert").innerText()).toContain("核实结果");
      await page.evaluate(() => {
        (window as any).fixture.pending = [];
      });
      await page.evaluate(() => (window as any).fixture.drop());
      await expect
        .poll(() => page.getByTestId("controlled-tasks").count())
        .toBe(0);
    }
    await page.evaluate(() => (window as any).fixture.start("manager"));
    await page.getByText("first", { exact: true }).waitFor();
    await page.evaluate(() => {
      const f = (window as any).fixture;
      f.calls = [];
      f.hold = true;
      for (let n = 0; n < 20; n++) f.refresh();
    });
    await page.waitForFunction(
      () => (window as any).fixture.pending.length > 0,
    );
    metrics.burstInitialLists = await page.evaluate(
      () =>
        (window as any).fixture.calls.filter((c: any) => c.method === "list")
          .length,
    );
    await page.evaluate(() => {
      const f = (window as any).fixture;
      void f.load("second");
      f.hold = false;
      for (const p of f.pending) p.resolve(p.value);
    });
    await page.getByText("second", { exact: true }).waitFor();
    metrics.burstTotalLists = await page.evaluate(
      () =>
        (window as any).fixture.calls.filter((c: any) => c.method === "list")
          .length,
    );
    if (!baseline) {
      expect(metrics.emptyTaskReads).toBeLessThanOrEqual(3);
      expect(metrics.hiddenTaskReads).toBe(0);
      expect(metrics.overlappingTaskReads).toBe(1);
      expect(metrics.burstInitialLists).toBe(1);
      expect(metrics.burstTotalLists).toBe(2);
    }
    const report = process.env.PLUMS_REFRESH_REPORT;
    if (report) {
      await mkdir(path.dirname(report), { recursive: true });
      await writeFile(
        report,
        JSON.stringify({ baseline, metrics }, null, 2) + "\n",
      );
    }
  } finally {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
