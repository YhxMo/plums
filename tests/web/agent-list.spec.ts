import { expect, test, type Locator } from "@playwright/test";
import { addAgent } from "./helpers";

const style = (target: Locator, property: string) =>
  target.evaluate(
    (el, property) => getComputedStyle(el).getPropertyValue(property),
    property,
  );

/** The names of the list's rows, top to bottom. */
const order = (list: Locator) =>
  list
    .locator("[data-slot=agent-row]")
    .evaluateAll((all) =>
      all.map((el) => el.querySelector("strong")!.textContent),
    );

const rows = {
  light: { selected: "rgb(247, 107, 21)", pinned: "rgb(232, 232, 232)" },
  dark: { selected: "rgb(247, 107, 21)", pinned: "rgb(42, 42, 42)" },
} as const;

for (const scheme of ["light", "dark"] as const)
  test(`the list shows selected, pinned and plain rows in three tones, pinned first (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    for (const name of ["甲", "乙", "丙"]) {
      await addAgent(page, name);
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    const list = page.getByRole("complementary", { name: "Agent 列表" });
    await list
      .getByRole("button", { name: "丙", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "置顶", exact: true }).click();
    await list.getByRole("button", { name: "乙", exact: true }).click();
    const row = (name: string) =>
      list.locator("[data-agent-row]", {
        has: page.getByRole("button", { name, exact: true }),
      });
    // Pinned rows come first; the rest by latest activity, newest first.
    await expect.poll(() => order(list)).toEqual(["丙", "乙", "甲"]);
    // The selected row is the current one; its name is the visible name.
    await expect(
      list.getByRole("button", { name: "乙", exact: true }),
    ).toHaveAttribute("aria-current", "true");
    await expect(
      list.locator("[data-slot=agent-row]:not([aria-current])"),
    ).toHaveCount(2);
    const tones = rows[scheme];
    await expect
      .poll(() => style(row("乙"), "background-color"))
      .toBe(tones.selected);
    expect(await style(row("乙").locator("strong"), "color")).toBe(
      "rgb(255, 255, 255)",
    );
    expect(await style(row("丙"), "background-color")).toBe(tones.pinned);
    expect(await style(row("甲"), "background-color")).toMatch(
      /^(rgba\(0, 0, 0, 0\)|transparent)$/,
    );
    // Full-width 68px rows with no rounding, no section headings or tiles.
    const box = await row("甲").boundingBox();
    const listBox = await list.boundingBox();
    expect(box!.height).toBe(68);
    expect(box!.width).toBe(listBox!.width);
    expect(parseFloat(await style(row("丙"), "border-top-left-radius"))).toBe(
      0,
    );
    await expect(list.getByRole("heading", { name: "特别关注" })).toHaveCount(
      0,
    );
    await expect(list.locator("[data-slot=agent-tile]")).toHaveCount(0);
    // Unpinning returns the row to its place, and a reply moves its Agent up.
    await row("丙").click({ button: "right" });
    await page.getByRole("menuitem", { name: "取消置顶", exact: true }).click();
    await expect.poll(() => order(list)).toEqual(["丙", "乙", "甲"]);
    await list.getByRole("button", { name: "甲", exact: true }).click();
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("你好");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(() => order(list)).toEqual(["甲", "丙", "乙"]);
    // The last message and its time describe the row.
    await expect(
      list.getByRole("button", { name: "甲", exact: true }),
    ).toHaveAccessibleDescription(/^echo-a｜第 1 轮.* \d{2}:\d{2}$/);
  });

test("Agent 设置 opens any row's details in a dialog without switching the chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  for (const name of ["甲", "乙"]) {
    await addAgent(page, name, { description: `${name}的介绍` });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  const list = page.getByRole("complementary", { name: "Agent 列表" });
  const other = list.getByRole("button", { name: "甲", exact: true });
  await expect(
    list.getByRole("button", { name: "乙", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  // Rows have no … button; their actions are in the right-click menu.
  await expect(list.getByRole("button", { name: /的操作$/ })).toHaveCount(0);
  await other.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Agent 设置…", exact: true })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Agent 设置",
    exact: true,
  });
  await expect(settings).toBeVisible();
  await expect(settings).toContainText("甲的介绍");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(other).toBeFocused();
  await expect(
    list.getByRole("button", { name: "乙", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  // The conversation's … menu offers the same for the open Agent.
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Agent 设置…", exact: true })
    .click();
  await expect(settings).toContainText("乙的介绍");
});
