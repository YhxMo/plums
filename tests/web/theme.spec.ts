import { manage, legacyEntry, chooseLayout } from "./helpers";
import { expect, test } from "@playwright/test";

for (const scheme of ["light", "dark"] as const) {
  test(`first launch follows the ${scheme} system appearance`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(
      page.getByRole("button", {
        name: scheme === "light" ? "切换到深色模式" : "切换到浅色模式",
      }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
  });
}

for (const width of [375, 1440]) {
  test(`theme changes preserve drafts and survive layout selection and reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByRole("button", { name: "切换到深色模式" }).click();
    await (await legacyEntry(page)).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await page.getByRole("textbox").fill("theme draft");
    await page.getByRole("button", { name: "切换到浅色模式" }).click();
    await expect(page.getByRole("textbox")).toHaveValue("theme draft");
    await page.getByRole("button", { name: "运行并保存" }).click();
    await expect(page.locator("[data-phase]")).toHaveText("已保存");
    await chooseLayout(page, "board");
    await page.getByRole("button", { name: "切换到深色模式" }).click();
    await expect(page.locator("[data-output]")).toHaveText("THEME DRAFT");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "切换到浅色模式" }),
    ).toBeVisible();
    await (await legacyEntry(page)).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: "工作画布" })).toBeVisible();
    await expect(page.locator("[data-output]")).toHaveText("THEME DRAFT");
  });
}

test("a rejected preference write keeps the current theme and reports the failure", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await manage(page);
  await page.getByText("诊断与实验", { exact: true }).click();
  await page.getByLabel("注入存储写入失败").check();
  await page.getByRole("button", { name: "切换到深色模式" }).click();
  await expect(page.getByRole("alert")).toContainText("注入的写入故障");
  await expect(
    page.getByRole("button", { name: "切换到深色模式" }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
