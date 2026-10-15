import { expect, test } from "@playwright/test";
import { manage } from "./helpers";
test("saved provider choice restores on reload without enabling the previous provider", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "停用 transform.upper", exact: true })
    .click();
  await page
    .getByRole("button", { name: "启用 transform.reverse", exact: true })
    .click();
  await page.getByRole("button", { name: "保存当前组合", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("当前组合已保存");
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("button", { name: "停用 transform.reverse", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "启用 transform.upper", exact: true }),
  ).toBeVisible();
});
test("save failure retains previous composition and imported uninstall prunes saved set", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page, true);
  await page.getByRole("button", { name: "保存当前组合", exact: true }).click();
  const before = await page.evaluate(() =>
    localStorage.getItem("plums:m1:host.shell"),
  );
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "保存当前组合", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("plums:m1:host.shell")),
  ).toBe(before);
  await page.getByLabel("注入存储写入失败").uncheck();
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "安装扩展" });
  await dialog.getByLabel("扩展 ID").fill("sample.counter");
  await dialog.getByLabel("模块路径").fill("/examples/counter.js");
  await dialog.getByRole("button", { name: "加载模块" }).click();
  await page
    .getByRole("button", { name: "启用 sample.counter", exact: true })
    .click();
  await page.getByRole("button", { name: "保存当前组合", exact: true }).click();
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("button", { name: "停用 sample.counter", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "卸载 sample.counter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保留数据并卸载", exact: true })
    .click();
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("button", { name: "卸载 sample.counter", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
for (const kind of ["missing", "version", "schema"])
  test(`${kind} composition preserves original state and diagnoses restoration`, async ({
    page,
  }) => {
    await page.goto("/");
    await manage(page);
    await page
      .getByRole("button", { name: "保存当前组合", exact: true })
      .click();
    const raw = await page.evaluate((kind) => {
      const key = "plums:m1:host.shell";
      const data = JSON.parse(localStorage.getItem(key)!);
      data.value.composition =
        kind === "schema"
          ? { schema: 99, enabled: [] }
          : {
              schema: 1,
              enabled: [
                {
                  id:
                    kind === "missing"
                      ? "missing.extension"
                      : "transform.upper",
                  version: "unavailable",
                },
              ],
            };
      const raw = JSON.stringify(data);
      localStorage.setItem(key, raw);
      return raw;
    }, kind);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText(
      kind === "schema" ? "组合配置" : "组合未完整恢复",
    );
    expect(
      await page.evaluate(() => localStorage.getItem("plums:m1:host.shell")),
    ).toBe(raw);
  });
