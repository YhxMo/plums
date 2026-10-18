import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { manage } from "./helpers";

const starter = readFileSync("extensions/examples/starter-text-service.js");
const service = (id: string, prefix: string) =>
  Buffer.from(`export default {
  manifest: { id: "${id}", version: "${prefix}", apiVersion: 1, provides: { "text.transform": 1 } },
  activate(ctx) {
    ctx.provide("text.transform", 1, { name: "${prefix}", async transform(input) { return "${prefix}：" + input; } });
  },
};`);

async function openInstall(page: Page) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  return page.getByRole("dialog", { name: "安装扩展" });
}
async function importFile(page: Page, name: string, buffer: Buffer) {
  const dialog = await openInstall(page);
  await dialog
    .getByLabel("选择扩展文件")
    .setInputFiles({ name, mimeType: "text/javascript", buffer });
  return dialog;
}
async function useService(page: Page, id: string) {
  const stop = page.getByRole("button", {
    name: "停用 transform.upper",
    exact: true,
  });
  if (await stop.isVisible()) await stop.click();
  await page.getByRole("button", { name: `启用 ${id}`, exact: true }).click();
  await expect(
    page.getByRole("button", { name: `停用 ${id}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
}
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}
async function addAgent(page: Page) {
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("作者");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
}

test("an imported file drives the Agent and stays installed after reload", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await importFile(page, "starter.js", starter);
  const summary = dialog.getByRole("definition");
  await expect(dialog).toContainText("starter.text-service");
  await expect(dialog).toContainText("text.transform@1");
  await expect(summary.filter({ hasText: "本地导入的文件 · " })).toBeVisible();
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("扩展已导入");
  await useService(page, "starter.text-service");
  await addAgent(page);
  await send(page, "你好");
  await expect(page.getByRole("log")).toContainText("你写了 2 个字：你好");
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("button", {
      name: "启用 starter.text-service",
      exact: true,
    }),
  ).toBeVisible();
});

test("re-importing the same ID replaces the code and requires enabling again", async ({
  page,
}) => {
  await page.goto("/");
  let dialog = await importFile(page, "echo.js", service("author.echo", "一"));
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await useService(page, "author.echo");
  await addAgent(page);
  await send(page, "hi");
  await expect(page.getByRole("log")).toContainText("一：hi");
  dialog = await importFile(page, "echo.js", service("author.echo", "二"));
  await expect(dialog).toContainText("将替换已导入的同 ID 扩展");
  await dialog.getByRole("button", { name: "替换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已替换为新版本" }),
  ).toBeVisible();
  await useService(page, "author.echo");
  await page.getByRole("button", { name: "与 作者 交互", exact: true }).click();
  await send(page, "again");
  await expect(page.getByRole("log")).toContainText("二：again");
});

test("a dropped file is previewed and nothing is saved until confirmed", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openInstall(page);
  const transfer = await page.evaluateHandle((source) => {
    const data = new DataTransfer();
    data.items.add(new File([source], "drop.js", { type: "text/javascript" }));
    return data;
  }, service("author.drop", "拖").toString());
  await dialog
    .getByText("也可以把文件拖到这里")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dialog).toContainText("author.drop");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用 author.drop", exact: true }),
  ).toHaveCount(0);
  const saved = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.includes("host.shell+")),
  );
  expect(saved).toEqual([]);
});

test("a file cannot take over a built-in extension ID", async ({ page }) => {
  await page.goto("/");
  const dialog = await importFile(
    page,
    "upper.js",
    service("transform.upper", "冒"),
  );
  await expect(dialog.getByRole("alert")).toContainText("内置扩展");
  await expect(
    dialog.getByRole("button", { name: "导入", exact: true }),
  ).toHaveCount(0);
});
