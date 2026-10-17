import { expect, test, type Page } from "@playwright/test";
import { manage } from "./helpers";
async function seed(page: Page, bad = false) {
  await page.goto("/");
  await page.evaluate((bad) => {
    const ids = ["counter", "events", "panel"];
    localStorage.setItem(
      "plums:m1:host.shell",
      JSON.stringify({
        schema: 1,
        revision: 1,
        value: {
          version: 1,
          theme: "light",
          layout: "sample.panel",
          agents: [],
          imports: ids.map((id) => ({
            id: "sample." + id,
            url: "/examples/" + id + ".js",
            label: id,
          })),
          composition: {
            schema: 1,
            enabled: ids.map((id) => ({
              id: "sample." + id,
              version: id === "events" ? "1.0.0" : "1.1.0",
            })),
          },
          ...(bad
            ? {
                configurations: {
                  "sample.counter": { version: 99, values: { step: 5 } },
                },
              }
            : {}),
        },
      }),
    );
  }, bad);
  await page.reload();
  await manage(page, true);
}
test("ordinary fields apply, persist on reload, remain isolated and survive uninstall", async ({
  page,
}) => {
  await seed(page);
  await page
    .getByRole("button", { name: "配置 sample.counter", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "扩展配置" });
  await dialog.getByLabel("每次增加量").fill("3");
  await dialog.getByRole("button", { name: "保存并应用" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "配置 sample.panel", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "扩展配置" });
  await dialog.getByLabel("面板标题").fill("Configured panel");
  await dialog.getByLabel("显示计数").uncheck();
  await dialog.getByRole("button", { name: "保存并应用" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Configured panel" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await manage(page);
  await page
    .getByRole("button", { name: "配置 sample.panel", exact: true })
    .click();
  await page.getByLabel("显示计数").check();
  await page.getByRole("button", { name: "保存并应用" }).click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "增加计数" }).click();
  await expect(page.getByText("计数：3", { exact: true })).toBeVisible();
  await manage(page);
  await page
    .getByRole("button", { name: "卸载 sample.counter", exact: true })
    .click();
  await page.getByRole("button", { name: "保留数据并卸载" }).click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("plums:m1:host.shell")!).value
          .configurations["sample.counter"].values.step,
    ),
  ).toBe(3);
});
test("cancel and failed persistence preserve prior configuration", async ({
  page,
}) => {
  await seed(page);
  const before = await page.evaluate(() =>
    localStorage.getItem("plums:m1:host.shell"),
  );
  const trigger = page.getByRole("button", {
    name: "配置 sample.counter",
    exact: true,
  });
  await trigger.evaluate((b: HTMLButtonElement) => b.click());
  const dialog = page.getByRole("dialog", { name: "扩展配置" });
  await dialog.getByLabel("每次增加量").fill("9");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByLabel("注入存储写入失败").check();
  await trigger.click();
  await dialog.getByLabel("每次增加量").fill("4");
  await dialog.getByRole("button", { name: "保存并应用" }).click();
  await expect(dialog.getByRole("alert")).toContainText("未完成");
  expect(
    await page.evaluate(() => localStorage.getItem("plums:m1:host.shell")),
  ).toBe(before);
});
test("incompatible stored configuration waits without overwriting original until explicit edit", async ({
  page,
}) => {
  await seed(page, true);
  await expect(
    page.getByText("扩展配置无效：扩展配置损坏，原数据已保留。", {
      exact: true,
    }),
  ).toBeVisible();
  const before = await page.evaluate(() =>
    localStorage.getItem("plums:m1:host.shell"),
  );
  await page
    .getByRole("button", { name: "配置 sample.counter", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "原配置无效：扩展配置损坏，原数据已保留。",
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("plums:m1:host.shell")),
  ).toBe(before);
  await page
    .getByRole("button", { name: "配置 sample.counter", exact: true })
    .click();
  await page.getByRole("button", { name: "保存并应用", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "扩展配置" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "停用 sample.counter", exact: true }),
  ).toBeVisible();
});
