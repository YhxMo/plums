import { expect, test } from "@playwright/test";

test("a sent message appears at once and the input clears before the reply", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "从头添加 Agent", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("即时助手");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.fill("show me now");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log.getByText("show me now", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(log.getByRole("status")).toBeVisible();
  await expect(log.getByText("SHOW ME NOW", { exact: true })).toBeVisible();
  await expect(log.getByRole("status")).toHaveCount(0);
  await expect(log.getByText("show me now", { exact: true })).toHaveCount(1);
});
