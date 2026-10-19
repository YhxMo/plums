import { expect, test } from "@playwright/test";
import { manage } from "./helpers";

const extensionId = "sample.credential-test";
const declaration = {
  label: "测试模型",
  target: "https://model.invalid/chat/completions",
  contentType: "application/json",
  headers: {},
  authentication: { type: "bearer" },
};

for (const width of [375, 1180]) {
  for (const theme of ["light", "dark"]) {
    test(`native binding management preserves cleanup after declaration removal and uninstall ${width} ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("**/test-credential.js", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: `export default { manifest: { id: "${extensionId}", version: "1", apiVersion: 1 }, activate() {} };`,
        }),
      );
      await page.addInitScript(
        ({ extensionId, declaration, theme }) => {
          const w = window as unknown as {
            isTauri: boolean;
            __TAURI_INTERNALS__: unknown;
            __credentialTest: { commands: string[]; payloads: unknown[] };
          };
          w.isTauri = true;
          w.__credentialTest = { commands: [], payloads: [] };
          let records = [
            {
              owner: `extension.${extensionId}`,
              alias: "old-text",
              source: "/test-credential.js",
              version: "1",
              declaration,
              route: { type: "direct" },
              revision: 1,
              status: "disabled",
            },
          ];
          let saved = {
            revision: 1,
            value: {
              version: 1,
              theme,
              layout: "agents",
              imports: [
                {
                  id: extensionId,
                  label: "凭据测试扩展",
                  url: "/test-credential.js",
                },
              ],
            },
          };
          w.__TAURI_INTERNALS__ = {
            invoke: async (
              command: string,
              args: {
                owner?: string;
                capability?: string;
                payload?: { revision: number; value: typeof saved.value };
              },
            ) => {
              w.__credentialTest.commands.push(command);
              if (command.startsWith("credential_"))
                w.__credentialTest.payloads.push(args);
              if (command === "credential_supported") return true;
              if (command === "credential_inventory") return records;
              if (command === "credential_list")
                return records.filter((record) => record.owner === args.owner);
              if (command === "credential_retain") {
                records = records.map((record) => ({
                  ...record,
                  status: "disabled",
                }));
                return { status: "saved" };
              }
              if (command === "credential_delete") {
                records = [];
                return { status: "saved" };
              }
              if (command === "document_supported") return false;
              if (command === "platform_call") {
                if (args.capability === "state.read") return saved;
                if (args.capability === "state.write")
                  return (saved = {
                    revision: args.payload!.revision + 1,
                    value: args.payload!.value,
                  });
              }
            },
          };
        },
        { extensionId, declaration, theme },
      );
      await page.goto("/");
      await manage(page);
      await page.getByText("凭据测试扩展", { exact: true }).click();
      const binding = page.getByRole("region", {
        name: "连接与凭据",
        exact: true,
      });
      await expect(binding).toContainText("此扩展当前不使用该连接");
      await expect(
        binding.getByRole("button", { name: "撤销并删除凭据", exact: true }),
      ).toBeEnabled();
      await expect(
        binding.getByRole("button", { name: "录入 API Key", exact: true }),
      ).toHaveCount(0);
      const cleanup = binding.getByRole("button", {
        name: "撤销并删除凭据",
        exact: true,
      });
      expect((await cleanup.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page
        .getByRole("button", { name: `卸载 ${extensionId}`, exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "卸载扩展" })
        .getByRole("button", { name: "保留数据并卸载", exact: true })
        .click();
      const retained = page.getByRole("region", {
        name: "卸载后保留的凭据",
        exact: true,
      });
      await expect(retained).toContainText(extensionId);
      await retained
        .getByRole("button", { name: "撤销并删除凭据", exact: true })
        .click();
      await expect(retained).toHaveCount(0);
      const commands = await page.evaluate(
        () =>
          (window as unknown as { __credentialTest: { commands: string[] } })
            .__credentialTest.commands,
      );
      expect(commands).toContain("credential_retain");
      expect(commands).toContain("credential_delete");
      expect(commands).not.toContain("credential_configure");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test("connector key entry uses native metadata and recovers an unknown save", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      __credentialPayloads: unknown[];
    };
    w.isTauri = true;
    w.__credentialPayloads = [];
    let records: unknown[] = [];
    let entries = 0;
    // The connector ships in the built-in catalog; nothing is imported.
    const source = "/connectors/deepseek.js";
    let saved = { revision: 1, value: { version: 1, imports: [] } };
    w.__TAURI_INTERNALS__ = {
      invoke: async (
        command: string,
        args: {
          owner?: string;
          alias?: string;
          declaration?: typeof declaration;
          capability?: string;
          payload?: { revision: number; value: typeof saved.value };
        },
      ) => {
        if (command === "credential_supported") return true;
        if (command === "credential_inventory" || command === "credential_list")
          return records;
        if (command === "credential_configure") {
          w.__credentialPayloads.push(args);
          if (++entries > 1) return { status: "cancelled" };
          records = [
            {
              owner: args.owner,
              alias: args.alias,
              declaration: args.declaration,
              source,
              version: "0.1.0",
              revision: 1,
              status: "pending",
              route: { type: "direct" },
            },
          ];
          return { status: "unknown" };
        }
        if (command === "credential_reconcile") {
          records = (records as Array<Record<string, unknown>>).map(
            (record) => ({ ...record, status: "ready", revision: 2 }),
          );
          return { status: "saved" };
        }
        if (command === "document_supported") return false;
        if (command === "platform_call") {
          if (args.capability === "state.read") return saved;
          if (args.capability === "state.write")
            return (saved = {
              revision: args.payload!.revision + 1,
              value: args.payload!.value,
            });
        }
      },
    };
  });
  await page.goto("/");
  await manage(page);
  await page
    .getByRole("button", { name: "DeepSeek 模型连接", exact: true })
    .click();
  const binding = page.getByRole("region", { name: "连接与凭据", exact: true });
  await binding
    .getByRole("button", { name: "录入 API Key", exact: true })
    .click();
  await expect(binding).toContainText("保存结果待核对");
  await expect(
    binding.getByRole("button", { name: "录入 API Key", exact: true }),
  ).toBeDisabled();
  await binding
    .getByRole("button", { name: "核对保存状态", exact: true })
    .click();
  await expect(binding).toContainText("凭据已保存，连接尚未验证");
  const reenter = binding.getByRole("button", {
    name: "重新录入凭据",
    exact: true,
  });
  await reenter.click();
  await expect(binding).toContainText("已取消，保留原连接记录");
  await expect(reenter).toBeFocused();
  const payloads = await page.evaluate(
    () =>
      (window as unknown as { __credentialPayloads: object[] })
        .__credentialPayloads,
  );
  expect(Object.keys(payloads[0]).sort()).toEqual([
    "alias",
    "declaration",
    "owner",
    "revision",
    "source",
    "version",
  ]);
  await expect(binding.locator("input")).toHaveCount(0);
});
