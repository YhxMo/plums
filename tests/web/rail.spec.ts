import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addAgent,
  manage,
  openSettings,
  installByPath,
  serveModule,
  pickTheme,
} from "./helpers";

const style = (target: Locator, property: string) =>
  target.evaluate(
    (el, property) => getComputedStyle(el).getPropertyValue(property),
    property,
  );

/** The computed colour a CSS value (such as a variable) resolves to. */
const resolve = (page: Page, value: string) =>
  page.evaluate((value) => {
    const probe = document.createElement("i");
    probe.style.backgroundColor = value;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, value);

/** A workspace extension served at `/<id>.js` with the given icon source. */
async function serve(page: Page, id: string, icon: string) {
  await serveModule(
    page,
    id,
    `export default {
        manifest: {id:"${id}",version:"1",apiVersion:1},
        activate(ctx) {
          ctx.view({id:"${id}.view",label:"${id} 界面",icon:${JSON.stringify(icon)},
            mount(root) {root.textContent="${id} 工作区";return()=>root.replaceChildren();}});
        }
      };`,
  );
}
async function install(page: Page, id: string) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, `/${id}/`);
  await page.getByRole("button", { name: `启用 ${id}`, exact: true }).click();
}

for (const scheme of ["light", "dark"] as const)
  test(`the 68px rail holds the user, workspaces, then extensions with settings below, as icons only (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await addAgent(page, "窄栏助手");
    const rail = page.getByRole("navigation", { name: "应用导航" });
    expect((await rail.boundingBox())!.width).toBe(68);
    const agents = rail.getByRole("button", { name: "Agent 界面" });
    const extensions = rail.getByRole("button", { name: "扩展", exact: true });
    const settings = rail.getByRole("button", { name: "设置", exact: true });
    const user = rail.locator("[data-slot=user-avatar]");
    const [u, a, e, s] = await Promise.all(
      [user, agents, extensions, settings].map((item) => item.boundingBox()),
    );
    expect(u!.y + u!.height).toBeLessThanOrEqual(a!.y);
    expect(a!.y + a!.height).toBeLessThan(e!.y);
    // Settings sits right under extensions at the foot of the rail.
    expect(s!.y - (e!.y + e!.height)).toBeLessThanOrEqual(10);
    expect(800 - (s!.y + s!.height)).toBeLessThanOrEqual(20);
    // Icons only: no text, no initials, a name for tooltips and readers.
    await expect(rail).toHaveText("");
    for (const button of [agents, extensions, settings])
      await expect(button.locator("[data-slot=mask-icon]")).toHaveCount(1);
    await expect(agents).toHaveAttribute("aria-current", "page");
    await agents.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Agent 界面");
    // The current icon is the selection orange; the others are rail grey.
    const tint = (button: Locator) =>
      style(button.locator("[data-slot=mask-icon]"), "background-color");
    expect(await tint(agents)).toBe(await resolve(page, "var(--selection)"));
    expect(await tint(extensions)).toBe(
      await resolve(page, "var(--rail-icon)"),
    );
    // No app menu and no light/dark switch outside the settings.
    await expect(page.getByRole("button", { name: "应用菜单" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "深色" })).toHaveCount(0);
    await extensions.click();
    await expect(
      page.getByRole("heading", { name: "扩展", exact: true }),
    ).toBeVisible();
    await expect(extensions).toHaveAttribute("aria-current", "page");
    await expect(agents).not.toHaveAttribute("aria-current", "page");
    expect(await tint(extensions)).toBe(
      await resolve(page, "var(--selection)"),
    );
    await agents.click();
    await expect(
      page.getByRole("heading", { name: "扩展", exact: true }),
    ).toBeHidden();
  });

for (const [scheme, tile, figure] of [
  ["light", "rgb(224, 224, 224)", "rgb(141, 141, 141)"],
  ["dark", "rgb(49, 49, 49)", "rgb(110, 110, 110)"],
] as const)
  test(`the rail shows the user as a blank grey plum that opens the shared memory (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const rail = page.getByRole("navigation", { name: "应用导航" });
    const user = rail.locator("[data-slot=user-avatar]");
    const box = await user.boundingBox();
    expect(box!.width).toBe(36);
    expect(box!.height).toBe(36);
    await expect(user).toHaveAttribute("aria-hidden", "true");
    // The built-in memory contributes the user's entry, so the picture is
    // a button named by that page.
    expect(
      await user.evaluate((el) => el.closest("button")?.ariaLabel ?? null),
    ).toBe("记忆");
    expect(
      await user
        .locator("[data-part=tile]")
        .evaluate((el) => getComputedStyle(el).fill),
    ).toBe(tile);
    for (const part of ["body", "stem", "leaf"])
      expect(
        await user
          .locator(`[data-part=${part}]`)
          .evaluate(
            (el) => getComputedStyle(el).fill + getComputedStyle(el).stroke,
          ),
      ).toContain(figure);
    // A blank plum: no face.
    await expect(user.locator("ellipse, [data-part=eye]")).toHaveCount(0);
  });

test("settings holds light/dark, about and the extension manager", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const settings = page.getByRole("button", { name: "设置", exact: true });
  await settings.click();
  const dialog = page.getByRole("dialog", { name: "设置", exact: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
  await settings.click();
  await dialog.getByRole("radio", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "关于 Plums" }).click();
  const about = page.getByRole("dialog", { name: "关于 Plums" });
  await expect(about).toContainText("Plums 0.2.0");
  // About returns to the settings it was opened from.
  await about.getByRole("button", { name: "返回" }).click();
  await expect(dialog).toBeVisible();
  await expect(about).toBeHidden();
});

test("phones keep extensions and settings in the title bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  const bar = page.getByRole("banner");
  await expect(page.getByRole("navigation", { name: "应用导航" })).toBeHidden();
  await expect(bar.getByRole("button", { name: "应用菜单" })).toHaveCount(0);
  await bar.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "设置", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "扩展", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "扩展", exact: true }),
  ).toBeVisible();
});

test("dialog views open from their extension's card in management", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await serveModule(
    page,
    "test.dialog",
    `export default {
        manifest: {id:"test.dialog",version:"1",apiVersion:1},
        activate(ctx) {
          ctx.view({id:"test.dialog.view",label:"连接设置",presentation:"dialog",
            mount(root) {root.textContent="对话框内容";return()=>root.replaceChildren();}});
        }
      };`,
  );
  await page.goto("/");
  await install(page, "test.dialog");
  const open = page.getByRole("button", { name: "打开 连接设置", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "连接设置", exact: true });
  await expect(dialog).toContainText("对话框内容");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  // Only an active extension offers its dialogs.
  await page
    .getByRole("button", { name: "停用 test.dialog", exact: true })
    .click();
  await expect(open).toHaveCount(0);
});

test("an extension's own SVG icon is drawn as a tinted shape; scripts in it never run", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const icon =
    '<svg viewBox="0 0 24 24" onload="window.__iconRan=1"><script>window.__iconRan=2</script><circle cx="12" cy="12" r="9"/></svg>';
  await serve(page, "test.iconic", icon);
  await page.goto("/");
  await install(page, "test.iconic");
  const button = page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "test.iconic 界面" });
  const mark = button.locator("[data-slot=mask-icon]");
  await expect(mark).toHaveCount(1);
  expect(await style(mark, "mask-image")).toContain("data:image/svg+xml");
  // Drawn as a mask, never inserted as markup.
  await expect(button.locator("svg")).toHaveCount(0);
  await button.click();
  await expect(page.getByText("test.iconic 工作区")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __iconRan?: number }).__iconRan,
    ),
  ).toBeUndefined();
});

test("an invalid icon falls back to the generic workspace icon and says why", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await serve(page, "test.broken-icon", "<svg><rect/></svg>");
  await page.goto("/");
  await install(page, "test.broken-icon");
  const mark = page
    .getByRole("navigation", { name: "应用导航" })
    .getByRole("button", { name: "test.broken-icon 界面" })
    .locator("[data-slot=mask-icon]");
  await expect(mark).toHaveAttribute("data-icon", "workspace");
  await page
    .locator('[data-extension-id="test.broken-icon"]')
    .click({ position: { x: 6, y: 6 } });
  await expect(
    page.getByRole("region", { name: "所选扩展详情" }),
  ).toContainText("图标无效");
});

test("a contributed theme recolours the rail and the list; without the Agent interface the rail keeps no trace of it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "换肤助手");
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, "/samples/theme-ink/");
  await page
    .getByRole("button", { name: "启用 sample.theme-ink", exact: true })
    .click();
  await openSettings(page);
  await pickTheme(page, "墨夜");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  const rail = page.getByRole("navigation", { name: "应用导航" });
  const ink = "rgb(185, 181, 255)";
  await expect
    .poll(() =>
      style(
        rail
          .getByRole("button", { name: "Agent 界面" })
          .locator("[data-slot=mask-icon]"),
        "background-color",
      ),
    )
    .toBe(ink);
  expect(
    await style(
      rail
        .getByRole("button", { name: "扩展", exact: true })
        .locator("[data-slot=mask-icon]"),
      "background-color",
    ),
  ).toBe("rgb(192, 199, 231)");
  expect(
    await style(
      page.locator("[data-agent-row][data-selected=true]"),
      "background-color",
    ),
  ).toBe(ink);
  expect(await style(rail, "border-right-color")).toBe("rgb(65, 73, 101)");
  // Stopping the interface removes its rail entry; the shell's stay.
  await manage(page);
  await page
    .getByRole("button", { name: "停用 ui.agents", exact: true })
    .click();
  const confirm = page.getByRole("dialog");
  if (await confirm.isVisible())
    await confirm.getByRole("button", { name: /停用/ }).last().click();
  await expect(rail.getByRole("button", { name: "Agent 界面" })).toHaveCount(0);
  await expect(rail.locator("[data-icon=view]")).toHaveCount(0);
  await expect(
    rail.getByRole("button", { name: "扩展", exact: true }),
  ).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "设置", exact: true }),
  ).toBeVisible();
});
