import { expect, test } from "@playwright/test";
import { addAgent, manage, openConnections, serveModule } from "./helpers";

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
      await serveModule(
        page,
        "test-credential",
        `export default { manifest: { id: "${extensionId}", version: "1", apiVersion: 1 }, activate() {} };`,
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
              source: "/test-credential/",
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
                  url: "/test-credential/",
                },
              ],
            },
          };
          w.__TAURI_INTERNALS__ = {
            transformCallback: () => 1,
            unregisterCallback: () => {},
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
        binding.getByRole("button", { name: "保存 API Key", exact: true }),
      ).toHaveCount(0);
      const cleanup = binding.getByRole("button", {
        name: "撤销并删除凭据",
        exact: true,
      });
      // Phones get full-size touch targets; desktop keeps the compact row.
      if (width === 375)
        expect((await cleanup.boundingBox())!.height).toBeGreaterThanOrEqual(
          44,
        );
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

test("connector key entry saves the typed key natively and recovers an unknown save", async ({
  page,
}) => {
  // A connector with a fixed manifest binding, imported like an author's file.
  await serveModule(
    page,
    "test-connector",
    `export default { manifest: { id: "sample.connector", version: "0.1.0", apiVersion: 1, capabilities: ["credential.request"], credentialBindings: { text: ${JSON.stringify(declaration)} } }, activate() {} };`,
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
    const source = "/test-connector/";
    let saved = {
      revision: 1,
      value: {
        version: 1,
        imports: [{ id: "sample.connector", label: "测试连接器", url: source }],
      },
    };
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      unregisterCallback: () => {},
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
  const key = binding.getByLabel(`${declaration.label} 的 API Key`);
  const submit = binding.getByRole("button", {
    name: "保存 API Key",
    exact: true,
  });
  await expect(key).toHaveAttribute("type", "password");
  await expect(submit).toBeDisabled();
  await key.fill("sk-test-key");
  await binding
    .getByRole("button", { name: "显示 API Key", exact: true })
    .click();
  await expect(key).toHaveAttribute("type", "text");
  await expect(submit).toBeEnabled();
  await expect(binding).not.toContainText("保存结果待核对");
  await submit.click();
  await expect(binding).toContainText("保存结果待核对");
  await expect(key).toHaveValue("");
  await expect(key).toHaveAttribute("type", "password");
  await expect(
    binding.getByRole("button", { name: "显示 API Key", exact: true }),
  ).toBeDisabled();
  await expect(key).toBeDisabled();
  await binding
    .getByRole("button", { name: "核对保存状态", exact: true })
    .click();
  await expect(binding).toContainText("凭据已保存，连接尚未验证");
  await key.fill("sk-other-key");
  await binding
    .getByRole("button", { name: "更换 API Key", exact: true })
    .click();
  await expect(binding).toContainText("已取消，保留原连接记录");
  await expect(key).toBeFocused();
  const payloads = await page.evaluate(
    () =>
      (window as unknown as { __credentialPayloads: object[] })
        .__credentialPayloads,
  );
  expect(Object.keys(payloads[0]).sort()).toEqual([
    "alias",
    "declaration",
    "key",
    "owner",
    "revision",
    "source",
    "version",
  ]);
  expect(payloads).toMatchObject([
    { key: "sk-test-key" },
    { key: "sk-other-key" },
  ]);
});

test("rebinding shows and saves the address the extension now declares", async ({
  page,
}) => {
  const old = "https://old.invalid/chat/completions";
  await serveModule(
    page,
    "test-connector",
    `export default { manifest: { id: "sample.connector", version: "0.2.0", apiVersion: 1, capabilities: ["credential.request"], credentialBindings: { text: ${JSON.stringify(declaration)} } }, activate() {} };`,
  );
  await page.addInitScript(
    ({ declaration, old }) => {
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: unknown;
        __credentialPayloads: unknown[];
      };
      w.isTauri = true;
      w.__credentialPayloads = [];
      const source = "/test-connector/";
      // Saved by an earlier version that declared another address.
      const records = [
        {
          owner: "extension.sample.connector",
          alias: "text",
          declaration: { ...declaration, target: old },
          source,
          version: "0.1.0",
          revision: 1,
          status: "ready",
          route: { type: "direct" },
        },
      ];
      const saved = {
        revision: 1,
        value: {
          version: 1,
          imports: [
            { id: "sample.connector", label: "测试连接器", url: source },
          ],
        },
      };
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string, args: { capability?: string }) => {
          if (command === "credential_supported") return true;
          if (
            command === "credential_inventory" ||
            command === "credential_list"
          )
            return records;
          if (command === "credential_configure") {
            w.__credentialPayloads.push(args);
            return { status: "cancelled" };
          }
          if (command === "document_supported") return false;
          if (command === "platform_call" && args.capability === "state.read")
            return saved;
        },
      };
    },
    { declaration, old },
  );
  await page.goto("/");
  await manage(page);
  await page.getByText("测试连接器", { exact: true }).click();
  const binding = page.getByRole("region", { name: "连接与凭据", exact: true });
  await expect(binding).toContainText(declaration.target);
  await expect(binding).toContainText(`已保存的连接仍指向 ${old}`);
  await binding
    .getByLabel(`${declaration.label} 的 API Key`)
    .fill("sk-test-key");
  await binding
    .getByRole("button", { name: "更换 API Key", exact: true })
    .click();
  await expect(binding).toContainText("已取消");
  const payloads = await page.evaluate(
    () =>
      (window as unknown as { __credentialPayloads: object[] })
        .__credentialPayloads,
  );
  expect(payloads).toMatchObject([
    { declaration: { target: declaration.target } },
  ]);
});

for (const width of [375, 1180])
  test(`the model connection page adds a provider and picks models the service lists ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: unknown;
        __configured: Array<Record<string, unknown>>;
        __requests: Array<Record<string, unknown>>;
        __reads: Array<Record<string, unknown>>;
      };
      w.isTauri = true;
      w.__configured = [];
      w.__requests = [];
      w.__reads = [];
      let records: Array<Record<string, unknown>> = [];
      const states = new Map<string, { revision: number; value: unknown }>();
      type Item = Record<string, unknown> & { seq: number; revision: number };
      const items = new Map<string, Item>();
      let seq = 0;
      (w as unknown as { __states: () => string }).__states = () =>
        JSON.stringify([...states, ...items]);
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback: () => {},
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
          if (command === "credential_request") {
            w.__requests.push(args);
            return {
              status: 200,
              body: JSON.stringify({
                data: ["model-two", "model-one", "model-three"].map((id) => ({
                  id,
                })),
              }),
            };
          }
          // models.dev, trimmed: the gateway is unknown there, so the
          // window comes from the maker's entry another service points at.
          if (command === "network_read") {
            w.__reads.push(args);
            return {
              status: 200,
              body: JSON.stringify({
                acme: {
                  models: { "model-two": { limit: { context: 200_000 } } },
                },
                reseller: {
                  api: "https://reseller.invalid/v1",
                  models: {
                    "model-two": { canonical_model_id: "acme/model-two" },
                  },
                },
              }),
            };
          }
          if (command === "document_supported") return false;
          if (command === "platform_call") {
            const payload = (args.payload ?? {}) as {
              key?: string;
              revision: number;
              value: unknown;
            };
            const slot = `${String(args.owner)}+${payload.key ?? ""}`;
            if (args.capability === "state.read")
              return states.get(slot) ?? null;
            if (args.capability === "state.write") {
              const next = {
                revision: payload.revision + 1,
                value: payload.value,
              };
              states.set(slot, next);
              return next;
            }
            // The Agent store: a batch and its records, without checks.
            const owner = String(args.owner);
            if (args.capability === "state.batch") {
              const batch = args.payload as {
                documents?: {
                  key?: string;
                  revision: number;
                  value: unknown;
                }[];
                clear?: string[];
                records?: (Record<string, unknown> & {
                  collection: string;
                  id: string;
                  revision: number;
                  remove?: true;
                })[];
              };
              const documents = (batch.documents ?? []).map((write) => {
                const next = {
                  revision: write.revision + 1,
                  value: write.value,
                };
                states.set(`${owner}+${write.key ?? ""}`, next);
                return { revision: next.revision };
              });
              for (const name of batch.clear ?? [])
                for (const key of [...items.keys()])
                  if (key.startsWith(`${owner}\n${name}\n`)) items.delete(key);
              const records = (batch.records ?? []).map((write) => {
                const key = `${owner}\n${write.collection}\n${write.id}`;
                if (write.remove) {
                  items.delete(key);
                  return null;
                }
                const item = {
                  ...write,
                  seq: items.get(key)?.seq ?? ++seq,
                  revision: write.revision + 1,
                };
                items.set(key, item);
                return { seq: item.seq, revision: item.revision };
              });
              return { documents, records };
            }
            if (args.capability === "records.list") {
              const { collection } = args.payload as { collection: string };
              return {
                records: [...items]
                  .filter(([key]) =>
                    key.startsWith(`${owner}\n${collection}\n`),
                  )
                  .map(([, item]) => item)
                  .sort((a, b) => a.seq - b.seq),
                next: null,
              };
            }
          }
        },
      };
    });
    await page.goto("/");
    const dialog = await openConnections(page);
    await dialog
      .getByRole("button", { name: "添加服务商", exact: true })
      .click();
    const presets = dialog.getByRole("combobox", {
      name: "服务商",
      exact: true,
    });
    // Keyboard: open, Escape closes only the list, then choose with arrows.
    await presets.focus();
    await page.keyboard.press("ArrowDown");
    const list = dialog.getByRole("listbox", { name: "服务商" });
    const current = list.getByRole("option", { selected: true });
    await expect(current).toHaveText("DeepSeek");
    // The open list takes over Escape and keys once its layer has settled
    // (a frame later); people do not type faster than that.
    const settled = () =>
      page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
    await settled();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(presets).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(current).toBeFocused();
    await settled();
    await page.keyboard.press("End");
    await expect(list.getByRole("option", { name: "自定义" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(presets).toHaveText("自定义");
    await expect(presets).toBeFocused();
    await dialog.getByRole("combobox", { name: "API 格式" }).click();
    await dialog.getByRole("option", { name: "Anthropic Messages" }).click();
    await dialog
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("网关");
    // Notes and the website wait under 高级选项.
    await dialog.getByRole("button", { name: "高级选项", exact: true }).click();
    await dialog
      .getByRole("textbox", { name: "备注", exact: true })
      .fill("公司账号");
    const address = dialog.getByRole("textbox", {
      name: "请求地址",
      exact: true,
    });
    // A pasted full address keeps working; the chat address is shown.
    await address.fill("https://gateway.invalid/v1/messages");
    await address.blur();
    await expect(address).toHaveValue("https://gateway.invalid");
    await expect(dialog).toContainText(
      "对话请求发往 https://gateway.invalid/v1/messages",
    );
    const fetchModels = dialog.getByRole("button", {
      name: "获取模型列表",
      exact: true,
    });
    await fetchModels.click();
    await expect(dialog.getByRole("alert")).toHaveText("请填写 API Key。");
    // Errors pass on their own, without a close button.
    await expect(dialog.getByRole("alert")).toBeHidden({ timeout: 15000 });
    const key = dialog.getByLabel("API Key", { exact: true });
    await expect(key).toHaveAttribute("type", "password");
    await key.fill(" sk-test-key ");
    await fetchModels.click();
    const picker = dialog.getByRole("group", { name: "服务提供的模型" });
    await expect(picker.getByRole("checkbox")).toHaveCount(3);
    await expect(picker.getByRole("listitem")).toHaveText([
      "model-one",
      "model-three",
      "model-two上下文 200K",
    ]);
    await picker.getByRole("checkbox", { name: "model-one" }).check();
    await picker.getByRole("checkbox", { name: "model-two" }).check();
    await picker.getByRole("button", { name: "添加所选（2）" }).click();
    await expect(picker).toBeHidden();
    const added = dialog.getByRole("list", { name: "已添加的模型" });
    // Each row's window picker carries a hidden native select (Radix form
    // support), so rows are matched by their visible start.
    await expect(added.getByRole("listitem")).toHaveText([
      /^model-one自动.*默认（128K）/,
      /^model-two自动.*200K/,
    ]);
    await dialog
      .getByRole("button", { name: "移除 model-one", exact: true })
      .click();
    const modelName = dialog.getByRole("textbox", {
      name: "模型名",
      exact: true,
    });
    await modelName.fill("model-three");
    await modelName.press("Enter");
    const context = dialog.getByRole("combobox", {
      name: "默认上下文窗口",
      exact: true,
    });
    await expect(context).toHaveText("128K");
    // The long explanation sits behind an info button, not under the field.
    await expect(dialog.getByText(/^模型能接收的总 token 数/)).toBeHidden();
    const info = dialog.getByRole("button", {
      name: "默认上下文窗口说明",
      exact: true,
    });
    await info.click();
    await expect(
      dialog.getByRole("dialog", { name: "默认上下文窗口说明", exact: true }),
    ).toContainText("模型能接收的总 token 数");
    await info.click();
    await expect(
      dialog.getByRole("dialog", { name: "默认上下文窗口说明", exact: true }),
    ).toBeHidden();
    await context.click();
    await dialog.getByRole("option", { name: "1M", exact: true }).click();
    await expect(context).toHaveText("1M");
    // Models without their own window follow the default.
    await expect(added.getByRole("listitem")).toHaveText([
      /^model-two自动.*200K/,
      /^model-three自动.*默认（1M）/,
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    const provider = dialog
      .getByRole("list", { name: "服务商" })
      .getByRole("listitem", { name: "网关" });
    await expect(provider).toContainText("可用");
    // Its address and notes; each model with its window and a test.
    await expect(provider).toContainText("https://gateway.invalid公司账号");
    await expect(
      provider.getByRole("list", { name: "网关 的模型" }).getByRole("listitem"),
    ).toHaveText(["model-two上下文 200K测试", "model-three上下文 1M测试"]);
    // Deleting a provider lives in its edit form, not beside 编辑.
    await expect(provider.getByRole("button", { name: /删除/ })).toHaveCount(0);
    await expect(
      provider.getByRole("button", { name: "测试 model-two", exact: true }),
    ).toBeEnabled();
    const { configured, requests, reads } = await page.evaluate(() => {
      const w = window as unknown as {
        __configured: Array<Record<string, unknown>>;
        __requests: Array<Record<string, unknown>>;
        __reads: Array<Record<string, unknown>>;
      };
      return {
        configured: w.__configured,
        requests: w.__requests,
        reads: w.__reads,
      };
    });
    // models.dev is read without the key, from the connector's declared source.
    expect(reads).toEqual([
      {
        owner: "extension.connector.models",
        id: expect.any(String),
        url: "https://models.dev/api.json",
      },
    ]);
    expect(configured).toHaveLength(1);
    expect(configured[0]).toMatchObject({
      owner: "extension.connector.models",
      source: "内置模型连接器",
      revision: 0,
      key: "sk-test-key",
      declaration: {
        label: "网关",
        target: "https://gateway.invalid/v1/messages",
        headers: { "anthropic-version": "2023-06-01" },
        authentication: { type: "header", name: "x-api-key" },
      },
    });
    expect(configured[0].alias).toMatch(/^c-[a-z0-9]{8}$/);
    expect(requests).toEqual([
      expect.objectContaining({
        binding: configured[0].alias,
        body: "",
        path: "/v1/models",
      }),
    ]);
    // The key went only to native storage, not into the extension's records.
    expect(
      await page.evaluate(() =>
        (window as unknown as { __states: () => string }).__states(),
      ),
    ).not.toContain("sk-test-key");
    // Editing shows that a key is saved, without showing it.
    await provider.getByRole("button", { name: "编辑 网关" }).click();
    await expect(dialog.getByLabel("API Key", { exact: true })).toHaveValue("");
    await expect(dialog).toContainText("已保存");
    await expect(
      dialog.getByRole("button", { name: "删除服务商", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "返回", exact: true }).click();
    // An Agent that picks one of these models is listed in management as a
    // user of the connector as well as of the Agent interface.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // The dialog opened over management, which is still shown beneath it.
    await page.getByRole("button", { name: "返回工作区", exact: true }).click();
    await addAgent(page, "模型助手");
    await page.getByRole("combobox", { name: "切换模型", exact: true }).click();
    await page
      .getByRole("listbox", { name: "切换模型" })
      .getByRole("option", { name: /^model-two/ })
      .click();
    await manage(page);
    // The connector and the Agent interface both list the Agent.
    for (const id of ["connector.models", "ui.agents"])
      await expect(page.locator(`[data-extension-id="${id}"]`)).toContainText(
        "个 Agent 在使用",
      );
  });
