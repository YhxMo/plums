import { expect, test, type Locator, type Page } from "@playwright/test";
import { addAgent, manage } from "./helpers";

test("a narrow desktop keeps attachment shortcuts and Enter-to-send", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 680 });
  await page.goto("/");
  await addAgent(page, "半屏助手");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.focus();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("ControlOrMeta+U");
  await chooser;
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("第一行\n");
  await input.fill("只发送一次");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText("echo-a｜第 1 轮");
  await expect(input).toHaveValue("");
});

/** Adds an Agent and sends one message, so both bubbles are on screen. */
async function conversation(page: Page) {
  await page.goto("/");
  await addAgent(page, "编程助手", { description: "帮助整理代码与文字。" });
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("你好");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log.getByText(/^echo-a｜第 1 轮｜/)).toBeVisible();
  return log;
}

/** No shadow at all, or only fully transparent zero-size ones (Tailwind's `shadow-none`). */
const FLAT = /^(none|(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+)$/;

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

test("desktop shows the list and the conversation as two separate rounded panels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await conversation(page);
  const list = page.getByRole("complementary", { name: "Agent 列表" });
  const chat = page.getByRole("region", { name: "编程助手 的会话" });
  for (const panel of [list, chat])
    expect(
      parseFloat(await style(panel, "border-top-left-radius")),
    ).toBeGreaterThanOrEqual(16);
  const [a, b] = await Promise.all([list.boundingBox(), chat.boundingBox()]);
  const gap = b!.x - (a!.x + a!.width);
  expect(gap).toBeGreaterThanOrEqual(6);
  expect(gap).toBeLessThanOrEqual(12);
  // The navigation rail sits on the outer layer, left of the list panel.
  const rail = await page
    .getByRole("navigation", { name: "应用导航" })
    .boundingBox();
  expect(rail!.width).toBeLessThanOrEqual(64);
  // Each panel is a step lighter than the surface around it.
  const outer = await resolve(page, "var(--chrome-bg)");
  expect(await style(chat, "background-color")).not.toBe(outer);
  expect(await style(list, "background-color")).not.toBe(outer);
});

test("own messages use the brand colour, replies the card colour, with one sans face on every width", async ({
  page,
}) => {
  const faces: string[] = [];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 844 });
    const log = await conversation(page);
    const own = log.getByText("你好", { exact: true });
    const reply = log.getByText(/^echo-a｜第 1 轮｜/);
    expect(await style(own, "background-color")).toBe(
      await resolve(page, "var(--accent)"),
    );
    expect(await style(reply, "background-color")).toBe(
      await resolve(page, "var(--card)"),
    );
    // Bubbles carry no shadow and are 16px round.
    expect(await style(reply, "box-shadow")).toMatch(FLAT);
    expect(parseFloat(await style(own, "border-top-left-radius"))).toBe(16);
    faces.push(await style(reply, "font-family"));
    expect(faces[faces.length - 1]).not.toMatch(
      /Anthropic Serif|Georgia|Songti/,
    );
    // No horizontal overflow on any width.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => localStorage.clear());
  }
  expect(faces[0]).toBe(faces[1]);
});

// The native window is dragged from the top of each pane; a bare region only
// counts clicks on its own box, so text inside the header would block it.
test("the pane headers and the rail drag the window from anywhere that is not a control", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "拖动助手");
  for (const label of ["拖动助手 的会话", "Agent 列表"])
    await expect(
      page
        .getByLabel(label, { exact: true })
        .locator("[data-tauri-drag-region]")
        .first(),
    ).toHaveAttribute("data-tauri-drag-region", "deep");
  await expect(
    page.getByRole("navigation", { name: "应用导航" }),
  ).toHaveAttribute("data-tauri-drag-region", "true");
});

test("the page behind the shell neither scrolls nor bounces", async ({
  page,
}) => {
  await page.goto("/");
  for (const selector of ["html", "body", "#root"]) {
    const rule = await page
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).overscrollBehaviorY);
    expect(rule, selector).toBe("none");
  }
  for (const selector of ["html", "body"]) {
    const rule = await page
      .locator(selector)
      .evaluate((el) => getComputedStyle(el).overflowY);
    expect(rule, selector).toBe("hidden");
  }
});

test("the attach shortcut stays quiet behind the extension manager and under dialogs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "快捷键助手");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const chooserOpens = async () => {
    let opened = false;
    const seen = () => (opened = true);
    page.on("filechooser", seen);
    await page.keyboard.press("ControlOrMeta+U");
    await page.waitForTimeout(300);
    page.off("filechooser", seen);
    return opened;
  };
  await manage(page);
  expect(await chooserOpens()).toBe(false);
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "应用设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "应用设置" })).toBeVisible();
  expect(await chooserOpens()).toBe(false);
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "消息", exact: true }).focus();
  expect(await chooserOpens()).toBe(true);
});

test("the sidebar button sits on the same line as the conversation header buttons", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await addAgent(page, "对齐助手");
  const middle = async (name: string) => {
    const box = await page.getByRole("button", { name }).first().boundingBox();
    return box!.y + box!.height / 2;
  };
  const toggle = await middle("展开或收起右侧栏");
  expect(Math.abs(toggle - (await middle("新建会话")))).toBeLessThanOrEqual(1);
  expect(Math.abs(toggle - (await middle("更多操作")))).toBeLessThanOrEqual(1);
});

test("phone replies carry no name label above them", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  const log = await conversation(page);
  await expect(log.getByText("编程助手", { exact: true })).toHaveCount(0);
});

for (const width of [1280, 375]) {
  test(`the message box is one card with the text above and model and send on one row at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await conversation(page);
    const text = page.getByRole("textbox", { name: "消息", exact: true });
    const model = page.getByRole("combobox", { name: "切换模型" });
    const send = page.getByRole("button", { name: "发送", exact: true });
    const card = page.getByRole("group").filter({ has: text });
    expect(parseFloat(await style(card, "border-top-left-radius"))).toBe(16);
    expect(await style(card, "box-shadow")).toMatch(FLAT);
    const [t, m, s] = await Promise.all([
      text.boundingBox(),
      model.boundingBox(),
      send.boundingBox(),
    ]);
    // The toolbar sits under the text, and model and send share its row.
    expect(m!.y).toBeGreaterThanOrEqual(t!.y + t!.height - 2);
    expect(
      Math.abs(m!.y + m!.height / 2 - (s!.y + s!.height / 2)),
    ).toBeLessThan(6);
    // A rounded square, not a pill or a wide labelled button.
    expect(s!.width).toBeLessThanOrEqual(46);
    expect(Math.abs(s!.width - s!.height)).toBeLessThan(2);
    expect(
      parseFloat(await style(send, "border-top-left-radius")),
    ).toBeLessThan(s!.width / 2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("the thinking strength shows only for a model that lists strengths, and reaches its reply", async ({
  page,
}) => {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await addAgent(page, "思考助手");
    const effort = page.getByRole("combobox", { name: "思考强度" });
    // The first model offers none: no control, not a disabled one.
    await expect(effort).toHaveCount(0);
    await page.getByRole("combobox", { name: "切换模型" }).click();
    await page.getByRole("option", { name: /回显 B/ }).click();
    await expect(effort).toBeVisible();
    await effort.click();
    // Only what the model lists, plus the service default.
    await expect(page.getByRole("option")).toHaveText([
      /默认/,
      /关闭/,
      /低/,
      /高/,
    ]);
    await page.getByRole("option", { name: /高/ }).click();
    await expect(effort).toContainText("高");
    const text = page.getByRole("textbox", { name: "消息", exact: true });
    await text.fill("想想");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("log")).toContainText("｜强度：high");
    // Model and strength still share the row with send, without overflow.
    const [m, e, s] = await Promise.all([
      page.getByRole("combobox", { name: "切换模型" }).boundingBox(),
      effort.boundingBox(),
      page.getByRole("button", { name: "发送", exact: true }).boundingBox(),
    ]);
    expect(Math.abs(m!.y - e!.y)).toBeLessThan(6);
    expect(e!.x + e!.width).toBeLessThanOrEqual(s!.x);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    // Back to a model without strengths: the control is gone.
    await page.getByRole("combobox", { name: "切换模型" }).click();
    await page.getByRole("option", { name: /回显 A/ }).click();
    await expect(effort).toHaveCount(0);
    await page.evaluate(() => localStorage.clear());
  }
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const picture = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: Buffer.from(PNG, "base64"),
});

for (const width of [1280, 375]) {
  test(`files and pictures are attached, shown with the message and sent to the model at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await addAgent(page, "附件助手");
    const text = page.getByRole("textbox", { name: "消息", exact: true });
    const log = page.getByRole("log");
    const plus = page.getByRole("button", { name: "添加附件" });
    // One entry for pictures and files, never greyed out by the model.
    await plus.click();
    await expect(
      page.getByRole("menuitem", { name: /图片和文件/ }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    if (width >= 768) {
      await text.focus();
      const chooser = page.waitForEvent("filechooser");
      await page.keyboard.press("ControlOrMeta+U");
      await chooser;
    }
    await page.getByLabel("选择文件").setInputFiles({
      name: "笔记.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("第一行\n第二行"),
    });
    const waiting = page.getByRole("list", { name: "待发送的附件" });
    await expect(waiting.getByText("笔记.md")).toBeVisible();
    await text.fill("看看这份笔记");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(waiting).toHaveCount(0);
    await expect(
      log.getByRole("button", { name: "查看 笔记.md" }),
    ).toBeVisible();
    await expect(log.getByText(/文件「笔记.md」：/)).toBeVisible();
    await log.getByRole("button", { name: "查看 笔记.md" }).click();
    await expect(
      page.getByRole("dialog", { name: "笔记.md" }).getByText("第二行"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // A model that cannot read pictures still takes them, and is told so.
    await page.getByLabel("选择文件").setInputFiles(picture("无眼.png"));
    await expect(waiting.getByText("无眼.png")).toBeVisible();
    await text.fill("看看这张");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(log).toContainText(
      'ERROR: Cannot read "无眼.png" (this model does not support image input)',
    );
    // A model that reads pictures takes them, picked, pasted or dropped.
    await page.getByRole("combobox", { name: "切换模型" }).click();
    await page.getByRole("option", { name: /回显 B/ }).click();
    await page.getByLabel("选择文件").setInputFiles(picture("照片.png"));
    await expect(waiting.getByText("照片.png")).toBeVisible();
    await text.focus();
    await page.evaluate((png) => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
          "粘贴.png",
          {
            type: "image/png",
          },
        ),
      );
      document.querySelector("textarea")!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, PNG);
    await expect(waiting.getByText("粘贴.png")).toBeVisible();
    await page.evaluate((png) => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
          "拖入.png",
          {
            type: "image/png",
          },
        ),
      );
      const area = document.querySelector('[role="log"]')!;
      area.dispatchEvent(
        new DragEvent("dragover", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      area.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, PNG);
    await expect(waiting.getByText("拖入.png")).toBeVisible();
    // Layout stays inside the screen with three chips waiting.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await waiting.getByRole("button", { name: "移除 拖入.png" }).click();
    await expect(waiting.getByText("拖入.png")).toHaveCount(0);
    await text.fill("看看图片");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(log).toContainText("｜图片：2");
    const shown = log.getByRole("img", { name: "照片.png" });
    await expect(shown).toBeVisible();
    await expect
      .poll(() => shown.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    await shown.click();
    await expect(
      page.getByRole("dialog", { name: "照片.png" }).getByRole("img"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => localStorage.clear());
  });
}

test("a file that is not text, or too many files, are refused with the reason", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "拒绝助手");
  await page.getByLabel("选择文件").setInputFiles({
    name: "二进制.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0xff, 0xfe, 0x00, 0x80]),
  });
  await expect(page.getByText(/二进制.bin」不是 UTF-8 文本/)).toBeVisible();
  await expect(page.getByRole("list", { name: "待发送的附件" })).toHaveCount(0);
  await page.getByLabel("选择文件").setInputFiles(
    Array.from({ length: 6 }, (_, i) => ({
      name: `f${i}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`内容${i}`),
    })),
  );
  await expect(page.getByText(/最多 5 个附件/)).toBeVisible();
});
