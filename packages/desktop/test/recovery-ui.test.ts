import { expect, it } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

it("shows actual data locations and backup boundaries and awaits broker shutdown when quitting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-recovery-ui-"));
  const application = path.join(root, "application");
  const profile = path.join(
    root,
    "synthetic-private-profile-with-a-long-name-for-narrow-layout",
  );
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(profile);
    await cp(
      path.resolve("packages/desktop/dist"),
      path.join(application, "dist"),
      { recursive: true },
    );
    await writeFile(
      path.join(application, "package.json"),
      '{"type":"module"}',
    );
    // Use the production main/preload/renderer and a deterministic delayed-close broker.
    await writeFile(
      path.join(application, "dist/broker.mjs"),
      `
      import {writeFileSync} from 'node:fs';import path from 'node:path';
      const marker=path.join(process.env.PLUMS_DATA_DIR,'shutdown-marker');let theme='light';
      process.on('message',m=>{
        if(m.type!=='request')return;
        if(m.method==='setDesktopTheme')theme=m.args.theme;
        const value=['list','library','cacheStatus','listFoundations'].includes(m.method)?[]:
          m.method==='desktopSettings'?{theme,dnsMode:'auto'}:null;
        process.send({type:'reply',id:m.id,ok:true,value});
      });
      process.on('disconnect',()=>{
        writeFileSync(marker,'closing');
        setTimeout(()=>{writeFileSync(marker,'closed');process.exit(0);},250);
      });
      process.send({type:'ready'});
    `,
    );
    const require = createRequire(
      path.resolve("packages/desktop/package.json"),
    );
    app = await electron.launch({
      executablePath: require("electron"),
      args: [path.join(application, "dist/main.js")],
      env: {
        ...process.env,
        PLUMS_DATA_DIR: profile,
        PLUMS_NODE: process.execPath,
      },
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await page.emulateMedia({ colorScheme: null });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const section = page.getByTestId("data-recovery");
    await section.getByText(profile, { exact: true }).first().waitFor();
    expect(await section.innerText()).toContain("活动批准须重新确认");
    expect(await section.innerText()).toContain("不能保证全部回收");
    expect(await section.innerText()).toContain("Agent ZIP");
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: "外观主题", exact: true }).click();
      await page.getByRole("option", { name: theme, exact: true }).click();
      await page.waitForFunction(
        (dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark,
        theme === "深色",
      );
      for (const width of [1180, 760, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const button = section.getByRole("button", { name: "退出应用再备份" });
        await button.focus();
        expect(
          await button.evaluate(
            (element) => element === document.activeElement,
          ),
        ).toBe(true);
        const screenshots = process.env.PLUMS_RECOVERY_SCREENSHOTS;
        if (screenshots) {
          await mkdir(screenshots, { recursive: true });
          await page.screenshot({
            path: path.join(
              screenshots,
              `recovery-${theme === "浅色" ? "light" : "dark"}-${width}.png`,
            ),
            fullPage: true,
          });
        }
      }
    }
    await app.close();
    app = undefined;
    expect(await readFile(path.join(profile, "shutdown-marker"), "utf8")).toBe(
      "closed",
    );
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
