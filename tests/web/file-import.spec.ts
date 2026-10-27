import { zipSync, strToU8 } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import {
  manage,
  persisted,
  addAgent,
  backToWorkspace,
  closeDetails,
} from "./helpers";

const starter = "extensions/examples/starter-model";
/** A package's two files for a chat service; its top level marks that it ran. */
const service = (id: string, prefix: string) => ({
  manifest: JSON.stringify({
    id,
    version: prefix,
    apiVersion: 1,
    provides: { chat: 1 },
  }),
  main: `globalThis.__ran = (globalThis.__ran ?? 0) + 1;
export default {
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "${prefix}",
      models: () => [{ id: "m", label: "${prefix}", description: "" }],
      subscribe: () => () => {},
      async reply({ input }) { return "${prefix}：" + input; },
    });
  },
};`,
});
const zip = (files: { manifest: string; main: string }, folder = "pkg/") =>
  Buffer.from(
    zipSync({
      [`${folder}manifest.json`]: strToU8(files.manifest),
      [`${folder}main.js`]: strToU8(files.main),
    }),
  );
const ran = (page: Page) =>
  page.evaluate(() => (globalThis as { __ran?: number }).__ran ?? 0);

async function openInstall(page: Page) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  return page.getByRole("dialog", { name: "安装扩展" });
}
async function importZip(page: Page, buffer: Buffer) {
  const dialog = await openInstall(page);
  await dialog
    .getByLabel("选择扩展包")
    .setInputFiles({ name: "pkg.zip", mimeType: "application/zip", buffer });
  return dialog;
}
async function useService(page: Page, id: string) {
  // The cards' switches are reachable once no details cover them.
  if (await page.getByRole("region", { name: "所选扩展详情" }).count())
    await closeDetails(page);
  const enable = page.getByRole("switch", { name: `启用 ${id}`, exact: true });
  // The list is rendered once the imported extension shows.
  await expect(enable).toBeVisible();
  const stop = page.getByRole("switch", {
    name: "启用 chat.echo",
    exact: true,
  });
  if ((await stop.count()) && (await stop.isChecked())) await stop.click();
  await enable.click();
  await expect(
    page.getByRole("switch", { name: `启用 ${id}`, exact: true }),
  ).toBeChecked();
  await backToWorkspace(page);
}
async function send(page: Page, text: string) {
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

test("an imported folder drives the Agent and stays enabled after reload", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openInstall(page);
  await dialog.getByLabel("选择文件夹").setInputFiles(starter);
  // Plain words first: name, author, what it does, what it may use.
  await expect(dialog.getByLabel("导入内容")).toContainText("起步模型");
  await expect(dialog.getByLabel("导入内容")).toContainText("Plums 起步模板");
  await expect(dialog.getByLabel("导入内容")).toContainText(
    "统计字数后回显你的消息",
  );
  await expect(dialog.getByLabel("导入内容")).toContainText("不需要额外权限");
  await expect(dialog).not.toContainText("starter.model");
  await expect(dialog).not.toContainText("chat@1");
  // The ID, version, services and source wait under 技术详情.
  await dialog.getByRole("button", { name: "技术详情" }).click();
  const technical = dialog.getByLabel("技术详情");
  await expect(technical).toContainText("starter.model");
  await expect(technical).toContainText("chat@1");
  await expect(technical).toContainText("导入的扩展包 ");
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("扩展已导入");
  await page.getByRole("button", { name: "起步模型", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "所选扩展详情" }),
  ).toContainText("统计字数后回显你的消息，不联网、不保存数据。");
  await useService(page, "starter.model");
  await addAgent(page, "作者");
  await send(page, "你好");
  await expect(page.getByRole("log")).toContainText("你写了 2 个字：你好");
  await persisted(page, "starter.model");
  await page.reload();
  await manage(page);
  await expect(
    page.getByRole("switch", { name: "启用 starter.model", exact: true }),
  ).toBeVisible();
});

test("re-importing the same ID replaces the code and requires enabling again", async ({
  page,
}) => {
  await page.goto("/");
  let dialog = await importZip(page, zip(service("author.echo", "一")));
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await useService(page, "author.echo");
  await addAgent(page, "作者");
  await send(page, "hi");
  await expect(page.getByRole("log")).toContainText("一：hi");
  dialog = await importZip(page, zip(service("author.echo", "二")));
  await expect(dialog).toContainText("将替换已导入的同 ID 扩展");
  await dialog.getByRole("button", { name: "替换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已替换为新版本" }),
  ).toBeVisible();
  await useService(page, "author.echo");
  await page.getByRole("button", { name: "作者", exact: true }).click();
  await send(page, "again");
  await expect(page.getByRole("log")).toContainText("二：again");
});

test("a dropped zip is previewed without running its code, and nothing is saved until confirmed", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openInstall(page);
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "drop.zip", {
          type: "application/zip",
        }),
      );
      return data;
    },
    [...zip(service("author.drop", "拖"))],
  );
  const area = dialog.getByText("也可以把文件夹或 zip 拖到这里");
  await area.dispatchEvent("drop", { dataTransfer: transfer });
  await expect(dialog).toContainText("author.drop");
  expect(await ran(page)).toBe(0);
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "启用 author.drop", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("plums:host.shell#records")),
  ).toBeNull();
  expect(await ran(page)).toBe(0);
  // Confirming is what runs it.
  const again = await importZip(page, zip(service("author.drop", "拖")));
  await again.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("扩展已导入");
  expect(await ran(page)).toBe(1);
});

test("the two files can be picked together, and a broken manifest is explained", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openInstall(page);
  const files = service("author.pair", "对");
  await dialog.getByLabel("选择扩展包").setInputFiles([
    {
      name: "manifest.json",
      mimeType: "application/json",
      buffer: Buffer.from(files.manifest),
    },
    {
      name: "main.js",
      mimeType: "text/javascript",
      buffer: Buffer.from(files.main),
    },
  ]);
  await expect(dialog).toContainText("author.pair");
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await dialog.getByLabel("选择扩展包").setInputFiles([
    {
      name: "manifest.json",
      mimeType: "application/json",
      buffer: Buffer.from("{"),
    },
    {
      name: "main.js",
      mimeType: "text/javascript",
      buffer: Buffer.from(files.main),
    },
  ]);
  await expect(dialog.getByRole("alert")).toContainText(
    "manifest.json 不是有效的 JSON",
  );
  expect(await ran(page)).toBe(0);
});

test("a package cannot take over a built-in extension ID", async ({ page }) => {
  await page.goto("/");
  const dialog = await importZip(page, zip(service("transform.upper", "冒")));
  await expect(dialog.getByRole("alert")).toContainText("内置扩展");
  await expect(
    dialog.getByRole("button", { name: "导入", exact: true }),
  ).toHaveCount(0);
});

test("a single file imported before packages asks to be imported again", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("plums:host.shell")) return;
    localStorage.setItem(
      "plums:host.shell",
      JSON.stringify({
        schema: 1,
        revision: 1,
        value: {
          version: 1,
          imports: [
            {
              id: "author.old",
              url: `imported:sha256:${"a".repeat(64)}`,
              label: "旧扩展",
            },
          ],
        },
      }),
    );
  });
  await page.goto("/");
  await manage(page);
  await expect(page.locator("#extension-manager")).toContainText(
    "需要按新格式",
  );
});
