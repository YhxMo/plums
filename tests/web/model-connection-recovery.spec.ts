import { expect, test, type Page } from "@playwright/test";
import { openConnections } from "./helpers";

type Controls = {
  requests: string[];
  aborted: string[];
  active: string | null;
  configured: number;
  failRefresh: boolean;
  holdRequest: boolean;
  holdSave: boolean;
  releaseSave?: () => void;
  savedModels: () => string[][];
};
declare global {
  interface Window {
    modelRecovery: Controls;
  }
}

/** Native bridge with isolated records and one cancellable credential request. */
async function setup(
  page: Page,
  { models = ["saved-model"], empty = false } = {},
) {
  await page.addInitScript(
    ({ models, empty }) => {
      const owner = "extension.connector.models";
      const provider = {
        id: "p-12345678",
        alias: "c-12345678",
        name: "合成服务",
        notes: "",
        website: "",
        preset: "custom",
        protocol: "openai-chat",
        base: "https://model.invalid/v1",
        models,
        windows: {},
        maxTokens: null,
        context: 128_000,
      };
      let records: Array<Record<string, unknown>> = empty
        ? []
        : [
            {
              owner,
              alias: provider.alias,
              declaration: {
                label: provider.name,
                target: `${provider.base}/chat/completions`,
                contentType: "application/json",
                headers: {},
                authentication: { type: "bearer" },
              },
              source: "内置模型连接器",
              version: "0.1.0",
              revision: 1,
              status: "ready",
              route: { type: "direct" },
            },
          ];
      type Saved = { revision: number; value: unknown };
      const states = new Map<string, Saved>();
      if (!empty)
        states.set(`${owner}+`, {
          revision: 1,
          value: { version: 6, providers: [provider] },
        });
      const controls: Controls = {
        requests: [],
        aborted: [],
        active: null,
        configured: 0,
        failRefresh: false,
        holdRequest: false,
        holdSave: false,
        savedModels: () =>
          (
            states.get(`${owner}+`)?.value as
              { providers: Array<{ models: string[] }> } | undefined
          )?.providers.map((p) => p.models) ?? [],
      };
      let failList = false;
      let rejectRequest: ((reason: unknown) => void) | undefined;
      const w = window as unknown as Window & {
        isTauri: boolean;
        __TAURI_INTERNALS__: unknown;
      };
      w.isTauri = true;
      w.modelRecovery = controls;
      w.__TAURI_INTERNALS__ = {
        async invoke(command: string, args: Record<string, unknown>) {
          if (command === "credential_supported") return true;
          if (command === "document_supported") return false;
          if (command === "credential_inventory") return records;
          if (command === "credential_list") {
            if (failList) {
              failList = false;
              throw new Error("合成连接状态读取失败");
            }
            return records.filter((record) => record.owner === args.owner);
          }
          if (command === "credential_configure") {
            controls.configured++;
            records = [
              ...records.filter((record) => record.alias !== args.alias),
              {
                owner: args.owner,
                alias: args.alias,
                declaration: args.declaration,
                source: args.source,
                version: args.version,
                revision: Number(args.revision) + 1,
                status: "ready",
                route: { type: "direct" },
              },
            ];
            return { status: "saved" };
          }
          if (command === "platform_call") {
            const payload = (args.payload ?? {}) as {
              key?: string;
              revision: number;
              value: unknown;
            };
            const slot = `${args.owner}+${payload.key ?? ""}`;
            if (args.capability === "state.read")
              return states.get(slot) ?? null;
            if (args.capability === "state.write") {
              if (payload.revision !== (states.get(slot)?.revision ?? 0))
                throw {
                  code: "revision-conflict",
                  outcome: "not-committed",
                };
              const next = {
                revision: payload.revision + 1,
                value: payload.value,
              };
              states.set(slot, next);
              if (args.owner === owner) {
                failList = controls.failRefresh;
                controls.failRefresh = false;
                if (controls.holdSave)
                  await new Promise<void>((resolve) => {
                    controls.releaseSave = resolve;
                  });
              }
              return next;
            }
          }
          if (command === "network_read") return { status: 200, body: "{}" };
          if (command === "credential_request") {
            if (controls.active)
              throw { code: "busy", outcome: "not-dispatched" };
            const id = args.id as string;
            controls.requests.push(id);
            if (controls.holdRequest) {
              controls.active = id;
              return new Promise((_, reject) => {
                rejectRequest = reject;
              });
            }
            return {
              status: 200,
              body: JSON.stringify(
                args.path
                  ? { data: [{ id: "listed-a" }, { id: "listed-b" }] }
                  : {
                      choices: [
                        {
                          index: 0,
                          finish_reason: "stop",
                          message: {
                            role: "assistant",
                            content: "连接成功",
                          },
                        },
                      ],
                    },
              ),
            };
          }
          if (command === "credential_abort" && args.id === controls.active) {
            controls.aborted.push(args.id as string);
            controls.active = null;
            rejectRequest?.({ code: "cancelled", outcome: "unknown" });
          }
        },
      };
    },
    { models, empty },
  );
  await page.goto("/");
}

test("a committed new provider closes the form even if its status refresh fails", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 800 });
  await setup(page, { empty: true });
  const dialog = await openConnections(page);
  await dialog.getByRole("button", { name: "添加服务商", exact: true }).click();
  await dialog.getByLabel("API Key", { exact: true }).fill("sk-synthetic");
  await page.evaluate(() => {
    window.modelRecovery.failRefresh = true;
  });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const providers = dialog.getByRole("list", { name: "服务商", exact: true });
  await expect(providers.getByRole("listitem")).toHaveCount(1);
  await expect(providers).toContainText("待核对");
  await expect(dialog.getByRole("status")).toContainText("已保存");
  await page.screenshot({ path: testInfo.outputPath("saved-pending.png") });
  await dialog
    .getByRole("button", { name: "编辑 DeepSeek", exact: true })
    .click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(providers.getByRole("listitem")).toHaveCount(1);
  expect(await page.evaluate(() => window.modelRecovery.configured)).toBe(1);
});

for (const action of ["test", "list"] as const)
  test(`closing the model ${action} dialog cancels its request and frees the next one`, async ({
    page,
  }) => {
    await setup(page);
    await page.evaluate(() => {
      window.modelRecovery.holdRequest = true;
    });
    const dialog = await openConnections(page);
    if (action === "test")
      await dialog.getByRole("button", { name: "测试 saved-model" }).click();
    else {
      await dialog.getByRole("button", { name: "编辑 合成服务" }).click();
      await dialog.getByRole("button", { name: "获取模型列表" }).click();
    }
    await expect
      .poll(() => page.evaluate(() => window.modelRecovery.active))
      .not.toBeNull();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.modelRecovery.aborted.length))
      .toBe(1);
    const stopped = await page.evaluate(() => {
      const state = window.modelRecovery;
      state.holdRequest = false;
      return { requests: state.requests, aborted: state.aborted };
    });
    expect(stopped.aborted).toEqual(stopped.requests);
    await openConnections(page);
    await dialog.getByRole("button", { name: "测试 saved-model" }).click();
    await expect(
      dialog.getByText("回复：连接成功", { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });

test("closing while saving a new provider does not start its later model read", async ({
  page,
}) => {
  await setup(page, { empty: true });
  const dialog = await openConnections(page);
  await dialog.getByRole("button", { name: "添加服务商", exact: true }).click();
  await dialog.getByLabel("API Key", { exact: true }).fill("sk-synthetic");
  await page.evaluate(() => {
    window.modelRecovery.holdSave = true;
  });
  await dialog.getByRole("button", { name: "获取模型列表" }).click();
  await page.waitForFunction(() => !!window.modelRecovery.releaseSave);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => {
    const state = window.modelRecovery;
    state.holdSave = false;
    state.releaseSave!();
  });
  await openConnections(page);
  await expect(
    dialog.getByRole("button", { name: "测试 saved-model" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("listitem", { name: "DeepSeek" }),
  ).toContainText("可用");
  expect(await page.evaluate(() => window.modelRecovery.requests)).toEqual([]);
});

test("manual additions are excluded from an existing model selection", async ({
  page,
}) => {
  await setup(page);
  const dialog = await openConnections(page);
  await dialog.getByRole("button", { name: "编辑 合成服务" }).click();
  await dialog.getByRole("button", { name: "获取模型列表" }).click();
  const picker = dialog.getByRole("group", { name: "服务提供的模型" });
  await picker.getByRole("checkbox", { name: "listed-a", exact: true }).check();
  await picker.getByRole("checkbox", { name: "listed-b", exact: true }).check();
  await dialog
    .getByRole("textbox", { name: "模型名", exact: true })
    .fill("listed-a");
  await dialog.getByRole("button", { name: "添加模型", exact: true }).click();
  await picker.getByRole("button", { name: /^添加所选/ }).click();
  await expect(
    dialog.getByRole("list", { name: "已添加的模型" }).getByRole("listitem"),
  ).toHaveCount(3);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "编辑 合成服务" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.modelRecovery.savedModels())).toEqual(
    [["saved-model", "listed-a", "listed-b"]],
  );
});

test("model selection rechecks capacity after a manual addition", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const models = Array.from({ length: 31 }, (_, i) => `saved-${i}`);
  await setup(page, { models });
  const dialog = await openConnections(page);
  await dialog.getByRole("button", { name: "编辑 合成服务" }).click();
  await dialog.getByRole("button", { name: "获取模型列表" }).click();
  const picker = dialog.getByRole("group", { name: "服务提供的模型" });
  await picker.getByRole("checkbox", { name: "listed-a", exact: true }).check();
  await dialog
    .getByRole("textbox", { name: "模型名", exact: true })
    .fill("manual");
  await dialog.getByRole("button", { name: "添加模型", exact: true }).click();
  const add = picker.getByRole("button", { name: /^添加所选/ });
  await expect(add).toBeDisabled();
  await picker.getByRole("alert").scrollIntoViewIfNeeded();
  await expect(picker.getByRole("alert")).toContainText("最多还能添加 0 个");
  await page.screenshot({ path: testInfo.outputPath("model-capacity.png") });
  await dialog
    .getByRole("button", { name: "移除 saved-0", exact: true })
    .click();
  await expect(add).toBeEnabled();
  await add.click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "编辑 合成服务" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.modelRecovery.savedModels())).toEqual(
    [[...models.slice(1), "manual", "listed-a"]],
  );
});
