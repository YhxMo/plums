import { expect, test, type Locator, type Page } from "@playwright/test";
import { addAgent, manage, openSettings } from "./helpers";

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

/** Markdown's paragraphs sit inside the bubble, which owns paint and geometry. */
const replyBubble = (log: Locator) =>
  log.locator('[data-slot="context-menu-trigger"]').filter({
    hasText: /^echo-a｜第 1 轮｜/,
  });

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

/** The built-in window, card and bubble colours (Radix Gray), light then dark. */
const palette = {
  light: {
    chrome: "rgb(240, 240, 240)",
    chat: "rgb(252, 252, 252)",
    bubble: "rgb(240, 240, 240)",
  },
  dark: {
    chrome: "rgb(34, 34, 34)",
    chat: "rgb(25, 25, 25)",
    bubble: "rgb(42, 42, 42)",
  },
} as const;

for (const scheme of ["light", "dark"] as const)
  test(`desktop puts the rail and list on the window colour and the conversation on one floating card (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await conversation(page);
    const colours = palette[scheme];
    const list = page.getByRole("complementary", { name: "Agent 列表" });
    const chat = page.getByRole("region", { name: "编程助手 的会话" });
    const rail = page.getByRole("navigation", { name: "应用导航" });
    expect(await resolve(page, "var(--chrome)")).toBe(colours.chrome);
    expect(await resolve(page, "var(--chat)")).toBe(colours.chat);
    // Rail and list share the window colour; only a hairline parts them.
    expect(
      await page
        .locator("body > #root > div")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(colours.chrome);
    for (const flat of [list, rail])
      expect(await style(flat, "background-color")).toMatch(
        /^(rgba\(0, 0, 0, 0\)|transparent)$/,
      );
    expect(
      parseFloat(await style(rail, "border-right-width")),
    ).toBeLessThanOrEqual(1);
    expect(parseFloat(await style(list, "border-top-left-radius"))).toBe(0);
    // One card, 8px from the window edges and the list, 14px round, edged
    // by a hairline instead of a shadow.
    expect(await style(chat, "background-color")).toBe(colours.chat);
    expect(parseFloat(await style(chat, "border-top-left-radius"))).toBe(14);
    expect(await style(chat, "box-shadow")).toMatch(FLAT);
    expect(parseFloat(await style(chat, "border-top-width"))).toBeGreaterThan(
      0,
    );
    const [a, b] = await Promise.all([list.boundingBox(), chat.boundingBox()]);
    expect(b!.x - (a!.x + a!.width)).toBe(8);
    expect(b!.y).toBe(8);
    expect(1280 - (b!.x + b!.width)).toBe(8);
    expect(800 - (b!.y + b!.height)).toBe(8);
    // The header shares the card's colour and draws no line under it.
    const header = chat.locator("header");
    expect(await style(header, "background-color")).toMatch(
      /^(rgba\(0, 0, 0, 0\)|transparent)$/,
    );
    expect(parseFloat(await style(header, "border-bottom-width"))).toBe(0);
    // Replies sit on the bubble colour, own turns on the brand colour.
    const log = chat.getByRole("log");
    const reply = replyBubble(log);
    expect(await style(reply, "background-color")).toBe(colours.bubble);
    expect(
      await style(log.getByText("你好", { exact: true }), "background-color"),
    ).toBe(await resolve(page, "var(--accent)"));
  });

test("own messages use the brand colour, replies the bubble colour, with one sans face on every width", async ({
  page,
}) => {
  const faces: string[] = [];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 844 });
    const log = await conversation(page);
    const own = log.getByText("你好", { exact: true });
    const reply = replyBubble(log);
    expect(await style(own, "background-color")).toBe(
      await resolve(page, "var(--accent)"),
    );
    expect(await style(own, "color")).toBe(
      await resolve(page, "var(--accent-ink)"),
    );
    expect(await style(reply, "background-color")).toBe(
      await resolve(page, "var(--bubble)"),
    );
    // Bubbles carry no shadow, are 18px round and tuck in the sender's corner.
    expect(await style(reply, "box-shadow")).toMatch(FLAT);
    expect(parseFloat(await style(own, "border-top-left-radius"))).toBe(18);
    expect(parseFloat(await style(own, "border-bottom-right-radius"))).toBe(5);
    expect(parseFloat(await style(reply, "border-bottom-left-radius"))).toBe(5);
    expect(parseFloat(await style(reply, "border-bottom-right-radius"))).toBe(
      18,
    );
    // The time between turns is plain centred text, not a pill.
    const time = log.locator("time").first().locator("..");
    expect(await style(time, "background-color")).toMatch(
      /^(rgba\(0, 0, 0, 0\)|transparent)$/,
    );
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

test("desktop messages keep a 600px column and show actions only on hover or focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const log = await conversation(page);
  const reply = replyBubble(log);
  const own = log.getByText("你好", { exact: true });
  const [r, o] = await Promise.all([reply.boundingBox(), own.boundingBox()]);
  expect(o!.x + o!.width - r!.x).toBeLessThanOrEqual(600);
  // Even the latest reply hides its actions until it is pointed at.
  await page.mouse.move(0, 0);
  const copy = log.getByRole("button", { name: "复制", exact: true });
  for (const button of await copy.all())
    expect(await style(button.locator(".."), "opacity")).toBe("0");
  await reply.hover();
  await expect
    .poll(() => style(copy.last().locator(".."), "opacity"))
    .toBe("1");
});

/** Row tones of the built-in palette: selected, pinned, light then dark. */
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

/** Whether a mouse down at this point starts a window drag (Tauri 2.12 drag.js). */
function dragsWindow(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const clickable = (el: HTMLElement) =>
        [
          "A",
          "BUTTON",
          "INPUT",
          "SELECT",
          "TEXTAREA",
          "LABEL",
          "SUMMARY",
        ].includes(el.tagName) ||
        (el.hasAttribute("contenteditable") &&
          el.getAttribute("contenteditable") !== "false") ||
        (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
        ["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"]
          .concat("option")
          .includes(el.getAttribute("role") ?? "");
      const hit = document.elementFromPoint(x, y) as HTMLElement;
      for (let el: HTMLElement | null = hit; el; el = el.parentElement) {
        const region = el.getAttribute("data-tauri-drag-region");
        if (region === null && clickable(el)) return false;
        if (region === null) continue;
        if (region === "false") return false;
        return region === "deep" || el === hit;
      }
      return false;
    },
    [x, y],
  );
}

test("the empty conversation pane drags the window from its top band", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const pane = page.getByRole("main");
  await expect(pane).toContainText("欢迎使用 Plums");
  const box = (await pane.boundingBox())!;
  for (const x of [box.x + 24, box.x + box.width / 2, box.x + box.width - 80])
    expect(await dragsWindow(page, x, box.y + 26)).toBe(true);
  // The welcome itself stays plain content.
  expect(await dragsWindow(page, box.x + box.width / 2, box.y + 200)).toBe(
    false,
  );
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
  await openSettings(page);
  await expect(page.getByRole("dialog", { name: "应用设置" })).toBeVisible();
  expect(await chooserOpens()).toBe(false);
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "消息", exact: true }).focus();
  expect(await chooserOpens()).toBe(true);
});

test("the conversation header keeps the session chip, more and the sidebar button on one line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await addAgent(page, "对齐助手");
  const chat = page.getByRole("region", { name: "对齐助手 的会话" });
  const middle = async (name: string) => {
    const box = await page.getByRole("button", { name }).first().boundingBox();
    return box!.y + box!.height / 2;
  };
  const toggle = await middle("展开或收起右侧栏");
  expect(Math.abs(toggle - (await middle("更多操作")))).toBeLessThanOrEqual(1);
  expect(
    Math.abs(toggle - (await middle("会话：未命名会话"))),
  ).toBeLessThanOrEqual(1);
  const heading = await chat
    .locator("header")
    .getByRole("heading", { name: "对齐助手" })
    .boundingBox();
  expect(
    Math.abs(toggle - (heading!.y + heading!.height / 2)),
  ).toBeLessThanOrEqual(2);
  // New conversations live in the session menu, not beside it.
  await expect(chat.getByRole("button", { name: "新建会话" })).toHaveCount(0);
  await chat.getByRole("button", { name: "会话：未命名会话" }).click();
  await expect(page.getByRole("menuitem", { name: "新建会话" })).toBeVisible();
});

test("phone replies carry no name label above them", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  const log = await conversation(page);
  await expect(log.getByText("编程助手", { exact: true })).toHaveCount(0);
});

for (const width of [1280, 375]) {
  test(`the message box is one card with attach, text, model and a round send button at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await conversation(page);
    const text = page.getByRole("textbox", { name: "消息", exact: true });
    const plus = page.getByRole("button", { name: "添加附件" });
    const model = page.getByRole("combobox", { name: "切换模型" });
    const send = page.getByRole("button", { name: "发送", exact: true });
    const card = page.getByRole("group").filter({ has: text });
    expect(parseFloat(await style(card, "border-top-left-radius"))).toBe(18);
    expect(await style(card, "box-shadow")).toMatch(FLAT);
    const [t, p, m, s] = await Promise.all([
      text.boundingBox(),
      plus.boundingBox(),
      model.boundingBox(),
      send.boundingBox(),
    ]);
    const centre = (box: typeof t) => box!.y + box!.height / 2;
    // Model and send always share a row, in that order.
    expect(Math.abs(centre(m) - centre(s))).toBeLessThan(6);
    expect(m!.x + m!.width).toBeLessThanOrEqual(s!.x);
    if (width >= 768) {
      // Desktop: one row, attach first and send last.
      for (const box of [p, m])
        expect(Math.abs(centre(box) - centre(s))).toBeLessThan(6);
      expect(p!.x + p!.width).toBeLessThanOrEqual(t!.x);
      expect(t!.x + t!.width).toBeLessThanOrEqual(m!.x);
    } else {
      // Phones keep the text on its own row above the controls.
      expect(m!.y).toBeGreaterThanOrEqual(t!.y + t!.height - 2);
    }
    // A circle.
    expect(s!.width).toBeLessThanOrEqual(46);
    expect(Math.abs(s!.width - s!.height)).toBeLessThan(2);
    expect(
      parseFloat(await style(send, "border-top-left-radius")),
    ).toBeGreaterThanOrEqual(s!.width / 2 - 1);
    // With nothing to send it turns grey instead of a faded brand colour.
    await page.mouse.move(0, 0);
    await expect(send).toBeDisabled();
    expect(await style(send, "opacity")).toBe("1");
    const grey = await resolve(page, "var(--subtle)");
    await expect.poll(() => style(send, "background-color")).toBe(grey);
    await text.fill("再来");
    await expect(send).toBeEnabled();
    const brand = await resolve(page, "var(--accent)");
    await expect.poll(() => style(send, "background-color")).toBe(brand);
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
