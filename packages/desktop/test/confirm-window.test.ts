import { it, expect } from "vitest";
import {
  _electron as electron,
  expect as uiExpect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

it(
  "isolates confirmation, defaults to deny, validates sender and token, and cancels queued or active requests",
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "plums-confirm-test-"),
    );
    const base = path.resolve("packages/desktop/dist");
    await writeFile(
      path.join(directory, "main.cjs"),
      `const {app,BrowserWindow}=require('electron'); app.setPath('userData',__dirname); app.whenReady().then(async()=>{const {ConfirmPrompter}=await import(${JSON.stringify(pathToFileURL(path.join(base, "confirm-window.js")).href)}); const parent=new BrowserWindow({show:true,webPreferences:{preload:${JSON.stringify(path.join(base, "confirm-preload.cjs"))},sandbox:true,contextIsolation:true,nodeIntegration:false}}); global.confirmSheetAttached=false;parent.on('sheet-begin',()=>{global.confirmSheetAttached=true;});parent.on('sheet-end',()=>{global.confirmSheetAttached=false;}); await parent.loadURL('about:blank'); const prompter=new ConfirmPrompter(parent,${JSON.stringify(base)}); global.confirmResults={}; global.confirmControllers={}; global.askConfirmation=(id,kind='capability')=>{const controller=new AbortController();global.confirmControllers[id]=controller; void prompter.ask({kind,subject:id,action:'把数据发送到 example.com。',host:'example.com',reason:'测试说明',...(kind==='task'?{scopeOptions:[{key:'read',label:'读取项目'}]}:{})},controller.signal).then(value=>global.confirmResults[id]=value);}; global.prompter=prompter;});`,
    );
    const require = createRequire(
      path.resolve("packages/desktop/package.json"),
    );
    const application = await electron.launch({
      executablePath: require("electron"),
      args: [path.join(directory, "main.cjs")],
    });
    try {
      const parent = await application.firstWindow();
      await expect
        .poll(() =>
          application.evaluate(() => !!(globalThis as any).askConfirmation),
        )
        .toBe(true);
      const ask = async (id: string, kind = "capability") => {
        await expect
          .poll(
            () =>
              application
                .windows()
                .filter(
                  (page) =>
                    !page.isClosed() && page.url().endsWith("confirm.html"),
                ).length,
          )
          .toBe(0);
        if (process.platform === "darwin")
          await expect
            .poll(() =>
              application.evaluate(
                () => (globalThis as any).confirmSheetAttached,
              ),
            )
            .toBe(false);
        await parent.bringToFront();
        await application.evaluate(({ app }) => app.focus({ steal: true }));
        await expect
          .poll(
            () =>
              application.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()
                  .find((window) => window.getTitle() !== "Plums · 安全确认")
                  ?.isFocused(),
              ),
            { timeout: 5_000 },
          )
          .toBe(true);
        await application.evaluate(
          (_electron, { id, kind }) =>
            (globalThis as any).askConfirmation(id, kind),
          { id, kind },
        );
        return await findConfirmation(application, id);
      };
      const result = async (id: string) =>
        await application.evaluate(
          (_electron, id) => (globalThis as any).confirmResults[id],
          id,
        );
      const first = await ask("sender-test");
      if (process.platform === "darwin") {
        expect(
          await application.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows().find(
              (window) => window.getTitle() === "Plums · 安全确认",
            )!;
            return {
              titleInset: window.getContentBounds().y - window.getBounds().y,
              buttons: window.getWindowButtonPosition(),
            };
          }),
        ).toEqual({ titleInset: 0, buttons: { x: 14, y: 14 } });
      }
      expect(
        await first.locator(".confirmation-drag-region").evaluate((el) => ({
          height: el.getBoundingClientRect().height,
          region: getComputedStyle(el).getPropertyValue("-webkit-app-region"),
        })),
      ).toEqual({ height: 36, region: "drag" });
      expect(await first.locator("button.cta").count()).toBe(0);
      const data = await first.evaluate(() =>
        (window as any).confirmation.load(),
      );
      expect(
        await parent.evaluate(
          (data) => (window as any).confirmation.answer(data.token, true),
          data,
        ),
      ).toBe(false);
      expect(
        await first.evaluate(() =>
          (window as any).confirmation.answer("invalid", true),
        ),
      ).toBe(false);
      expect(
        await first.evaluate(
          (data) => (window as any).confirmation.answer(data.token, true),
          data,
        ),
      ).toBe(false);
      expect(
        await first.evaluate(() => ({
          node: typeof (window as any).require,
          manager: typeof (window as any).manager,
        })),
      ).toEqual({ node: "undefined", manager: "undefined" });
      await uiExpect(
        first.getByRole("button", { name: "不允许", exact: true }),
      ).toBeFocused();
      await uiExpect(
        first.getByRole("button", { name: "允许", exact: true }),
      ).toBeEnabled();
      const screenshots = path.resolve(".artifacts/visual-v3/confirmation");
      await mkdir(screenshots, { recursive: true });
      await first.emulateMedia({ colorScheme: null });
      for (const source of ["light", "dark"] as const) {
        await application.evaluate(({ nativeTheme }, source) => {
          nativeTheme.themeSource = source;
        }, source);
        await first.waitForFunction(
          (dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark,
          source === "dark",
        );
        await expect
          .poll(() =>
            application.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()
                .find((window) => window.getTitle() === "Plums · 安全确认")!
                .getBackgroundColor()
                .toLowerCase(),
            ),
          )
          .toBe(source === "dark" ? "#141311" : "#f7f6f3");
        await first.evaluate(async () => {
          await Promise.allSettled(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished),
          );
        });
        await first.screenshot({
          path: path.join(screenshots, `capability-${source}.png`),
        });
      }
      expect(
        await first.evaluate(async () => {
          try {
            await fetch("https://example.com");
            return false;
          } catch {
            return true;
          }
        }),
      ).toBe(true);
      await first.keyboard.press("Enter").catch((error) => {
        if (!String(error).includes("closed")) throw error;
      });
      await expect.poll(() => result("sender-test")).toBe(false);
      const allowed = await ask("allow-test", "consent");
      await uiExpect(allowed.locator('[data-kind="consent"]')).toBeVisible();
      await uiExpect(
        allowed.getByRole("button", { name: "允许", exact: true }),
      ).toBeEnabled();
      for (const colorScheme of ["light", "dark"] as const) {
        await allowed.emulateMedia({ colorScheme });
        await allowed.screenshot({
          path: path.join(screenshots, `consent-${colorScheme}.png`),
        });
      }
      await allowed.getByRole("button", { name: "允许", exact: true }).focus();
      await allowed.keyboard.press("Space").catch((error) => {
        if (!String(error).includes("closed")) throw error;
      });
      await expect.poll(() => result("allow-test")).toBe(true);
      await application.evaluate(() => {
        const globals = globalThis as any;
        void globals.prompter
          .askTask({
            kind: "task",
            subject: "Task selection",
            action: "Choose scope",
            scopeOptions: [
              { key: "read", label: "读取项目" },
              { key: "write", label: "写入项目" },
            ],
          })
          .then((choice: unknown) => (globals.confirmResults.task = choice));
      });
      const task = await findConfirmation(application, "Task selection");
      const read = task.getByLabel("读取项目", { exact: true });
      const write = task.getByLabel("写入项目", { exact: true });
      const duration = task.getByLabel("有效期", { exact: false });
      const deny = task.getByRole("button", { name: "不允许", exact: true });
      const allow = task.getByTestId("confirm-allow");
      await uiExpect(deny).toBeFocused();
      await uiExpect(allow).toBeDisabled();
      // Real key events: disabled Allow is skipped in both wrapping directions.
      await task.keyboard.press("Tab");
      await uiExpect(read).toBeFocused();
      await task.keyboard.press("Shift+Tab");
      await uiExpect(deny).toBeFocused();
      await task.keyboard.press("Shift+Tab");
      await uiExpect(duration).toBeFocused();
      await task.keyboard.press("Shift+Tab");
      await uiExpect(write).toBeFocused();
      await task.keyboard.press("Space");
      await uiExpect(write).not.toBeChecked();
      await task.keyboard.press("Tab");
      await uiExpect(duration).toBeFocused();
      if (process.platform !== "darwin") {
        await task.keyboard.press("Enter");
        expect(await result("task")).toBeUndefined();
      }
      await task.keyboard.press("ArrowDown");
      await task.keyboard.press("Enter");
      expect(await result("task")).toBeUndefined();
      // CDP cannot reliably select a macOS native popup option. Keep actual Enter
      // authorization checks and exercise the selection's change event separately.
      if (process.platform === "darwin") await duration.selectOption("3600000");
      await uiExpect(duration).toHaveValue("3600000");
      expect(await result("task")).toBeUndefined();
      await task.keyboard.press("Tab");
      await uiExpect(deny).toBeFocused();
      await uiExpect(allow).toBeEnabled();
      for (const control of [allow, read, write, duration, deny]) {
        await task.keyboard.press("Tab");
        await uiExpect(control).toBeFocused();
      }
      for (const control of [duration, write, read, allow, deny]) {
        await task.keyboard.press("Shift+Tab");
        await uiExpect(control).toBeFocused();
      }
      await uiExpect(task.getByTestId("confirm-allow")).toBeEnabled();
      expect(
        await task.evaluate(async () => {
          const api = (window as any).confirmation;
          const data = await api.load();
          return api.answer(data.token, true, {
            selected: ["exec"],
            durationMs: 3600000,
          });
        }),
      ).toBe(false);
      await task.evaluate(() => {
        const dialog = document.querySelector('[role="alertdialog"]')!;
        for (const attrs of ["disabled", "hidden", "inert", 'tabindex="-1"']) {
          dialog.insertAdjacentHTML(
            "afterbegin",
            `<button ${attrs}>Unreachable</button>`,
          );
        }
        const outside = document.createElement("button");
        outside.textContent = "Outside";
        document.body.append(outside);
        outside.focus();
      });
      await uiExpect(deny).toBeFocused();
      await task.evaluate(() => (document.activeElement as HTMLElement).blur());
      await task.keyboard.press("Tab");
      await uiExpect(deny).toBeFocused();
      await task.keyboard.press("Tab");
      await uiExpect(allow).toBeFocused();
      await task.keyboard.press("Tab");
      await uiExpect(read).toBeFocused();
      await task.keyboard.press("Shift+Tab");
      await uiExpect(allow).toBeFocused();
      await task.keyboard.press("Space").catch((error) => {
        if (!String(error).includes("closed")) throw error;
      });
      await expect
        .poll(() => result("task"))
        .toEqual({ selected: ["read"], durationMs: 3600000 });
      for (const target of ["不允许", "允许"]) {
        const id = `task-enter-${target}`;
        const page = await ask(id, "task");
        const button = page.getByRole("button", { name: target, exact: true });
        await uiExpect(button).toBeEnabled();
        await button.focus();
        await page.keyboard.press("Enter").catch((error) => {
          if (!String(error).includes("closed")) throw error;
        });
        await expect.poll(() => result(id)).toBe(false);
      }
      const escape = await ask("escape-test");
      await escape.keyboard.press("Escape").catch((error) => {
        if (!String(error).includes("closed")) throw error;
      });
      await expect.poll(() => result("escape-test")).toBe(false);
      const active = await ask("active-test");
      await application.evaluate(() => {
        (globalThis as any).askConfirmation("queued-test");
        (globalThis as any).confirmControllers["queued-test"].abort();
      });
      await expect.poll(() => result("queued-test")).toBe(false);
      await application.evaluate(() =>
        (globalThis as any).confirmControllers["active-test"].abort(),
      );
      await expect.poll(() => result("active-test")).toBe(false);
      await expect.poll(() => active.isClosed()).toBe(true);
      const nonBoolean = await ask("non-boolean");
      const nonBooleanData = await nonBoolean.evaluate(() =>
        (window as any).confirmation.load(),
      );
      await nonBoolean
        .evaluate(
          (data) => (window as any).confirmation.answer(data.token, "true"),
          nonBooleanData,
        )
        .catch((error) => {
          if (!String(error).includes("closed")) throw error;
        });
      await expect.poll(() => result("non-boolean")).toBe(false);
      const fifo = await ask("fifo-first");
      await application.evaluate(() => {
        (globalThis as any).askConfirmation("fifo-second");
        (globalThis as any).askConfirmation("fifo-third");
        (globalThis as any).confirmControllers["fifo-second"].abort();
      });
      await expect.poll(() => result("fifo-second")).toBe(false);
      expect(
        application
          .windows()
          .filter((page) => page.url().endsWith("confirm.html")),
      ).toHaveLength(1);
      await fifo
        .getByRole("button", { name: "不允许", exact: true })
        .click()
        .catch((error) => {
          if (!String(error).includes("closed")) throw error;
        });
      await expect.poll(() => result("fifo-first")).toBe(false);
      const last = await findConfirmation(application, "fifo-third");
      await last
        .getByRole("button", { name: "不允许", exact: true })
        .click()
        .catch((error) => {
          if (!String(error).includes("closed")) throw error;
        });
      await expect.poll(() => result("fifo-third")).toBe(false);
      await ask("blur-test");
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Plums · 安全确认")
          ?.blur(),
      );
      await expect.poll(() => result("blur-test")).toBe(false);
      await ask("close-test");
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Plums · 安全确认")
          ?.close(),
      );
      await expect.poll(() => result("close-test")).toBe(false);
      const trust = await ask("engine-trust-test", "engine-trust");
      await uiExpect(
        trust.getByText(
          "\u4fe1\u4efb\u5c06\u4fdd\u7559\uff0c\u76f4\u5230\u4f60\u64a4\u9500\u6388\u6743\u6216\u5220\u9664\u8fd9\u4e2a Agent\u3002",
        ),
      ).toBeVisible();
      await uiExpect(
        trust.getByRole("button", {
          name: "\u6682\u4e0d\u542f\u52a8",
          exact: true,
        }),
      ).toBeFocused();
      await uiExpect(
        trust.getByRole("button", {
          name: "\u4fe1\u4efb\u5e76\u542f\u52a8",
          exact: true,
        }),
      ).toBeEnabled();
      await trust
        .getByRole("button", {
          name: "\u4fe1\u4efb\u5e76\u542f\u52a8",
          exact: true,
        })
        .click();
      await expect.poll(() => result("engine-trust-test")).toBe(true);
      await ask("dispose-test");
      await application.evaluate(() => {
        (globalThis as any).askConfirmation("dispose-queued");
        (globalThis as any).prompter.dispose();
      });
      await expect.poll(() => result("dispose-test")).toBe(false);
      await expect.poll(() => result("dispose-queued")).toBe(false);
    } finally {
      await application.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
async function findConfirmation(
  application: ElectronApplication,
  subject: string,
): Promise<Page> {
  await expect
    .poll(
      () =>
        application
          .windows()
          .filter((page) => page.url().endsWith("confirm.html")).length,
    )
    .toBe(1);
  const page = application
    .windows()
    .find((page) => page.url().endsWith("confirm.html"))!;
  await page.getByText(subject, { exact: true }).waitFor();
  // DOM loading can precede the macOS modal's show/focus transition.
  const nativeWindow = await application.browserWindow(page);
  await expect
    .poll(() => nativeWindow.evaluate((window) => window.isVisible()))
    .toBe(true);
  await application.evaluate(({ app }) => app.focus({ steal: true }));
  await nativeWindow.evaluate((window) => window.focus());
  await expect
    .poll(() => nativeWindow.evaluate((window) => window.isFocused()))
    .toBe(true);
  return page;
}
