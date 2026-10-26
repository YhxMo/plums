import { readFileSync } from "node:fs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { manage, nextStep, openAddAgent } from "./helpers";
import { writeBundle } from "../../modules/agents/agent-bundle";
import { withRoleCard } from "../../modules/agents/card-export";

/** A chat service as a package; its top level marks that its code ran. */
const service = {
  manifest: JSON.stringify({
    id: "author.guide",
    version: "1.0.0",
    apiVersion: 1,
    name: "导游模型",
    author: "某作者",
    license: "MIT",
    provides: { chat: 1 },
  }),
  main: `globalThis.__guideRan = true;
export default {
  activate(ctx) {
    ctx.provide("chat", 1, {
      name: "导游模型",
      models: () => [{ id: "g", label: "导游", description: "" }],
      subscribe: () => () => {},
      async reply({ input }) { return "导游：" + input; },
    });
  },
};`,
};
const ran = (page: Page) =>
  page.evaluate(() => (globalThis as { __guideRan?: boolean }).__guideRan);

/** Imports the service's package and uses it in place of the echo model. */
async function installService(page: Page) {
  await manage(page);
  await page.getByRole("button", { name: "安装扩展", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "安装扩展" });
  await dialog.getByLabel("选择扩展包").setInputFiles({
    name: "guide.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "manifest.json": strToU8(service.manifest),
        "main.js": strToU8(service.main),
      }),
    ),
  });
  await dialog.getByRole("button", { name: "导入", exact: true }).click();
  await page
    .getByRole("switch", { name: "启用 author.guide", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
}

test("an Agent and its extensions go out as one file and come back in clean data", async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await installService(page);
  // An Agent that replies with the imported model.
  const named = await openAddAgent(page);
  await named.getByRole("textbox", { name: "名称", exact: true }).fill("旅伴");
  const parts = await nextStep(page, "旅伴");
  await parts.getByRole("combobox", { name: "新 Agent 使用的模型" }).click();
  await page.getByRole("option", { name: /^导游/ }).click();
  await parts.getByRole("button", { name: "添加", exact: true }).click();
  // Memory switched off for this Agent goes out as off.
  await page.getByRole("button", { name: "展开或收起右侧栏" }).click();
  await page
    .getByRole("switch", { name: "在 旅伴 中使用 记忆", exact: true })
    .click();
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "导出 Agent 和扩展…", exact: true })
    .click();
  // Passing on someone's code: list it, its author and licence first.
  const share = page.getByRole("dialog", { name: "导出 Agent 和扩展" });
  const packed = share.getByRole("list", { name: "一并打包的扩展" });
  await expect(packed).toContainText("导游模型");
  await expect(packed).toContainText("某作者");
  await expect(packed).toContainText("MIT");
  const download = page.waitForEvent("download");
  await share.getByRole("button", { name: "导出", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("旅伴.plums");
  const bytes = readFileSync(await file.path());
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files).sort()).toEqual([
    "agent.json",
    "card.png",
    "extensions/author.guide/main.js",
    "extensions/author.guide/manifest.json",
  ]);
  const meta = JSON.parse(new TextDecoder().decode(files["agent.json"]));
  expect(meta.off).toContain("memory.local");
  // No memory, conversations, model choice or keys travel with it.
  expect(new TextDecoder().decode(files["agent.json"])).not.toMatch(
    /session|"g"|key/i,
  );

  // Clean data: another browser context.
  const other = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const fresh = await other.newPage();
  await fresh.goto("/");
  await fresh.getByRole("button", { name: "导入角色卡", exact: true }).click();
  await fresh.getByLabel("角色卡文件").setInputFiles({
    name: "旅伴.plums",
    mimeType: "application/zip",
    buffer: bytes,
  });
  await fresh.getByRole("button", { name: "下一步", exact: true }).click();
  // The package is shown and confirmed before any of its code runs.
  const offer = fresh.getByRole("dialog", { name: /安装 Agent 用到的扩展/ });
  await expect(offer).toContainText("运行其中的代码");
  await expect(offer.getByLabel("导入内容")).toContainText("导游模型");
  expect(await ran(fresh)).toBeUndefined();
  await offer.getByRole("button", { name: "安装", exact: true }).click();
  await expect(offer).toBeHidden();
  expect(await ran(fresh)).toBe(true);
  const describe = fresh.getByRole("dialog", { name: "添加 Agent" });
  await expect(
    describe.getByRole("textbox", { name: "名称", exact: true }),
  ).toHaveValue("旅伴");
  const compose = await nextStep(fresh, "旅伴");
  await expect(
    compose.getByRole("switch", { name: "在 旅伴 中使用 记忆", exact: true }),
  ).not.toBeChecked();
  await compose.getByRole("button", { name: "添加", exact: true }).click();
  await expect(
    fresh.getByRole("region", { name: "旅伴 的会话", exact: true }),
  ).toBeVisible();
  // Installed, still off until enabled.
  await manage(fresh);
  await expect(
    fresh.getByRole("switch", { name: "启用 author.guide", exact: true }),
  ).toBeVisible();
  await other.close();
});

test("a bundle part this app lacks stays off and says why; a declined package installs nothing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const card = withRoleCard(
    new Uint8Array(readFileSync("public/brand/plums.png")),
    { name: "缺件", description: "", instructions: "" },
  );
  const bytes = await writeBundle({
    card,
    extensions: [
      { id: "agents.local", version: "0.0.4" },
      { id: "missing.part", version: "1.0.0" },
      { id: "author.guide", version: "1.0.0", package: service },
    ],
    off: [],
  });
  await page.getByRole("button", { name: "导入角色卡", exact: true }).click();
  await page.getByLabel("角色卡文件").setInputFiles({
    name: "缺件.plums",
    mimeType: "application/zip",
    buffer: Buffer.from(bytes),
  });
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page
    .getByRole("dialog", { name: /安装 Agent 用到的扩展/ })
    .getByRole("button", { name: "跳过", exact: true })
    .click();
  expect(await ran(page)).toBeUndefined();
  const compose = await nextStep(page, "缺件");
  await expect(compose).toContainText(
    "missing.part 没有安装，这一项保持关闭。",
  );
  await expect(compose).toContainText(
    "没有安装 author.guide，这一项保持关闭。",
  );
});
