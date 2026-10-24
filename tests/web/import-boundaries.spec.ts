import { expect, test } from "@playwright/test";

for (const keyboard of [false, true]) {
  test(`role-card configuration only advances a step, never saves (${keyboard ? "keyboard" : "pointer"})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /导入角色卡/ }).click();
    const raw = JSON.stringify({
      version: 1,
      name: "确认后才添加",
      description: "可修改的介绍",
    });
    await page.getByLabel("角色卡内容").fill(raw);
    const next = page.getByRole("button", { name: "选择模型和扩展" });
    if (keyboard) await next.press("Enter");
    else await next.click();
    const create = page.getByRole("dialog", {
      name: "添加 Agent",
      exact: true,
    });
    await expect(create).toBeVisible();
    await expect(
      create.getByRole("textbox", { name: "名称", exact: true }),
    ).toHaveValue("确认后才添加");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("plums:extension.agents.local"),
      ),
    ).toBeNull();
    await create.getByRole("button", { name: "取消", exact: true }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "与 确认后才添加 交互" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /导入角色卡/ }).click();
    await page.getByLabel("角色卡内容").fill(raw);
    await page.getByRole("button", { name: "选择模型和扩展" }).click();
    await create
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("最终确认的角色");
    await create.getByRole("button", { name: "添加", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "最终确认的角色 的会话", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "与 最终确认的角色 交互" }),
    ).toHaveCount(1);
  });
}

async function openImport(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /导入角色卡/ }).click();
  await page.getByLabel("角色卡内容").fill('{"name":"保留原稿"}');
  await page.getByLabel("角色卡链接").fill("/cards/controlled.json");
}

test("pending role link can close and late response cannot replace draft", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished!: () => void;
  const handled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/cards/controlled.json", async (route) => {
    await gate;
    await route.fulfill({ json: { name: "迟到角色" } }).catch(() => {});
    finished();
  });
  await openImport(page);
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await page.keyboard.press("Escape");
  try {
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: /导入角色卡/ }).click();
  } finally {
    release();
  }
  await handled;
  await expect(page.getByLabel("角色卡内容")).toHaveValue(
    '{"name":"保留原稿"}',
  );
});

test("role link rejects UTF-8 byte overflow and keeps original input", async ({
  page,
}) => {
  await page.route("**/cards/controlled.json", (route) =>
    route.fulfill({
      json: { name: "大卡片", extra: "汉".repeat(12000) },
    }),
  );
  await openImport(page);
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("32 KB");
  await expect(page.getByLabel("角色卡内容")).toHaveValue(
    '{"name":"保留原稿"}',
  );
});

test("role link timeout leaves dialog usable and preserves input", async ({
  page,
}) => {
  await page.route("**/cards/controlled.json", () => new Promise(() => {}));
  await openImport(page);
  await page.clock.install();
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await page.clock.runFor(11000);
  await expect(page.getByRole("alert")).toContainText("超时");
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("角色卡内容")).toHaveValue(
    '{"name":"保留原稿"}',
  );
});

test("normal same-origin card imports and redirected card stays rejected", async ({
  page,
}) => {
  await page.route("**/cards/controlled.json", (route) =>
    route.fulfill({ status: 302, headers: { location: "/cards/target.json" } }),
  );
  let followed = false;
  await page.route("**/cards/target.json", (route) => {
    followed = true;
    return route.fulfill({ json: { name: "redirected" } });
  });
  await openImport(page);
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(followed).toBe(false);
  await expect(page.getByLabel("角色卡内容")).toHaveValue(
    '{"name":"保留原稿"}',
  );
  await page.unroute("**/cards/controlled.json");
  await page.route("**/cards/controlled.json", (route) =>
    route.fulfill({ json: { name: "链接角色", description: "正常同源卡" } }),
  );
  await page.getByRole("button", { name: "读取", exact: true }).click();
  await expect(page.getByLabel("角色卡内容")).toHaveValue(/链接角色/);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "链接角色 的会话", exact: true }),
  ).toBeVisible();
});
