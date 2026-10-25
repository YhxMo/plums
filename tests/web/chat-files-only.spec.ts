import { expect, test } from "@playwright/test";
import { addAgent } from "./helpers";

test("files go out without text, and show as files, not an empty bubble", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await addAgent(page, "附件助手");
  const send = page.getByRole("button", { name: "发送", exact: true });
  await expect(send).toBeDisabled();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(["内容"], "笔记.md", { type: "text/markdown" }));
    for (const type of ["dragenter", "dragover", "drop"])
      document.querySelector("textarea")!.dispatchEvent(
        new DragEvent(type, {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await expect(
    page.getByRole("button", { name: "移除 笔记.md", exact: true }),
  ).toBeVisible();
  await send.click();
  const log = page.getByRole("log");
  await expect(log.locator("p", { hasText: /^echo-a｜/ })).toHaveCount(1);
  await expect(log.getByRole("list", { name: "附件" })).toContainText(
    "笔记.md",
  );
  await expect(log.locator("p:empty")).toHaveCount(0);
  // The session takes its name from the file.
  await expect(
    page.getByRole("region", { name: "附件助手 的会话" }).locator("header"),
  ).toContainText("笔记.md");
  // Its menu offers no copy, as there is no text to copy.
  await log.getByRole("list", { name: "附件" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "复制" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  // Editing names the files, and the kept files can go out without text.
  await expect(page.getByText("[文件] 笔记.md")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "消息", exact: true }),
  ).toHaveValue("");
  await expect(send).toBeEnabled();
});
