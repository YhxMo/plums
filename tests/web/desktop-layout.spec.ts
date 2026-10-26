import { expect, test } from "@playwright/test";
import { addAgent } from "./helpers";

for (const width of [652, 700, 735]) {
  test(`a ${width}px desktop keeps the Agent list beside the conversation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 });
    await page.goto("/");
    await addAgent(page, "助手 A");
    const list = page.getByRole("complementary", { name: "Agent 列表" });
    await addAgent(page, "助手 B");
    await page.setViewportSize({ width, height: 680 });
    await expect(list).toBeVisible();
    const rail = page.getByRole("navigation", { name: "应用导航" });
    await expect(rail).toBeVisible();
    await list.getByRole("button", { name: "助手 A", exact: true }).click();
    const input = page.getByRole("textbox", { name: "消息", exact: true });
    await input.fill("助手 A 的草稿");
    await list.getByRole("button", { name: "助手 B", exact: true }).click();
    await input.fill("助手 B 的草稿");
    await list.getByRole("button", { name: "助手 A", exact: true }).click();
    await expect(input).toHaveValue("助手 A 的草稿");
    await expect(
      page.getByRole("button", { name: "返回 Agent 列表" }),
    ).toBeHidden();
    const chat = page.getByRole("region", { name: "助手 A 的会话" });
    const a = (await list.boundingBox())!;
    const b = (await chat.boundingBox())!;
    expect(a.width).toBeGreaterThanOrEqual(207.5);
    expect(b.width).toBeGreaterThanOrEqual(359.5);
    expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(7.5);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
}

test("single-pane mode starts only below the two-column minimum and keeps the draft", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await addAgent(page, "边界助手");
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  const list = page.getByRole("complementary", { name: "Agent 列表" });
  await input.fill("跨窗口宽度保留");
  for (const width of [652, 651, 375, 735, 960]) {
    await page.setViewportSize({ width, height: 680 });
    await expect(input).toHaveValue("跨窗口宽度保留");
    if (width >= 652) {
      await expect(list).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "应用导航" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "返回 Agent 列表" }),
      ).toBeHidden();
    } else {
      await expect(list).toBeHidden();
      await expect(
        page.getByRole("navigation", { name: "应用导航" }),
      ).toBeHidden();
      await expect(
        page.getByRole("button", { name: "返回 Agent 列表" }),
      ).toBeVisible();
    }
  }
});

for (const width of [940, 1440])
  test(`the Agent details are a 288px drawer at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await addAgent(page, "详情助手");
    await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
    const drawer = page.getByRole(width > 1100 ? "complementary" : "dialog", {
      name: "Agent 详情",
    });
    await expect(drawer).toBeVisible();
    // Past the slide-in; the inline panel sits inside the sheet's hairline
    // edges, which a 1x screen draws as whole pixels.
    await expect
      .poll(async () => Math.round((await drawer.boundingBox())!.width))
      .toBe(width > 1100 ? 286 : 288);
    // Wide windows move the conversation aside instead of covering it.
    if (width > 1100) {
      const edge = (await drawer.boundingBox())!.x;
      const chat = page.getByRole("region", { name: "详情助手 的会话" });
      await expect
        .poll(async () => {
          const box = (await chat.boundingBox())!;
          return box.x + box.width <= edge;
        })
        .toBe(true);
    }
  });

test("the sidebar button sits centred on the conversation card's header, also after extension management", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await addAgent(page, "居中助手");
  const toggle = page.getByRole("button", { name: "展开或收起右侧栏" });
  const chat = page.getByRole("region", { name: "居中助手 的会话" });
  const header = chat.locator("header").first();
  const button = (await toggle.boundingBox())!;
  const card = (await chat.boundingBox())!;
  const bar = (await header.boundingBox())!;
  // Centred on the header (within the hairline edge), as far in from the
  // card's right edge as from its top.
  const centre = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(centre(button) - centre(bar))).toBeLessThanOrEqual(1);
  expect(card.x + card.width - button.x - button.width).toBeCloseTo(
    button.y - card.y,
    0,
  );
  // Management is framed by the shell; leaving it puts the button back.
  await page.getByRole("button", { name: "扩展", exact: true }).click();
  await expect(toggle).toBeHidden();
  await page.getByRole("button", { name: "返回" }).first().click();
  await expect(toggle).toBeVisible();
  expect((await toggle.boundingBox())!.y).toBeCloseTo(button.y, 0);
});
