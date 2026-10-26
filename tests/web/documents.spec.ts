import { expect, test } from "@playwright/test";
import { manage, selectExtension } from "./helpers";
for (const width of [375, 768, 1440]) {
  test(`document management recovers unknown empty selection at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: unknown;
        __documentTest: { revokes: number };
      };
      w.isTauri = true;
      w.__documentTest = { revokes: 0 };
      let saved: unknown = null;
      w.__TAURI_INTERNALS__ = {
        invoke: async (
          command: string,
          args: {
            capability?: string;
            payload?: { revision: number; value: unknown };
          },
        ) => {
          if (command === "document_supported") return true;
          if (command === "document_list") return [];
          if (command === "document_select")
            throw Error("synthetic lost receipt");
          if (command === "document_revoke") {
            w.__documentTest.revokes++;
            return;
          }
          if (command === "platform_call") {
            if (args.capability === "state.read") return saved;
            if (args.capability === "state.write")
              return (saved = {
                revision: (args.payload?.revision ?? 0) + 1,
                value: args.payload?.value,
              });
            return { os: "mock", arch: "mock" };
          }
        },
      };
    });
    await page.goto("/");
    await manage(page);
    await page
      .getByRole("switch", { name: "启用 sample.documents", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "授权并启动", exact: true })
      .click();
    await selectExtension(page, "sample.documents");
    const panel = page.getByRole("region", { name: "文档只读授权" });
    await panel
      .getByRole("button", { name: "选择单个文档", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("选择结果待确认");
    const revoke = panel.getByRole("button", {
      name: "撤销全部文档",
      exact: true,
    });
    await expect(revoke).toBeEnabled();
    await revoke.click();
    await expect(panel.getByRole("status")).toContainText("已撤销后续读取");
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __documentTest: { revokes: number } })
            .__documentTest.revokes,
      ),
    ).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
