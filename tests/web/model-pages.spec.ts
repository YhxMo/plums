import { expect, test, type Page } from "@playwright/test";
import {
  addAgent,
  connectorWithPage,
  installConnector,
  manage,
  nextStep,
  openAddAgent,
} from "./helpers";

/** Opens the model step of adding an Agent and presses its connect button. */
async function connect(page: Page) {
  await openAddAgent(page);
  await page
    .getByRole("dialog", { name: "添加 Agent", exact: true })
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("甲");
  const step = await nextStep(page, "甲");
  await step.getByRole("button", { name: /模型连接$/ }).click();
  return step;
}

test("the way to connect models follows the connectors that offer a page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await connectorWithPage(page, "chat.first", "甲家连接");
  await connectorWithPage(page, "chat.second", "乙家连接");
  await page.goto("/");

  // The browser cannot run the built-in connector, so no running connector
  // offers a page: adding an Agent offers none, and the composer leads to
  // the extensions instead, keeping its draft.
  await openAddAgent(page);
  await page
    .getByRole("dialog", { name: "添加 Agent", exact: true })
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("甲");
  let step = await nextStep(page, "甲");
  await expect(step.getByRole("button", { name: /模型连接$/ })).toHaveCount(0);
  await step.getByRole("button", { name: "关闭", exact: true }).click();
  await manage(page);
  await page
    .getByRole("button", { name: "停用 chat.echo", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await addAgent(page, "乙");
  const box = page.getByRole("textbox", { name: "消息", exact: true });
  await box.fill("草稿");
  await page.getByRole("button", { name: "切换模型", exact: true }).click();
  await page.getByRole("menuitem", { name: "连接模型", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "扩展", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(box).toHaveValue("草稿");

  // One connector with a page: the button opens it.
  await installConnector(page, "chat.first");
  step = await connect(page);
  const first = page.getByRole("dialog", { name: "甲家连接" });
  await expect(first).toContainText("在这里填写甲家连接的密钥");
  await first.getByRole("button", { name: "关闭", exact: true }).click();
  await step.getByRole("button", { name: "关闭", exact: true }).click();

  // Two: the user picks which one.
  await installConnector(page, "chat.second");
  await connect(page);
  await page.getByRole("menuitem", { name: "乙家连接", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "乙家连接" })).toContainText(
    "在这里填写乙家连接的密钥",
  );
});
