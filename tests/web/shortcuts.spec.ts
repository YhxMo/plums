import { expect, test, type Page } from "@playwright/test";
import { addAgent, manage, openSettings, shellButton } from "./helpers";

const settings = (page: Page) =>
  page.getByRole("dialog", { name: "设置", exact: true });
const adding = (page: Page) =>
  page.getByRole("dialog", { name: "添加 Agent", exact: true });
// A dialog hides the page from the accessibility tree, so look by label.
const search = (page: Page) => page.locator('[aria-label="搜索 Agent"]');

test.describe("in the browser preview", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(shellButton(page, "设置")).toBeVisible();
  });

  test("the menu's keys open settings and adding an Agent", async ({
    page,
  }) => {
    await page.keyboard.press("ControlOrMeta+,");
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+n");
    await expect(adding(page)).toBeVisible();
  });

  test("find puts the cursor in the Agent search once there is a list", async ({
    page,
  }) => {
    await page.keyboard.press("ControlOrMeta+f");
    await expect(search(page)).toHaveCount(0);
    await addAgent(page, "甲");
    await expect(adding(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(search(page)).toBeFocused();
  });

  test("a shown dialog or extension management takes no workspace command", async ({
    page,
  }) => {
    await addAgent(page, "甲");
    await expect(adding(page)).toBeHidden();
    await openSettings(page);
    await page.keyboard.press("ControlOrMeta+n");
    await page.keyboard.press("ControlOrMeta+f");
    await expect(adding(page)).toHaveCount(0);
    await expect(search(page)).not.toBeFocused();
    await page.keyboard.press("Escape");
    await manage(page);
    await page.keyboard.press("ControlOrMeta+n");
    await expect(adding(page)).toHaveCount(0);
  });

  test("other chords are left to the page", async ({ page }) => {
    await addAgent(page, "甲");
    await expect(adding(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+Shift+n");
    await page.keyboard.press("ControlOrMeta+Alt+,");
    await expect(adding(page)).toHaveCount(0);
    await expect(settings(page)).toHaveCount(0);
  });
});

/** The app window: the menu sends `app-command` and the system owns the keys. */
async function native(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      calls: [string, Record<string, unknown>][];
      callbacks: Map<number, (event: unknown) => void>;
      listening: Map<string, number>;
      emit: (event: string, payload: unknown) => void;
    };
    w.isTauri = true;
    w.calls = [];
    w.callbacks = new Map();
    w.listening = new Map();
    let callbackId = 0;
    w.emit = (event, payload) =>
      w.callbacks.get(w.listening.get(event)!)?.({ event, id: 1, payload });
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback(callback: (event: unknown) => void) {
        w.callbacks.set(++callbackId, callback);
        return callbackId;
      },
      unregisterCallback: () => {},
      async invoke(command: string, args: Record<string, unknown>) {
        w.calls.push([command, args]);
        if (command === "plugin:event|listen") {
          w.listening.set(args.event as string, args.handler as number);
          return args.handler;
        }
        if (command === "credential_supported") return false;
        if (command === "document_supported") return false;
        if (command === "credential_inventory") return [];
        if (command === "platform_call") {
          if (args.capability === "platform.info")
            return { os: "macos", arch: "aarch64", storage: "isolated" };
          if (args.capability === "state.read") return null;
          if (args.capability === "state.write")
            return { revision: 1, value: null };
        }
      },
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(shellButton(page, "设置")).toBeVisible();
}

const emit = (page: Page, command: string) =>
  page.evaluate(
    (command) =>
      (window as unknown as { emit: (e: string, p: string) => void }).emit(
        "app-command",
        command,
      ),
    command,
  );

test("the native menu's commands run, and the page ignores the keys itself", async ({
  page,
}) => {
  await native(page);
  await page.keyboard.press("ControlOrMeta+n");
  await expect(adding(page)).toHaveCount(0);
  await emit(page, "settings");
  await expect(settings(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await emit(page, "new");
  await expect(adding(page)).toBeVisible();
  await emit(page, "unknown");
});

test("choosing to follow the system hands that choice to the window", async ({
  page,
}) => {
  await native(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("radio", { name: "深色", exact: true }).click();
  await dialog.getByRole("radio", { name: "跟随系统", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as {
            calls: [string, { theme?: string }][];
          }
        ).calls
          .filter(([command]) => command === "shell_set_theme")
          .map(([, args]) => args.theme),
      ),
    )
    .toEqual(["system", "dark", "system"]);
});
