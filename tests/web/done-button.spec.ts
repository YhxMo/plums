import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addAgent,
  openConnections,
  openSettings,
  shellButton,
} from "./helpers";

// Windows whose changes apply at once end in "完成" at the bottom right, as
// Mac sheets do; the title bar's close button stays.
async function done(dialog: Locator) {
  const button = dialog.getByRole("button", { name: "完成", exact: true });
  await expect(button).toBeVisible();
  await button.click();
  await expect(dialog).toBeHidden();
}

test.use({ viewport: { width: 1280, height: 800 } });

test("settings end in 完成; about, with nothing to change, does not", async ({
  page,
}) => {
  await page.goto("/");
  await done(await openSettings(page));
  await expect(shellButton(page, "设置")).toBeFocused();
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: /^关于 Plums/ }).click();
  const about = page.getByRole("dialog", { name: "关于 Plums", exact: true });
  await expect(about.getByRole("heading", { name: /^Plums / })).toBeVisible();
  await expect(about.getByRole("button", { name: "完成" })).toHaveCount(0);
});

test("Agent 设置 ends in 完成", async ({ page }) => {
  await page.goto("/");
  await addAgent(page, "甲");
  await page
    .getByRole("complementary", { name: "Agent 列表" })
    .getByRole("button", { name: "甲", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Agent 设置…", exact: true })
    .click();
  await done(page.getByRole("dialog", { name: "Agent 设置", exact: true }));
});

// The connector needs the app's key store; a stand-in native side gives it one.
test.describe("in the app window", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: unknown;
      };
      w.isTauri = true;
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        async invoke(command: string, args: Record<string, unknown>) {
          if (command === "credential_supported") return true;
          if (command === "document_supported") return false;
          if (command === "credential_inventory") return [];
          if (command === "credential_list") return [];
          if (command === "platform_call") {
            if (args.capability === "platform.info")
              return { os: "macos", arch: "aarch64", storage: "isolated" };
            if (args.capability === "state.read") return null;
            if (args.capability === "state.write")
              return {
                revision: 1,
                value: (args.payload as { value: unknown }).value,
              };
          }
        },
      };
    });
    await page.goto("/");
  });

  test("the model connections list ends in 完成", async ({ page }) => {
    const connections = await openConnections(page);
    await expect(connections.getByText("还没有服务商")).toBeVisible();
    await done(connections);
  });
});

test("the memory page ends in 完成", async ({ page }) => {
  await page.goto("/");
  await addAgent(page, "甲");
  await page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "记忆", exact: true })
    .click();
  await done(memory(page));
});

const memory = (page: Page) =>
  page.getByRole("dialog", { name: "记忆", exact: true });
