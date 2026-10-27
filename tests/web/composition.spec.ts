import { expect, test } from "@playwright/test";
import {
  manage,
  persisted,
  installByPath,
  selectExtension,
  closeDetails,
} from "./helpers";
test("the enabled provider choice is kept for the next start without saving", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await expect(
    page.getByRole("button", { name: "保存当前组合", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("switch", { name: "启用 transform.upper", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "启用 transform.reverse", exact: true })
    .click();
  await persisted(page, "transform.reverse");
  await persisted(page, "transform.upper", false);
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("switch", { name: "启用 transform.reverse", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "启用 transform.upper", exact: true }),
  ).not.toBeChecked();
});
test("a failed write keeps the previous record and imported uninstall prunes it", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page, true);
  await page
    .getByRole("switch", { name: "启用 transform.upper", exact: true })
    .click();
  await persisted(page, "transform.upper", false);
  const before = await page.evaluate(() =>
    localStorage.getItem("plums:host.shell"),
  );
  if (await page.getByRole("region", { name: "所选扩展详情" }).count())
    await closeDetails(page);
  await page.getByLabel("注入存储写入失败").check();
  await page
    .getByRole("switch", { name: "启用 transform.upper", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("扩展启用状态未保存");
  expect(
    await page.evaluate(() => localStorage.getItem("plums:host.shell")),
  ).toBe(before);
  if (await page.getByRole("region", { name: "所选扩展详情" }).count())
    await closeDetails(page);
  await page.getByLabel("注入存储写入失败").uncheck();
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  await installByPath(page, "/examples/counter/");
  await page
    .getByRole("switch", { name: "启用 sample.counter", exact: true })
    .click();
  await persisted(page, "sample.counter");
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("switch", { name: "启用 sample.counter", exact: true }),
  ).toBeChecked();
  await selectExtension(page, "sample.counter");
  await page
    .getByRole("button", { name: "卸载 sample.counter", exact: true })
    .click();
  await page
    .getByRole("button", { name: "保留数据并卸载", exact: true })
    .click();
  await persisted(page, "sample.counter", false);
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("button", { name: "卸载 sample.counter", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("missing extensions are skipped and a changed version still starts", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("switch", { name: "启用 transform.upper", exact: true })
    .click();
  await persisted(page, "transform.upper", false);
  await page.evaluate(() => {
    const key = "plums:host.shell";
    const data = JSON.parse(localStorage.getItem(key)!);
    data.value.composition.enabled.push(
      { id: "missing.extension", version: "1" },
      { id: "transform.upper", version: "unavailable" },
    );
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("switch", { name: "启用 transform.upper", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("an unknown composition schema preserves original state and offers recovery", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("switch", { name: "启用 transform.upper", exact: true })
    .click();
  await persisted(page, "transform.upper", false);
  const raw = await page.evaluate(() => {
    const key = "plums:host.shell";
    const data = JSON.parse(localStorage.getItem(key)!);
    data.value.composition = { schema: 99, enabled: [] };
    const raw = JSON.stringify(data);
    localStorage.setItem(key, raw);
    return raw;
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("组合配置");
  expect(
    await page.evaluate(() => localStorage.getItem("plums:host.shell")),
  ).toBe(raw);
});
