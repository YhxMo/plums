import {
  manage,
  legacyEntry,
  chooseLayout,
  openSettings,
  switchAppearance,
} from "./helpers";
import { expect, test } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
  test(`first launch follows the ${scheme} system appearance`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    const dialog = await openSettings(page);
    await expect(
      dialog.getByRole("button", {
        name: scheme === "light" ? "切换到深色模式" : "切换到浅色模式",
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
  });
}

for (const width of [375, 1440]) {
  test(`theme changes preserve drafts and survive layout selection and reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await switchAppearance(page, "深色");
    await (await legacyEntry(page)).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await page.getByRole("textbox").fill("theme draft");
    await switchAppearance(page, "浅色");
    await expect(page.getByRole("textbox")).toHaveValue("theme draft");
    await page.getByRole("button", { name: "运行并保存" }).click();
    await expect(page.locator("[data-phase]")).toHaveText("已保存");
    await chooseLayout(page, "board");
    await switchAppearance(page, "深色");
    await expect(page.locator("[data-output]")).toHaveText("THEME DRAFT");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await (await legacyEntry(page)).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "工作画布" })).toBeVisible();
    await expect(page.locator("[data-output]")).toHaveText("THEME DRAFT");
  });
}

test("a layout choice during a pending theme write keeps the new theme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    type Saved = { revision: number; value: Record<string, unknown> };
    const w = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      __writes: { saved: Saved; hold: boolean; release?: () => void };
    };
    w.isTauri = true;
    w.__writes = {
      saved: {
        revision: 1,
        value: { version: 1, theme: "light", layout: "agents" },
      },
      hold: false,
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (
        command: string,
        args: {
          owner?: string;
          capability?: string;
          payload?: Saved & { key?: string };
        },
      ) => {
        if (command !== "platform_call") return undefined;
        // Only the shell's main document is modelled; other owners start empty.
        if (args.owner !== "host.shell" || args.payload?.key)
          return args.capability === "state.write"
            ? {
                revision: args.payload!.revision + 1,
                value: args.payload!.value,
              }
            : null;
        if (args.capability === "state.read") return w.__writes.saved;
        if (args.capability !== "state.write") return undefined;
        if (w.__writes.hold) {
          w.__writes.hold = false;
          await new Promise<void>((resolve) => {
            w.__writes.release = resolve;
          });
        }
        return (w.__writes.saved = {
          revision: args.payload!.revision + 1,
          value: args.payload!.value,
        });
      },
    };
  });
  await page.goto("/");
  await openSettings(page);
  const dialog = page.getByRole("dialog", { name: "应用设置" });
  await page.evaluate(() => {
    (window as unknown as { __writes: { hold: boolean } }).__writes.hold = true;
  });
  await dialog.getByRole("button", { name: "切换到深色模式" }).click();
  await page.waitForFunction(
    () =>
      (window as unknown as { __writes: { release?: unknown } }).__writes
        .release !== undefined,
  );
  await dialog
    .getByRole("radio", { name: "使用 Agent 界面", exact: true })
    .click();
  await page.evaluate(() =>
    (
      window as unknown as { __writes: { release: () => void } }
    ).__writes.release(),
  );
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __writes: { saved: { value: { theme?: string } } };
            }
          ).__writes.saved.value.theme,
      ),
    )
    .toBe("dark");
});

test("a rejected preference write keeps the current theme and reports the failure", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await manage(page);
  await page.getByText("诊断与实验", { exact: true }).click();
  await page.getByLabel("注入存储写入失败").check();
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(dialog.getByRole("alert")).toContainText("注入的写入故障");
  await expect(
    dialog.getByRole("button", { name: "切换到深色模式" }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("reduced motion keeps entrance animations from moving", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The longest run of frames any one element spends mid-slide or mid-scale;
  // the first frames may still carry the initial style before it jumps.
  await page.addInitScript(() => {
    const w = window as unknown as { __moving: number };
    w.__moving = 0;
    const moving = /translate[XY]?\((?!0px\))|scale\((?!1\))/;
    const runs = new WeakMap<Element, number>();
    const frame = () => {
      for (const el of document.querySelectorAll<HTMLElement>("[style]")) {
        const run = moving.test(el.style.transform)
          ? (runs.get(el) ?? 0) + 1
          : 0;
        runs.set(el, run);
        w.__moving = Math.max(w.__moving, run);
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "还没有 Agent" }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(
      () => (window as unknown as { __moving: number }).__moving,
    ),
  ).toBeLessThanOrEqual(2);
});
