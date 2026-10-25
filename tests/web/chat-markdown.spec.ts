import { expect, test, type Page } from "@playwright/test";
import { addAgent } from "./helpers";

/** The echo model repeats the message after its own prefix. */
const message = [
  "**粗体**",
  "",
  "## 小标题",
  "",
  "```js",
  "const answer = 42;",
  "```",
  "",
  "| 列 | 值 |",
  "| --- | --- |",
  "| a | 1 |",
  "",
  "[文档](https://docs.example.com/guide) [明文](http://plain.example.com/) ![示意图](https://images.example.com/a.png)",
  "",
  "<b>原始</b>",
].join("\n");

async function chat(page: Page, text: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await addAgent(page, "助手");
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const log = page.getByRole("log");
  await expect(log.locator("p", { hasText: /^echo-a｜/ })).toHaveCount(1);
  return log;
}

test("replies render Markdown; the own message stays as typed", async ({
  page,
  context,
  browserName,
}) => {
  // Playwright's WebKit has no clipboard permissions; it checks the feedback.
  const readable = browserName === "chromium";
  if (readable)
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const log = await chat(page, message);
  await expect(log.locator("strong", { hasText: "粗体" })).toHaveCount(1);
  await expect(log.getByRole("heading", { name: "小标题" })).toBeVisible();
  await expect(log.getByRole("table")).toContainText("a");
  await expect(log.locator("pre code")).toHaveText("const answer = 42;");
  // Raw HTML and remote pictures never become elements.
  await expect(log.locator("b")).toHaveCount(0);
  await expect(log.locator("img")).toHaveCount(0);
  await expect(log).toContainText("示意图");
  // Only https links are links; others stay text.
  await expect(log.getByRole("link")).toHaveCount(1);
  await expect(log).toContainText("明文");
  // The own message is what was typed, asterisks and all.
  await expect(log.locator("p", { hasText: /^\*\*粗体\*\*/ })).toHaveCount(1);

  await log.locator("pre").hover();
  await log.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(
    log.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  if (readable)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "const answer = 42;",
    );
});

test("an https link opens outside the app, not in its window", async ({
  page,
  context,
}) => {
  await context.route("https://docs.example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>文档</title>" }),
  );
  const log = await chat(page, message);
  const link = log.getByRole("link", { name: "文档", exact: true });
  const opened = context.waitForEvent("page");
  await link.focus();
  await page.keyboard.press("Enter");
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe("https://docs.example.com/guide");
  // The app stays where it was, and the new tab cannot reach it.
  expect(new URL(page.url()).host).toBe("127.0.0.1:1420");
  expect(await tab.evaluate(() => window.opener)).toBeNull();
});

test("a new message keeps the elements of earlier replies", async ({
  page,
}) => {
  const log = await chat(page, message);
  await log.locator("pre").evaluate((pre) => (pre.dataset.kept = "yes"));
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("再一条");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(log.locator("p", { hasText: /^echo-a｜/ })).toHaveCount(2);
  await expect(log.locator("pre").first()).toHaveAttribute("data-kept", "yes");
});
