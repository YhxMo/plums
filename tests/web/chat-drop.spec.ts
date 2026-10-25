import { expect, test, type Page } from "@playwright/test";
import { addAgent, manage } from "./helpers";

type Outcome = { prevented: boolean; effect: string };

/**
 * Drags a text file into the window over `selector`; then drops it there,
 * or leaves the window. Resolves to what the page did with each event.
 */
function drag(
  page: Page,
  selector: string,
  name: string,
  then: "drop" | "leave" | "hover" = "drop",
) {
  return page.evaluate(
    ({ selector, name, then }) => {
      const data = new DataTransfer();
      data.items.add(new File(["内容"], name, { type: "text/plain" }));
      // A scripted DataTransfer ignores dropEffect; keep what handlers set.
      let effect = "none";
      Object.defineProperty(data, "dropEffect", {
        get: () => effect,
        set: (value: string) => (effect = value),
      });
      const target = document.querySelector(selector)!;
      const fire = (type: string): Outcome => {
        const event = new DragEvent(type, {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return { prevented: event.defaultPrevented, effect: data.dropEffect };
      };
      // Leaving continues the drag that the last hover began.
      if (then !== "leave") fire("dragenter");
      const over = fire("dragover");
      // Leaving the window has no element to enter next.
      if (then === "leave") fire("dragleave");
      return { over, drop: then === "drop" ? fire("drop") : undefined };
    },
    { selector, name, then },
  );
}
const chip = (page: Page, name: string) =>
  page.getByRole("button", { name: `移除 ${name}`, exact: true });
const hint = (page: Page) => page.locator('[data-slot="window-drop"]');

for (const width of [375, 1280])
  test(`files dropped anywhere in the window join the open conversation (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await addAgent(page, "拖放助手");

    // Hovering shows one hint over the whole window, naming the conversation.
    await drag(page, "textarea", "x.txt", "hover");
    await expect(hint(page)).toContainText("松开以添加附件");
    await expect(hint(page)).toContainText("拖放助手");
    const cover = (await hint(page).boundingBox())!;
    expect(cover.height).toBeGreaterThan(844 * 0.9);
    expect(cover.width).toBeGreaterThan(width * 0.9);
    await drag(page, "textarea", "x.txt", "leave");
    await expect(hint(page)).toBeHidden();

    const spots = [
      ["textarea", "输入框.txt"],
      ['section[aria-label$="的会话"] header', "头部.txt"],
      ['[role="log"]', "消息区.txt"],
    ];
    if (width > 768)
      spots.push(
        ['[aria-label="Agent 列表"]', "列表.txt"],
        ['nav[aria-label="应用导航"]', "导航栏.txt"],
      );
    for (const [selector, name] of spots) {
      const { over, drop } = await drag(page, selector, name);
      expect(over).toEqual({ prevented: true, effect: "copy" });
      expect(drop!.prevented).toBe(true);
      await expect(chip(page, name)).toBeVisible();
    }
    await expect(hint(page)).toBeHidden();
  });

test("without an open conversation the hint says why files are refused", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/");
  const refused = { prevented: true, effect: "none" };
  await expect(page.getByText("欢迎使用 Plums")).toBeVisible();
  expect((await drag(page, "main", "x.txt", "hover")).over).toEqual(refused);
  await expect(hint(page)).toContainText("添加 Agent 后才能拖入附件");
  await drag(page, "main", "x.txt", "leave");
  await expect(hint(page)).toBeHidden();

  await addAgent(page, "拖放助手");
  await page.getByRole("button", { name: "返回 Agent 列表" }).click();
  expect(
    (await drag(page, '[aria-label="Agent 列表"]', "x.txt", "hover")).over,
  ).toEqual(refused);
  await expect(hint(page)).toContainText("选择一个 Agent 后才能拖入附件");
});

test("a message being edited takes no files", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await addAgent(page, "拖放助手");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("hi");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page
    .getByRole("log")
    .locator("p", { hasText: /^hi$/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  const { over } = await drag(page, "textarea", "x.txt", "hover");
  expect(over).toEqual({ prevented: true, effect: "none" });
  await expect(hint(page)).toContainText("编辑消息时不能添加附件");
});

test("extension management and open dialogs refuse files without a hint, and the app is never replaced", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await addAgent(page, "拖放助手");
  const refused = { prevented: true, effect: "none" };

  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const overDialog = await drag(page, '[role="dialog"]', "弹窗.txt");
  expect(overDialog.over).toEqual(refused);
  expect(overDialog.drop!.prevented).toBe(true);
  await expect(hint(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(chip(page, "弹窗.txt")).toHaveCount(0);

  await manage(page);
  await expect(page.getByRole("heading", { name: "扩展与状态" })).toBeVisible();
  const overManager = await drag(page, ".pane", "管理.txt");
  expect(overManager.over).toEqual(refused);
  expect(overManager.drop!.prevented).toBe(true);
  await expect(hint(page)).toBeHidden();
});
