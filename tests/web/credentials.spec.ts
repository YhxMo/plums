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
  // A connector with a fixed manifest binding, imported like an author's file.
  await page.route("**/test-connector.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `export default { manifest: { id: "sample.connector", version: "0.1.0", apiVersion: 1, capabilities: ["credential.request"], credentialBindings: { text: ${JSON.stringify(declaration)} } }, activate() {} };`,
    }),
  );
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
    const source = "/test-connector.js";
    let saved = {
      revision: 1,
      value: {
        version: 1,
        imports: [{ id: "sample.connector", label: "测试连接器", url: source }],
      },
    };
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
  await page.getByText("测试连接器", { exact: true }).click();
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

test("the model connection page adds a provider from a template and the user's own models", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as {
      isTauri: boolean;
      __TAURI_INTERNALS__: unknown;
      __configured: Array<Record<string, unknown>>;
    };
    w.isTauri = true;
    w.__configured = [];
    let records: Array<Record<string, unknown>> = [];
    const states = new Map<string, { revision: number; value: unknown }>();
    w.__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: Record<string, unknown>) => {
        if (command === "credential_supported") return true;
        if (command === "credential_inventory") return records;
        if (command === "credential_list")
          return records.filter((record) => record.owner === args.owner);
        if (command === "credential_configure") {
          w.__configured.push(args);
          records = [
            ...records,
            {
              owner: args.owner,
              alias: args.alias,
              declaration: args.declaration,
              source: args.source,
              version: args.version,
              revision: 1,
              status: "ready",
              route: { type: "direct" },
            },
          ];
          return { status: "saved" };
        }
        if (command === "document_supported") return false;
        if (command === "platform_call") {
          const payload = (args.payload ?? {}) as {
            key?: string;
            revision: number;
            value: unknown;
          };
          const slot = `${String(args.owner)}+${payload.key ?? ""}`;
          if (args.capability === "state.read") return states.get(slot) ?? null;
          if (args.capability === "state.write") {
            const next = {
              revision: payload.revision + 1,
              value: payload.value,
            };
            states.set(slot, next);
            return next;
          }
        }
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "应用菜单", exact: true }).click();
  await page.getByRole("menuitem", { name: "模型连接", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "模型连接" });
  await dialog.getByRole("button", { name: "添加服务商", exact: true }).click();
  const presets = dialog.getByRole("combobox", { name: "服务商", exact: true });
  // Keyboard: open, Escape closes only the list, then choose with arrows.
  await presets.focus();
  await page.keyboard.press("ArrowDown");
  const list = dialog.getByRole("listbox", { name: "服务商" });
  await expect(list.getByRole("option", { selected: true })).toHaveText(
    "DeepSeek",
  );
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(presets).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(presets).toHaveText("自定义（Anthropic 兼容）");
  await expect(presets).toBeFocused();
  await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("网关");
  await dialog
    .getByRole("textbox", { name: "服务地址", exact: true })
    .fill("https://gateway.invalid/v1/messages");
  const modelName = dialog.getByRole("textbox", {
    name: "模型名",
    exact: true,
  });
  await modelName.fill("model-one");
  await modelName.press("Enter");
  await modelName.fill("model-two");
  await dialog.getByRole("button", { name: "添加模型", exact: true }).click();
  await dialog
    .getByRole("button", { name: "移除 model-one", exact: true })
    .click();
  await modelName.fill("model-three");
  await modelName.press("Enter");
  await dialog
    .getByRole("button", { name: "保存并录入密钥", exact: true })
    .click();
  const provider = dialog
    .getByRole("list", { name: "服务商" })
    .getByRole("listitem", { name: "网关" });
  await expect(provider).toContainText("自定义（Anthropic 兼容） · 可用");
  await expect(
    provider.getByRole("list", { name: "网关 的模型" }).getByRole("listitem"),
  ).toHaveText(["model-two测试", "model-three测试"]);
  await expect(
    provider.getByRole("button", { name: "测试 model-two", exact: true }),
  ).toBeEnabled();
  const [configured] = await page.evaluate(
    () =>
      (window as unknown as { __configured: Array<Record<string, unknown>> })
        .__configured,
  );
  expect(configured).toMatchObject({
    owner: "extension.connector.models",
    source: "内置模型连接器",
    revision: 0,
    declaration: {
      label: "网关",
      target: "https://gateway.invalid/v1/messages",
      headers: { "anthropic-version": "2023-06-01" },
      authentication: { type: "header", name: "x-api-key" },
    },
  });
  expect(configured.alias).toMatch(/^c-[a-z0-9]{8}$/);
});
