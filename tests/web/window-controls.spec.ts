import { expect, test, type Page } from "@playwright/test";
import { shellButton } from "./helpers";

declare global {
  interface Window {
    windowCalls: string[];
  }
}

/**
 * Browser coverage checks HTML clearance, not AppKit button behavior. The OS
 * comes from the native `platform.info`, as in the app; the runner's own user
 * agent (a Mac here) must not matter.
 */
async function native(page: Page, os = "macos") {
  await page.addInitScript((os) => {
    const w = window as unknown as Window & {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
    };
    w.isTauri = true;
    w.windowCalls = [];
    let callbackId = 0;
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback: () => ++callbackId,
      unregisterCallback: () => {},
      async invoke(command: string, args: Record<string, unknown>) {
        if (command.startsWith("plugin:window|")) {
          w.windowCalls.push(command);
          return false;
        }
        if (command === "plugin:event|listen") return args.handler;
        if (command === "credential_supported") return false;
        if (command === "document_supported") return false;
        if (command === "credential_inventory") return [];
        if (command === "platform_call") {
          if (args.capability === "platform.info")
            return { os, arch: "aarch64", storage: "isolated-experiment" };
          if (args.capability === "state.read") return null;
          if (args.capability === "state.write")
            return { revision: 1, value: null };
        }
      },
    };
  }, os);
  await page.goto("/");
  await expect(shellButton(page, "设置")).toBeVisible();
}

async function noCustomControls(page: Page) {
  await expect(page.getByRole("group", { name: "窗口控制" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /关闭窗口|最小化窗口|进入或退出全屏/ }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.windowCalls)).toEqual([]);
}

test("Mac rail reserves space for native controls without drawing or driving replacements", async ({
  page,
}) => {
  await page.setViewportSize({ width: 940, height: 640 });
  await native(page);
  await noCustomControls(page);
  const rail = page.getByRole("navigation", { name: "应用导航" });
  expect((await rail.boundingBox())!.width).toBe(68);
  const reserve = rail.locator(":scope > [data-tauri-drag-region]");
  const box = (await reserve.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(reserve.locator("button, input, a")).toHaveCount(0);
  // The native safe area must not steal the adjacent app navigation's click.
  await page.getByRole("button", { name: "扩展", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "扩展管理", exact: true }),
  ).toBeVisible();
  await noCustomControls(page);
});

for (const theme of ["light", "dark"] as const)
  test(`only the Mac rail lets the window's material through (${theme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 940, height: 640 });
    await native(page);
    const fill = (selector: string) =>
      page.evaluate(
        (selector) =>
          getComputedStyle(document.querySelector(selector)!).backgroundColor,
        selector,
      );
    // The page itself is clear; the rail is a light tint over the material.
    expect(await fill("html")).toBe("rgba(0, 0, 0, 0)");
    expect(await fill("body")).toBe("rgba(0, 0, 0, 0)");
    expect(await fill('nav[aria-label="应用导航"]')).toBe(
      theme === "light"
        ? "rgba(255, 255, 255, 0.3)"
        : "rgba(255, 255, 255, 0.05)",
    );
    // Everything beside it is solid, as the window colour was.
    const content = await page
      .locator('nav[aria-label="应用导航"] + *')
      .evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(content).not.toBe("rgba(0, 0, 0, 0)");
    expect(content).not.toContain("0.");
  });

test("the browser keeps a solid page with no material behind it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(shellButton(page, "设置")).toBeVisible();
  const fill = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(fill).not.toBe("rgba(0, 0, 0, 0)");
});

test("top edge stays draggable across wide and restored window sizes", async ({
  page,
}) => {
  await native(page);
  for (const width of [960, 1440, 700, 960]) {
    await page.setViewportSize({ width, height: 680 });
    await noCustomControls(page);
    for (const x of [200, width / 2, width - 20]) {
      expect(
        await page.evaluate(
          (x) =>
            document
              .elementFromPoint(x, 5)
              ?.getAttribute("data-tauri-drag-region"),
          x,
        ),
      ).toBe("true");
    }
  }
});

for (const kind of ["browser", "android", "windows"] as const) {
  test(`${kind} does not reserve macOS window chrome`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 680 });
    if (kind === "browser") await page.goto("/");
    else await native(page, kind);
    await expect(page.getByRole("group", { name: "窗口控制" })).toHaveCount(0);
    expect((await page.locator(".pane").boundingBox())!.y).toBe(0);
  });
}
