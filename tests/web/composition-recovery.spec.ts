import { expect, test } from "@playwright/test";
const key = "plums:host.shell";
async function broken(page: import("@playwright/test").Page) {
  await page.goto("/");
  const value = {
    version: 1,
    agents: [],
    imports: [],
    theme: "dark",
    layout: "agents",
    composition: { schema: 99, enabled: [] },
  };
  const raw = JSON.stringify({ schema: 1, revision: 2, value });
  await page.evaluate(
    ([key, raw]) => localStorage.setItem(key, raw),
    [key, raw],
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("组合配置");
  return { raw, value };
}
test("cancel preserves data; confirmed recovery backs up original and cold reload keeps unrelated settings", async ({
  page,
}) => {
  const { raw, value } = await broken(page);
  const trigger = page.getByRole("button", {
    name: "恢复默认组合",
    exact: true,
  });
  await trigger.evaluate((button: HTMLButtonElement) => {
    button.blur();
    button.click();
  });
  const dialog = page.getByRole("dialog", { name: "恢复默认组合" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    raw,
  );
  await trigger.click();
  await dialog.getByRole("button", { name: "备份并重置组合" }).click();
  await expect(page.getByRole("alert")).toContainText("组合已重置");
  await expect(page.getByRole("button", { name: "重新加载" })).toBeFocused();
  const state = await page.evaluate(
    (key) => ({
      current: JSON.parse(localStorage.getItem(key)!),
      backups: Object.keys(localStorage)
        .filter((k) => k.startsWith("plums:host.recovery."))
        .map((k) => JSON.parse(localStorage.getItem(k)!)),
    }),
    key,
  );
  expect(state.backups).toHaveLength(1);
  expect(state.backups[0].value).toEqual(value);
  const { composition, ...rest } = value;
  expect(state.current.value).toEqual(rest);
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByRole("heading", { name: "我的 Agent" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
test("failed backup never resets source and requires reload before retry", async ({
  page,
}) => {
  const { raw } = await broken(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("plums:host.recovery."))
        throw new Error("synthetic backup failure");
      set.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "恢复默认组合", exact: true }).click();
  await page.getByRole("button", { name: "备份并重置组合" }).click();
  await expect(page.getByRole("alert")).toContainText("恢复未确认完成");
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
    raw,
  );
  await expect(page.getByRole("button", { name: "重新加载" })).toBeFocused();
  await expect(
    page.getByRole("button", { name: "恢复默认组合", exact: true }),
  ).toHaveCount(0);
});
