import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

it("uses plain text by default, opts into tools and keeps chat controls usable at narrow widths", async () => {
  const f = await fixture();
  try {
    await f.page.addInitScript(() => {
      const state = {
        calls: [] as any[],
        finish: undefined as any,
        reject: undefined as any,
      };
      (window as any).chatFixture = state;
      (window as any).plums = {
        openManager: async () => {},
        invoke: async (kind: string, name: string, input: unknown) => {
          if (name === "history") return [];
          state.calls.push({ kind, name, input });
          return new Promise((resolve, reject) => {
            state.finish = resolve;
            state.reject = reject;
          });
        },
      };
    });
    await f.page.goto(
      pathToFileURL(path.resolve("examples/chat-ui/ui/index.html")).href,
    );
    const checkbox = f.page.getByLabel("使用工作目录工具"),
      send = f.page.getByRole("button", { name: "发送 ↗" });
    expect(await checkbox.isChecked()).toBe(false);
    await f.page.locator("#text").fill("普通文本问题");
    await send.click();
    expect(await checkbox.isDisabled()).toBe(true);
    await f.page.evaluate(() =>
      document.querySelector("form")!.requestSubmit(),
    );
    expect(
      await f.page.evaluate(() => (window as any).chatFixture.calls),
    ).toEqual([
      {
        kind: "commands",
        name: "chat",
        input: { text: "普通文本问题", useTools: false },
      },
    ]);
    await f.page.evaluate(() =>
      (window as any).chatFixture.finish({ text: "文本回复" }),
    );
    await f.page.getByText("文本回复", { exact: true }).waitFor();
    await checkbox.check();
    await f.page.locator("#text").fill("使用目录工具");
    await send.click();
    expect(
      await f.page.evaluate(
        () => (window as any).chatFixture.calls[1].input.useTools,
      ),
    ).toBe(true);
    await f.page.evaluate(() =>
      (window as any).chatFixture.reject({
        message: "服务拒绝了请求（HTTP 401）",
      }),
    );
    await f.page
      .getByText("服务拒绝了请求（HTTP 401）", { exact: true })
      .waitFor();
    expect(await send.isEnabled()).toBe(true);
    expect(await checkbox.isEnabled()).toBe(true);
    for (const width of [1180, 760, 375, 320]) {
      await f.page.setViewportSize({ width, height: 800 });
      expect(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  } finally {
    await f.close();
  }
});

async function fixture(holdRuntime = false) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "plums-interaction-"));
  const main = path.join(temporary, "main.cjs");
  await writeFile(
    main,
    `const { app, BrowserWindow } = require('electron'); app.setPath('userData', __dirname); app.whenReady().then(() => new BrowserWindow({ show: process.platform === 'linux', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }).loadURL('about:blank'));`,
  );
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  const application = await electron.launch({
    executablePath: require("electron"),
    args: [main],
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(5_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((holdRuntime) => {
    const component = (id: string, name: string, kind = "extension") => ({
      id,
      name,
      kind,
      version: "1.0.0",
      enabled: true,
      manifest: {
        id,
        name,
        kind,
        version: "1.0.0",
        formatVersion: "2.0",
        description: "测试组件",
        dependencies: [],
        permissions:
          kind === "extension"
            ? [
                {
                  id: "files",
                  kind: "fs",
                  target: "workspace",
                  operations: ["read"],
                  reason: "读取工作文件",
                },
              ]
            : [],
        payload:
          kind === "extension"
            ? { plumsDesktop: { frontend: "index.html" } }
            : {},
      },
      settings: {
        schema: {
          type: "object",
          properties: { note: { type: "string", title: "备注" } },
        },
        values: { note: "原配置" },
        secrets: {},
      },
      desktop:
        kind === "extension"
          ? {
              frontend: "index.html",
              contributes: { commands: [{ name: "check", title: "检查" }] },
            }
          : undefined,
    });
    const packages = [
      component("alpha", "工具甲"),
      component("beta", "工具乙"),
      component("card", "角色", "character"),
    ];
    const agents = ["a", "b"].map((instanceId) => ({
      instanceId,
      name: `助手 ${instanceId}`,
      agent: { version: "1.0.0", startup: "alpha" },
      characterId: "card",
      roots: { workspace: "/test/workspace" },
      components: packages.map((p) => ({
        packageId: p.id,
        kind: p.kind,
        version: p.version,
        digest: p.id,
      })),
    }));
    const library = packages.map((p) => ({
      digest: p.id,
      manifest: p.manifest,
      usedBy: ["a", "b"],
      missingDependencies: [],
    }));
    library.push({
      ...structuredClone(library[0]!),
      digest: "alpha-v2",
      manifest: { ...structuredClone(packages[0]!.manifest), version: "2.0.0" },
    });
    const state = {
      agents,
      packages: { a: structuredClone(packages), b: structuredClone(packages) },
      library,
      calls: [] as { method: string; args: any }[],
      hold: holdRuntime ? ["agentState:"] : [],
      waiting: [] as {
        key: string;
        resolve: () => void;
        reject: (e: unknown) => void;
      }[],
      failSettings: false,
      failEdit: false,
      failList: false,
      failListAfterCreate: false,
      refresh: () => {},
      runtime: (
        _value: { instanceId: string; name: string; visible: boolean } | null,
      ) => {},
      dnsMode: "system",
    };
    (window as any).interaction = state;
    (window as any).manager = {
      async call(method: string, args: any = {}) {
        state.calls.push({ method, args });
        const key = `${method}:${args.packageId ?? ""}`;
        if (state.hold.includes(key)) {
          state.hold = state.hold.filter((k) => k !== key);
          await new Promise<void>((resolve, reject) =>
            state.waiting.push({ key, resolve, reject }),
          );
        }
        const record = state.agents.find(
          (a) => a.instanceId === args.instanceId,
        )!;
        const resources = state.packages[args.instanceId as "a" | "b"];
        switch (method) {
          case "revokeTaskScope":
            return null;
          case "agentState":
            return null;
          case "windowState":
            return { fullscreen: false };
          case "agentStatus":
            return "ready";
          case "list":
            if (state.failList) throw { message: "刷新暂时失败" };
            return structuredClone(state.agents);
          case "library":
            return structuredClone(state.library);
          case "desktopSettings":
            return { dnsMode: state.dnsMode };
          case "setDesktopSettings":
            state.dnsMode = args.dnsMode;
            return null;
          case "audit":
            return [];
          case "resources":
            return structuredClone({ record, packages: resources });
          case "enable":
            resources.find((p) => p.id === args.packageId)!.enabled = true;
            return null;
          case "disable":
            resources.find((p) => p.id === args.packageId)!.enabled = false;
            return null;
          case "settings":
            if (state.failSettings) throw { message: "配置未保存，请重试" };
            resources.find((p) => p.id === args.packageId)!.settings.values =
              args.values;
            return null;
          case "editAgent":
            if (state.failEdit) throw { message: "名称未保存，请重试" };
            record.name = args.name;
            record.characterId = args.characterId;
            record.agent.startup = args.startup;
            return null;
          case "createAgent": {
            const created = {
              ...structuredClone(state.agents[0]!),
              instanceId: "created",
              name: args.name,
              components: [],
              characterId: args.characterId,
              agent: { version: "1.0.0", startup: args.startup },
            };
            state.agents.push(created);
            (state.packages as any).created = [];
            state.failList = state.failListAfterCreate;
            return structuredClone(created);
          }
          case "updateFromLibrary":
            resources.find((p) => p.id === args.packageId)!.version = "2.0.0";
            record.components.find(
              (p) => p.packageId === args.packageId,
            )!.digest = args.digest;
            return null;
          case "unbindRoot":
            delete (record.roots as any)[args.name];
            return null;
          case "invoke":
            return { from: args.instanceId };
          case "chooseImport":
            return null;
          case "preview":
            return {
              token: "drop",
              type: "component",
              components: [{ ...packages[0], code: false, permissions: [] }],
            };
          case "planAssembly":
            return { digests: args.digests, additions: [] };
          default:
            throw { message: `Unexpected method ${method}` };
        }
      },
      onWindowState() {
        return () => {};
      },
      onAgentState(fn: typeof state.runtime) {
        state.runtime = fn;
        return () => {};
      },
      onSelect() {
        return () => {};
      },
      onImport() {
        return () => {};
      },
      onRefresh(fn: () => void) {
        state.refresh = fn;
        return () => {};
      },
      filePath() {
        return "fixture.zip";
      },
    };
  }, holdRuntime);
  await page.goto(
    pathToFileURL(path.resolve("packages/desktop/dist/renderer/index.html"))
      .href,
  );
  await page.getByTestId("agent-switcher").waitFor();
  return {
    page,
    async close() {
      expect(errors).toEqual([]);
      await application.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

it("derives running status from events, restores availability after switching or stopping, and ignores a late runtime snapshot", async () => {
  const f = await fixture(true);
  const { page } = f;
  try {
    const a = page
      .getByTestId("agent-card")
      .filter({ hasText: "助手 a" })
      .getByTestId("agent-status");
    const b = page
      .getByTestId("agent-card")
      .filter({ hasText: "助手 b" })
      .getByTestId("agent-status");
    await expect.poll(() => a.textContent()).toBe("可用");
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.runtime({ instanceId: "a", name: "助手 a", visible: true });
      s.waiting.find((w: any) => w.key === "agentState:").resolve();
    });
    await expect.poll(() => a.textContent()).toBe("运行中");
    await expect.poll(() => b.textContent()).toBe("可用");
    await page.evaluate(() =>
      (window as any).interaction.runtime({
        instanceId: "b",
        name: "助手 b",
        visible: false,
      }),
    );
    await expect.poll(() => a.textContent()).toBe("可用");
    await expect.poll(() => b.textContent()).toBe("运行中");
    await page.evaluate(() => (window as any).interaction.runtime(null));
    await expect.poll(() => b.textContent()).toBe("可用");
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.failList = true;
      s.refresh();
    });
    await page.locator("main").getByRole("alert").waitFor();
    await page.evaluate(() =>
      (window as any).interaction.runtime({
        instanceId: "a",
        name: "助手 a",
        visible: true,
      }),
    );
    await expect.poll(() => a.textContent()).toBe("运行中");
    await page.evaluate(() => (window as any).interaction.runtime(null));
    await expect.poll(() => a.textContent()).toBe("可用");
  } finally {
    await f.close();
  }
});

it("isolates pending component operations, rejects duplicate submissions and keeps configuration errors inside their dialog", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.packages.a.forEach((p: any) => {
        p.enabled = false;
      });
      s.hold = ["enable:alpha"];
      s.refresh();
    });
    await page.getByTestId("nav-tab-extension").click();
    await page.getByRole("button", { name: /管理当前 Agent/ }).click();
    const alpha = page
      .getByTestId("component-row")
      .filter({ hasText: "工具甲" });
    const beta = page
      .getByTestId("component-row")
      .filter({ hasText: "工具乙" });
    await alpha
      .getByRole("button", { name: "启用", exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await page.waitForFunction(
      () => (window as any).interaction.waiting.length === 1,
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (c: any) => c.method === "enable" && c.args.packageId === "alpha",
          ).length,
      ),
    ).toBe(1);
    expect(
      await alpha
        .getByRole("button", { name: "启用", exact: true })
        .isDisabled(),
    ).toBe(true);
    expect(await page.getByTestId("import-file").isDisabled()).toBe(false);
    expect(
      await beta
        .getByRole("button", { name: "启用", exact: true })
        .isDisabled(),
    ).toBe(false);
    await beta.getByRole("button", { name: "启用", exact: true }).click();
    await beta.getByRole("button", { name: "配置", exact: true }).waitFor();
    await page.evaluate(() =>
      (window as any).interaction.waiting[0].reject({
        message: "工具甲未启用",
      }),
    );
    await alpha.getByRole("alert").waitFor();
    expect(await beta.getByRole("alert").count()).toBe(0);
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (c: any) => c.method === "enable" && c.args.packageId === "alpha",
          ).length,
      ),
    ).toBe(1);
    await beta.getByRole("button", { name: "配置", exact: true }).click();
    await page.getByLabel("备注", { exact: true }).fill("保留输入");
    await page.evaluate(() => {
      (window as any).interaction.failSettings = true;
    });
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    const dialog = page.getByTestId("config-dialog");
    await dialog.getByRole("alert").waitFor();
    expect(await page.getByLabel("备注", { exact: true }).inputValue()).toBe(
      "保留输入",
    );
    expect(
      await page.locator("main").getByText("配置未保存，请重试").count(),
    ).toBe(0);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      await page.getByText("配置未保存，请重试", { exact: true }).count(),
    ).toBe(0);
  } finally {
    await f.close();
  }
});

it("saves existing composition preferences immediately and retains failed name edits for retry", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.getByTestId("agent-card").filter({ hasText: "助手 a" }).click();
    await page.getByRole("button", { name: "编辑组合", exact: true }).click();
    const dialog = page.getByTestId("assembly-dialog");
    expect(
      await dialog.getByRole("button", { name: "保存名称与选择" }).count(),
    ).toBe(0);
    await page.getByLabel("Agent 名称", { exact: true }).fill("新名称");
    await page.keyboard.press("Enter");
    await dialog.getByText("已保存", { exact: true }).waitFor();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).interaction.agents[0].name),
      )
      .toBe("新名称");
    await page.getByLabel("默认角色卡", { exact: true }).selectOption("");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).interaction.calls.filter(
              (c: any) => c.method === "editAgent",
            ).length,
        ),
      )
      .toBe(2);
    await expect
      .poll(() => page.getByLabel("工作界面", { exact: true }).isDisabled())
      .toBe(false);
    await page.getByLabel("工作界面", { exact: true }).selectOption("beta");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).interaction.agents[0].agent.startup,
        ),
      )
      .toBe("beta");
    await expect
      .poll(() => page.getByLabel("Agent 名称", { exact: true }).isDisabled())
      .toBe(false);
    await page.evaluate(() => {
      (window as any).interaction.failEdit = true;
    });
    await page.getByLabel("Agent 名称", { exact: true }).fill("失败草稿");
    await page.keyboard.press("Enter");
    await dialog.getByRole("alert").waitFor();
    expect(
      await page.getByLabel("Agent 名称", { exact: true }).inputValue(),
    ).toBe("失败草稿");
    expect(
      await page.evaluate(() => (window as any).interaction.agents[0].name),
    ).toBe("新名称");
    await page.evaluate(() => {
      (window as any).interaction.failEdit = false;
    });
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).interaction.agents[0].name),
      )
      .toBe("失败草稿");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    expect(await page.locator("main").getByRole("alert").count()).toBe(0);
  } finally {
    await f.close();
  }
});

it("updates from an imported library version and confirms disabling and unbinding before applying them", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.getByTestId("agent-card").filter({ hasText: "助手 a" }).click();
    const alpha = page
      .getByTestId("component-row")
      .filter({ hasText: "工具甲" });
    await alpha.getByRole("button", { name: "工具甲 的更多操作" }).click();
    expect(await page.getByRole("button", { name: "从文件更新" }).count()).toBe(
      0,
    );
    await page
      .getByRole("button", { name: "有新版本 · 更新到 v2.0.0" })
      .click();
    await expect
      .poll(() => alpha.getByRole("heading").textContent())
      .toContain("v2.0.0");
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.find(
            (c: any) => c.method === "updateFromLibrary",
          ).args.digest,
      ),
    ).toBe("alpha-v2");
    await alpha.getByRole("button", { name: "停用", exact: true }).click();
    const confirm = page.getByTestId("delete-dialog");
    await confirm.waitFor();
    expect(
      await page.evaluate(() =>
        (window as any).interaction.calls.some(
          (c: any) => c.method === "disable",
        ),
      ),
    ).toBe(false);
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await alpha.getByRole("button", { name: "停用", exact: true }).click();
    await confirm.getByRole("button", { name: "停用", exact: true }).click();
    await confirm.waitFor({ state: "detached" });
    await alpha.getByRole("button", { name: "启用", exact: true }).waitFor();
    await page.getByRole("button", { name: "解除绑定", exact: true }).click();
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      await page.getByText("/test/workspace", { exact: true }).count(),
    ).toBe(1);
    await page.getByRole("button", { name: "解除绑定", exact: true }).click();
    await confirm
      .getByRole("button", { name: "解除绑定", exact: true })
      .click();
    await confirm.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "绑定", exact: true }).waitFor();
    expect(
      await page.getByText("/test/workspace", { exact: true }).count(),
    ).toBe(0);
  } finally {
    await f.close();
  }
});

it("drops stale invocation results after switching Agents and separates committed saves from refresh failures", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.getByTestId("nav-tab-settings").click();
    await page.getByRole("switch", { name: "开发者模式" }).click();
    await page.getByTestId("nav-tab-extension").click();
    await page.getByRole("button", { name: /管理当前 Agent/ }).click();
    const alpha = page
      .getByTestId("component-row")
      .filter({ hasText: "工具甲" });
    await alpha.getByText("开发者信息与调用", { exact: true }).click();
    await page.evaluate(() => {
      (window as any).interaction.hold = ["invoke:alpha"];
    });
    await alpha.getByRole("button", { name: "检查", exact: true }).click();
    await page.waitForFunction(
      () => (window as any).interaction.waiting.length === 1,
    );
    await page.getByTestId("agent-switcher").selectOption("b");
    await page.getByRole("heading", { name: "助手 b", exact: true }).waitFor();
    await page.evaluate(() => (window as any).interaction.waiting[0].resolve());
    expect(
      await page
        .getByRole("heading", { name: "调用结果", exact: true })
        .count(),
    ).toBe(0);
    await alpha.getByRole("button", { name: "配置", exact: true }).click();
    await page.getByLabel("备注", { exact: true }).fill("已提交");
    await page.evaluate(() => {
      (window as any).interaction.failList = true;
    });
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await page.getByTestId("config-dialog").waitFor({ state: "detached" });
    await page.getByText("刷新暂时失败", { exact: true }).waitFor();
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (c: any) => c.method === "settings",
          ).length,
      ),
    ).toBe(1);
    expect(
      await page.getByRole("button", { name: "重新加载", exact: true }).count(),
    ).toBe(1);
  } finally {
    await f.close();
  }
});

it("keeps new Agent edits as a draft and ignores file drops until the open dialog closes", async () => {
  const f = await fixture();
  const { page } = f;
  const drag = async (type: string) =>
    page.evaluate((type) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File(["test fixture"], "fixture.zip", { type: "application/zip" }),
      );
      document.querySelector(".app")!.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
    }, type);
  try {
    await drag("dragenter");
    await page.getByText("松开即可导入", { exact: true }).waitFor();
    await drag("dragleave");
    await page.getByRole("button", { name: "创建 Agent", exact: true }).click();
    const dialog = page.getByTestId("assembly-dialog");
    await page.getByLabel("Agent 名称", { exact: true }).fill("未创建的草稿");
    await page.getByLabel("工作界面", { exact: true }).selectOption("");
    await drag("dragenter");
    await drag("drop");
    expect(await page.getByText("松开即可导入", { exact: true }).count()).toBe(
      0,
    );
    expect(
      await page.evaluate(() =>
        (window as any).interaction.calls.some((c: any) =>
          ["preview", "createAgent", "editAgent"].includes(c.method),
        ),
      ),
    ).toBe(false);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await drag("dragenter");
    await page.getByText("松开即可导入", { exact: true }).waitFor();
    await drag("drop");
    await page.getByTestId("import-dialog").waitFor();
    expect(await page.getByText("松开即可导入", { exact: true }).count()).toBe(
      0,
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (c: any) => c.method === "preview",
          ).length,
      ),
    ).toBe(1);
  } finally {
    await f.close();
  }
});

it("does not invite duplicate creation when the Agent was committed before a refresh failure", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.getByRole("button", { name: "创建 Agent", exact: true }).click();
    const dialog = page.getByTestId("assembly-dialog");
    await page.getByLabel("Agent 名称", { exact: true }).fill("已创建的助手");
    await page.evaluate(() => {
      (window as any).interaction.failListAfterCreate = true;
    });
    await dialog
      .getByRole("button", { name: "创建 Agent", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    await page.getByText("刷新暂时失败", { exact: true }).waitFor();
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (c: any) => c.method === "createAgent",
          ).length,
      ),
    ).toBe(1);
    await page.evaluate(() => {
      (window as any).interaction.failList = false;
    });
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await page.getByTestId("setup-dialog").waitFor();
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.agents.filter(
            (a: any) => a.name === "已创建的助手",
          ).length,
      ),
    ).toBe(1);
  } finally {
    await f.close();
  }
});

it("keeps stop-and-revoke visible, suppresses duplicate clicks and shows retryable failures", async () => {
  const f = await fixture();
  try {
    await f.page
      .getByTestId("agent-card")
      .filter({ hasText: "助手 a" })
      .click();
    await f.page.evaluate(() => {
      (window as any).interaction.hold = ["revokeTaskScope:"];
    });
    const revoke = f.page.getByRole("button", {
      name: "停止并撤权",
      exact: true,
    });
    await revoke.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await f.page.waitForFunction(
      () => (window as any).interaction.waiting.length === 1,
    );
    expect(await revoke.isDisabled()).toBe(true);
    expect(
      await f.page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (c: any) => c.method === "revokeTaskScope",
          ).length,
      ),
    ).toBe(1);
    await f.page.evaluate(() =>
      (window as any).interaction.waiting[0].reject({
        message: "撤权记录暂时不可用",
      }),
    );
    await f.page
      .getByRole("alert")
      .filter({ hasText: "撤权记录暂时不可用" })
      .waitFor();
    await revoke.click();
    await expect.poll(() => f.page.getByRole("alert").count()).toBe(0);
  } finally {
    await f.close();
  }
});

it("displays the current model service in component permissions and refreshes it after configuration", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.evaluate(() => {
      const s = (window as any).interaction,
        p = s.packages.a[0];
      p.manifest.permissions = [
        {
          id: "model-access",
          kind: "service",
          target: "model",
          operations: ["complete"],
          reason: "使用配置的模型",
        },
      ];
      p.serviceTargets = { "model-access": ["opencode.ai（custom-model）"] };
      s.refresh();
    });
    await page.getByTestId("agent-card").filter({ hasText: "助手 a" }).click();
    const component = page
      .getByTestId("component-row")
      .filter({ hasText: "工具甲" });
    await component.locator("summary").click();
    await expect
      .poll(() =>
        component
          .getByText(
            "使用当前 Agent 配置的模型服务：opencode.ai（custom-model）",
            { exact: true },
          )
          .isVisible(),
      )
      .toBe(true);
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.packages.a[0].serviceTargets = {
        "model-access": ["custom.example（new-model）"],
      };
      s.refresh();
    });
    await expect
      .poll(() =>
        component
          .getByText(
            "使用当前 Agent 配置的模型服务：custom.example（new-model）",
            { exact: true },
          )
          .isVisible(),
      )
      .toBe(true);
    await expect.poll(() => component.getByText(/opencode.ai/).count()).toBe(0);
  } finally {
    await f.close();
  }
});
