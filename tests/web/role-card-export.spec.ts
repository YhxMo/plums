import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { addAgent, nextStep } from "./helpers";
import { fromBase64, pngTextChunks } from "../../modules/agents/card-png";

test("an Agent exports as a picture card that imports back the same", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await addAgent(page, "写作助手", { description: "帮你改稿。" });
  // The same menu on the list row and in the conversation header.
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "导出角色卡…", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("写作助手.png");
  const bytes = new Uint8Array(readFileSync(await file.path()));
  // A PNG whose `chara` chunk is a Character Card V2.
  const card = JSON.parse(fromBase64(pngTextChunks(bytes).get("chara")!));
  expect(card).toMatchObject({
    spec: "chara_card_v2",
    data: {
      name: "写作助手",
      description: "简洁、友好地回答用户的问题。",
      creator_notes: "帮你改稿。",
    },
  });
  await expect(page.getByText("已导出角色卡")).toBeVisible();
  // Import it as another Agent: the same name, 设定, 介绍 and a picture.
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "导入角色卡…", exact: true })
    .click();
  await page.getByLabel("角色卡文件").setInputFiles({
    name: "写作助手.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const describe = page.getByRole("dialog", { name: "添加 Agent" });
  await expect(
    describe.getByRole("textbox", { name: "名称", exact: true }),
  ).toHaveValue("写作助手");
  await expect(
    describe.getByRole("textbox", { name: "设定", exact: true }),
  ).toHaveValue("简洁、友好地回答用户的问题。");
  await expect(
    describe.getByRole("textbox", { name: "介绍", exact: true }),
  ).toHaveValue("帮你改稿。");
  await expect(describe.locator('[data-slot="avatar-image"]')).toBeVisible();
  await (
    await nextStep(page, "写作助手")
  )
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await expect(
    page
      .getByRole("complementary", { name: "Agent 列表" })
      .getByRole("button", { name: "写作助手", exact: true }),
  ).toHaveCount(2);
});
