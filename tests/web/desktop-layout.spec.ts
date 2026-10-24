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
    await list.getByRole("button", { name: "添加", exact: true }).click();
    await page.getByRole("button", { name: /^添加 Agent 写下/ }).click();
    await page
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("助手 B");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "添加", exact: true })
      .click();
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
