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
  light: { selected: "rgb(232, 105, 47)", pinned: "rgb(230, 230, 232)" },
  dark: { selected: "rgb(232, 105, 47)", pinned: "rgb(59, 59, 61)" },
} as const;

for (const scheme of ["light", "dark"] as const)
  test(`the list shows selected, pinned and plain rows in three tones, pinned first (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    for (const name of ["甲", "乙", "丙"]) {
      const start = page.getByRole("button", {
        name: "从头添加 Agent",
        exact: true,
      });
      if (await start.isVisible()) await addAgent(page, name);
      else {
        await page.getByRole("button", { name: "添加", exact: true }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /添加 Agent/ })
          .click();
        await page
          .getByRole("textbox", { name: "名称", exact: true })
          .fill(name);
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "添加", exact: true })
          .click();
      }
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    const list = page.getByRole("complementary", { name: "Agent 列表" });
    await list.getByRole("button", { name: "丙 的操作", exact: true }).click();
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
      .poll(() =>
        style(
          row("乙").locator("[data-slot=row-selected]"),
          "background-color",
        ),
      )
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
