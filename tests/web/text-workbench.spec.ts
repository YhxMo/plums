import { expect, test, type Page } from "@playwright/test";
import { manage, persisted } from "./helpers";
async function enable(page: Page) {
  await manage(page);
  await page
    .getByRole("button", { name: "启用 ui.workbench-board", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "授权并启动", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "停用 ui.workbench-board", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
}
for (const width of [375, 1440]) {
  test(`text workbench real run, details, draft, cancel and layout replacement at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await enable(page);
    expect(
      await page.getByRole("textbox", { name: "消息", exact: true }).count(),
    ).toBe(0);
    await page
      .getByRole("button", { name: "＋ 新建处理项", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "处理项名称" })
      .fill("整理发布说明");
    await page
      .getByRole("textbox", { name: "输入文本" })
      .fill("hello public contract");
    await page.getByRole("button", { name: "执行转换", exact: true }).click();
    await expect(
      page.getByRole("status", { exact: false }).filter({ hasText: "已保存" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "查看结果", exact: true }).click();
    const result = page.locator(".tw-result").first();
    await expect(result).toContainText("HELLO PUBLIC CONTRACT");
    // WebKit pointer activation and DOM events need not first focus the opener.
    await result.evaluate((node) => (node as HTMLButtonElement).click());
    await expect(
      page.getByRole("heading", { name: "结果详情", exact: true }),
    ).toBeVisible();
    if (width === 375)
      await expect(
        page.getByRole("dialog", { name: "结果详情" }),
      ).toBeVisible();
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await expect(page.locator(".tw-result").first()).toBeFocused();
    await page.getByRole("button", { name: "返回编辑", exact: true }).click();
    await page
      .getByRole("textbox", { name: "输入文本" })
      .fill("draft after result");
    await page.getByRole("button", { name: "执行转换", exact: true }).click();
    await page.getByRole("button", { name: "取消执行", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已取消" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
      "draft after result",
    );
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已保存" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "应用菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "应用设置", exact: true }).click();
    await page
      .getByRole("radio", { name: "使用 Agent 界面", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "欢迎使用 Plums" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "应用菜单", exact: true }).click();
    await page.getByRole("menuitem", { name: "应用设置", exact: true }).click();
    await page
      .getByRole("radio", { name: "使用 文本处理工作台", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
      "draft after result",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("workbench save failure, cold detail restoration and lifecycle fallback", async ({
  page,
}) => {
  await page.goto("/");
  await enable(page);
  await page
    .getByRole("button", { name: "＋ 新建处理项", exact: true })
    .click();
  await page.getByRole("textbox", { name: "输入文本" }).fill("cold recovery");
  await page.getByRole("button", { name: "执行转换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  await page.locator(".tw-result").first().click();
  await expect(
    page.getByRole("heading", { name: "结果详情", exact: true }),
  ).toBeVisible();
  await persisted(page, "ui.workbench-board");
  await page.reload();
  // The enabled board and its permissions come back without asking again.
  await expect(
    page.getByRole("heading", { name: "结果详情", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(page.locator(".tw-result").first()).toBeVisible();
  await page.getByRole("button", { name: "返回编辑", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
    "cold recovery",
  );
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "执行转换", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "写入故障" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
    "cold recovery",
  );
  await manage(page);
  await page
    .getByRole("button", { name: "停用 ui.workbench-board", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用 Plums" }),
  ).toBeVisible();
});

test("navigation preference failure cannot redirect a detail edit to another item", async ({
  page,
}) => {
  await page.goto("/");
  await enable(page);
  for (const name of ["A", "B"]) {
    await page
      .getByRole("button", { name: "＋ 新建处理项", exact: true })
      .click();
    await page.getByRole("textbox", { name: "处理项名称" }).fill(name);
    await page
      .getByRole("textbox", { name: "输入文本" })
      .fill(name.toLowerCase().repeat(3));
    await page.getByRole("button", { name: "执行转换", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已保存" }),
    ).toBeVisible();
  }
  await page.locator(".tw-item").filter({ hasText: /^A/ }).click();
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  await page.locator(".tw-result").first().click();
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.locator(".tw-item").filter({ hasText: /^B/ }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "写入故障" }),
  ).toBeVisible();
  await expect(
    page.locator(".tw-item").filter({ hasText: /^A/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await manage(page, true);
  await page.getByLabel("注入存储写入失败").uncheck();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await page.getByRole("button", { name: "再编辑", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "处理项名称" })).toHaveValue(
    "A",
  );
  await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
    "aaa",
  );
  await page.locator(".tw-item").filter({ hasText: /^B/ }).click();
  await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
    "bbb",
  );
});

test("permission refusal preserves the current UI; replacing the transform provider restores saved work", async ({
  page,
}) => {
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "启用 ui.workbench-board", exact: true })
    .click();
  await page.getByRole("button", { name: "暂不授权", exact: true }).click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "欢迎使用 Plums" }),
  ).toBeVisible();
  await enable(page);
  await page
    .getByRole("button", { name: "＋ 新建处理项", exact: true })
    .click();
  await page.getByRole("textbox", { name: "输入文本" }).fill("abc");
  await page.getByRole("button", { name: "执行转换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "更换服务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "扩展与状态" })).toBeVisible();
  await page
    .getByRole("button", { name: "停用 transform.upper", exact: true })
    .click();
  await expect(
    page.locator("article").filter({ hasText: "ui.workbench-board" }),
  ).toContainText("等待条件");
  await page
    .getByRole("button", { name: "启用 transform.reverse", exact: true })
    .click();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "输入文本" })).toHaveValue(
    "abc",
  );
  await expect(page.locator(".tw-service")).toContainText("Reverse");
  await page.getByRole("button", { name: "执行转换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  await expect(page.locator(".tw-result").first()).toContainText("cba");
  await expect(page.locator(".tw-result").nth(1)).toContainText("ABC");
});

test("mobile result detail keeps host management above extension layers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await enable(page);
  await page
    .getByRole("button", { name: "＋ 新建处理项", exact: true })
    .click();
  await page.getByRole("textbox", { name: "输入文本" }).fill("host recovery");
  await page.getByRole("button", { name: "执行转换", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  await page.locator(".tw-result").first().click();
  await expect(page.getByRole("dialog", { name: "结果详情" })).toBeVisible();
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "扩展管理", exact: true })
    .click({ timeout: 2000 });
  await expect(page.getByRole("heading", { name: "扩展与状态" })).toBeVisible();
  await page.getByRole("button", { name: "返回工作区", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "结果详情" })).toBeVisible();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await expect(page.locator(".tw-result").first()).toBeFocused();
});
