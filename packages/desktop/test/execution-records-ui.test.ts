import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

it("distinguishes failed completed calls, unknown results and explicit retry guidance with accessible recovery details", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-execution-ui-"));
  const root = process.cwd();
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await build({
      stdin: {
        contents: `
          import React from 'react';
          import {createRoot} from 'react-dom/client';
          import {ExecutionRecordList} from './packages/desktop/src/components/ExecutionRecordList.tsx';
          const event=(callId,phase,outcome,executionState)=>({callId,phase,outcome,executionState,timestamp:'2026-10-11T00:00:00Z',extensionId:'fixture',kind:'fs',operation:'write',data:'must-not-display'});
          createRoot(document.getElementById('root')).render(<ExecutionRecordList resources={[]} events={[
            event('completed-call','allow','allowed','not_started'),
            event('completed-call','result','failed','completed'),
            event('unknown-call','result','failed','unknown'),
            event('error-call','result','error','unknown'),
            event('not-started-call','denied','denied','not_started')
          ]}/>);
        `,
        resolveDir: root,
        loader: "tsx",
      },
      outfile: path.join(dir, "renderer.js"),
      nodePaths: [path.join(root, "packages/desktop/node_modules")],
      bundle: true,
      platform: "browser",
      jsx: "automatic",
    });
    const styles = ["tokens", "base", "components"]
      .map(
        (file) =>
          `<link rel="stylesheet" href="${pathToFileURL(path.join(root, "packages/desktop/src/styles", file + ".css"))}">`,
      )
      .join("");
    await writeFile(
      path.join(dir, "index.html"),
      `${styles}<main id="root"></main><script src="./renderer.js"></script>`,
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
    const records = page.locator(".execution-records > li");
    await expect.poll(() => records.count()).toBe(4);
    const completed = records.filter({
      hasText: "操作已执行，后续处理可能失败",
    });
    expect(await completed.innerText()).toContain("未完成");
    expect(await completed.innerText()).toContain("请勿自动重试");
    const summary = completed.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    expect(
      await completed
        .locator("details")
        .evaluate((el) => (el as HTMLDetailsElement).open),
    ).toBe(true);
    expect(await completed.locator("code").innerText()).toBe("completed-call");
    expect(
      await completed.locator(".execution-stages li").allTextContents(),
    ).toEqual(["allow · allowed · not_started", "result · failed · completed"]);
    expect(await page.locator("body").innerText()).not.toContain(
      "must-not-display",
    );
    expect(
      await page
        .getByText("操作可能已经执行，结果未知", { exact: false })
        .count(),
    ).toBe(2);
    expect(
      await page
        .getByText("修复配置或权限后，由你明确发起重试。", { exact: false })
        .count(),
    ).toBe(1);
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      for (const width of [1180, 760, 375, 320]) {
        await page.setViewportSize({ width, height: 850 });
        expect(
          await page
            .locator(".execution-records")
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        ).toBe(false);
        const output = path.join(root, ".build-cache/phase2/execution-ui");
        await mkdir(output, { recursive: true });
        await page.screenshot({
          path: path.join(output, `${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
  } finally {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
