import { expect, test, type Page } from "@playwright/test";
import { addAgent } from "./helpers";

/** Drags a text file over `selector` and, unless `leave`, drops it there. */
function drag(page: Page, selector: string, name: string, leave = false) {
  return page.evaluate(
    ({ selector, name, leave }) => {
      const data = new DataTransfer();
      data.items.add(new File(["内容"], name, { type: "text/plain" }));
      const target = document.querySelector(selector)!;
      const fire = (type: string, init: DragEventInit = {}) =>
        target.dispatchEvent(
          new DragEvent(type, {
            dataTransfer: data,
            bubbles: true,
            cancelable: true,
            ...init,
          }),
        );
      fire("dragover");
      if (leave) fire("dragleave", { relatedTarget: document.body });
      else fire("drop");
    },
    { selector, name, leave },
  );
}

for (const width of [375, 1280])
  test(`files dropped anywhere on the conversation become attachments (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await addAgent(page, "拖放助手");
    const section = page.getByRole("region", { name: "拖放助手 的会话" });
    const hint = page.getByText("松开以添加附件");

    // Hovering the message box shows the hint over the whole card.
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
      document.querySelector("textarea")!.dispatchEvent(
        new DragEvent("dragover", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect(hint).toBeVisible();
    const [card, cover] = await Promise.all([
      section.boundingBox(),
      hint.boundingBox(),
    ]);
    expect(cover!.height).toBeGreaterThan(card!.height * 0.9);
    await drag(page, "textarea", "x.txt", true);
    await expect(hint).toBeHidden();

    await drag(page, "textarea", "输入框.txt");
    await expect(hint).toBeHidden();
    await expect(
      page.getByRole("button", { name: "移除 输入框.txt", exact: true }),
    ).toBeVisible();
    await drag(page, 'section[aria-label$="的会话"] header', "头部.txt");
    await expect(
      page.getByRole("button", { name: "移除 头部.txt", exact: true }),
    ).toBeVisible();
    await drag(page, '[role="log"]', "消息区.txt");
    await expect(
      page.getByRole("button", { name: "移除 消息区.txt", exact: true }),
    ).toBeVisible();
  });

test("a file dropped where nothing takes it never replaces the app", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await addAgent(page, "拖放助手");
  const outcome = await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["x"], "x.txt", { type: "text/plain" }));
    const list = document.querySelector('[aria-label="Agent 列表"]')!;
    const fire = (type: string) => {
      const event = new DragEvent(type, {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      });
      list.dispatchEvent(event);
      return { prevented: event.defaultPrevented, effect: data.dropEffect };
    };
    return { over: fire("dragover"), drop: fire("drop") };
  });
  // The cursor says no, and the browser's "open the file" never runs.
  expect(outcome.over).toEqual({ prevented: true, effect: "none" });
  expect(outcome.drop.prevented).toBe(true);
  await expect(page.getByText("松开以添加附件")).toBeHidden();
});
