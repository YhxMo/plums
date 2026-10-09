import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import os from "node:os";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  cp,
  mkdir,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

it("guides a ready Agent through configuration, keeps failed saves reviewable and opens configured Agents directly", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "plums-ui-test-"));
  const fixture = path.join(temporary, "main.cjs");
  await writeFile(
    fixture,
    `const { app, BrowserWindow } = require('electron'); app.setPath('userData', __dirname); app.whenReady().then(() => { const w = new BrowserWindow({ show: process.platform === 'linux', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }); w.loadURL('about:blank'); });`,
  );
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  const application = await electron.launch({
    executablePath: require("electron"),
    args: [fixture],
  });
  try {
    const page = await application.firstWindow();
    page.setDefaultTimeout(5_000);
    await page.setViewportSize({ width: 1180, height: 850 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const property = (type: string, title: string, extra = {}) => ({
        type,
        title,
        description: title,
        ...extra,
      });
      const model = {
        id: "model",
        kind: "connector",
        name: "模型连接器",
        version: "1.0.0",
        enabled: false,
        desktop: {
          sdkVersion: "1",
          model: {
            protocolSetting: "protocol",
            endpointSetting: "endpoint",
            modelSetting: "model",
            keySetting: "apiKey",
          },
        },
        settings: {
          schema: {
            type: "object",
            properties: {
              protocol: property("string", "协议", {
                enum: [
                  "OpenAI Chat Completions",
                  "OpenAI Responses",
                  "Anthropic Messages",
                  "Gemini",
                ],
                default: "OpenAI Chat Completions",
              }),
              model: property("string", "模型名称"),
              apiKey: property("string", "API Key", { "x-secret": true }),
              endpoint: property("string", "Base URL"),
              mode: property("integer", "处理模式", { enum: [1, 2] }),
              enabledFlag: property("boolean", "开启附加功能"),
            },
            required: ["model", "apiKey", "mode", "enabledFlag"],
          },
          values: {
            protocol: "OpenAI Chat Completions",
            endpoint: "https://example.com/model",
          },
          secrets: {},
        },
        manifest: { formatVersion: "2.0", dependencies: [], permissions: [] },
      };
      const app = {
        id: "workspace",
        kind: "extension",
        name: "工作界面",
        version: "1.0.0",
        enabled: false,
        settings: { values: {}, secrets: {} },
        manifest: {
          formatVersion: "2.0",
          dependencies: [{ id: "model", kind: "connector", range: "*" }],
          permissions: [],
        },
      };
      const record = {
        instanceId: "fixture-agent",
        name: "我的助手",
        agent: { id: "ready", version: "1.0.0", startup: "workspace" },
        components: [
          { packageId: "workspace", kind: "extension", digest: "app" },
          { packageId: "model", kind: "connector", digest: "model" },
        ],
      };
      const state = {
        agents: [] as (typeof record)[],
        packages: [app, model],
        calls: [] as { method: string; args: any }[],
        fail: true,
      };
      (window as any).uiFixture = state;
      (window as any).manager = {
        async call(method: string, args?: any) {
          if (method === "cacheStatus") return [];
          if (method === "agentState") return null;
          if (method === "agentStatus")
            return state.packages.every((p) => p.enabled)
              ? "ready"
              : "needs-config";
          if (method === "audit") return [];
          if (method === "tierPlan") return { fingerprint: "local-ui-fixture", selection: { ceiling: "sandbox", projects: [], readOnly: [], components: [] }, current: { revision: 0, tier: { instanceId: "fixture", ceiling: "sandbox", projects: [], readOnly: [], components: [] }, grants: [] }, entries: [], projects: [], readOnly: [] };
          state.calls.push({ method, args });
          switch (method) {
            case "list":
              return structuredClone(state.agents);
            case "library":
              return [
                {
                  digest: "workspace",
                  manifest: {
                    id: "workspace",
                    name: "工作界面",
                    kind: "extension",
                    version: "1.0.0",
                    description: "",
                    dependencies: [
                      { id: "model", kind: "connector", range: "*" },
                    ],
                    payload: { plumsDesktop: { frontend: "index.html" } },
                  },
                  usedBy: [],
                  missingDependencies: [],
                },
                {
                  digest: "model",
                  manifest: {
                    id: "model",
                    name: "模型连接器",
                    kind: "connector",
                    version: "1.0.0",
                    description: "",
                    dependencies: [],
                    payload: {},
                  },
                  usedBy: [],
                  missingDependencies: [],
                },
              ];
            case "planAssembly":
              await new Promise((resolve) => setTimeout(resolve, 100));
              return args.digests.includes("workspace")
                ? {
                    digests: ["model", "workspace"],
                    additions: [
                      { digest: "model", name: "模型连接器", version: "1.0.0" },
                    ],
                  }
                : { digests: args.digests, additions: [] };
            case "desktopSettings":
              return { dnsMode: "system" };
            case "chooseImport":
              return {
                token: "ready-zip",
                type: "agent",
                agent: { name: record.name },
                components: [],
              };
            case "install":
              state.agents = [record];
              return record;
            case "resources":
              return structuredClone({ record, packages: state.packages });
            case "settings":
              if (state.fail)
                throw {
                  code: "SETTINGS_INVALID",
                  message: "设置未保存，请重试。",
                };
              model.settings.values = args.values;
              model.settings.secrets = { apiKey: true };
              return null;
            case "startAgent":
              state.packages.forEach((p) => {
                p.enabled = true;
              });
              return { opened: true };
            case "openAgent":
              return true;
            default:
              throw { message: `Unexpected fixture call: ${method}` };
          }
        },
        onSelect() {
          return () => {};
        },
        onWindowState() {
          return () => {};
        },
        onAgentState() {
          return () => {};
        },
        onRefresh() {
          return () => {};
        },
        onImport() {
          return () => {};
        },
        filePath() {
          return "fixture.zip";
        },
      };
    });
    await page.goto(
      pathToFileURL(path.resolve("packages/desktop/dist/renderer/index.html"))
        .href,
    );
    const importButton = page.getByTestId("import-file");
    await importButton.click();
    await page.getByRole("button", { name: "导入并配置" }).click();
    await page.getByLabel("模型名称", { exact: true }).waitFor();
    expect(
      await page.getByLabel("Base URL", { exact: true }).inputValue(),
    ).toBe("https://example.com/model");
    expect(await page.getByLabel("协议", { exact: true }).inputValue()).toBe(
      "OpenAI Chat Completions",
    );
    await page
      .getByLabel("协议", { exact: true })
      .selectOption("Anthropic Messages");
    expect(
      await page
        .getByLabel("Base URL", { exact: true })
        .evaluate((el) => !!el.closest("details")),
    ).toBe(false);
    expect(
      await page.getByLabel("API Key", { exact: true }).getAttribute("type"),
    ).toBe("password");
    await page.getByRole("button", { name: "开始使用" }).click();
    expect(
      await page.evaluate(() =>
        (window as any).uiFixture.calls.some(
          (c: any) => c.method === "settings" || c.method === "startAgent",
        ),
      ),
    ).toBe(false);
    await page.getByLabel("模型名称", { exact: true }).fill("demo-model");
    await page.getByLabel("API Key", { exact: true }).fill("fake-form-key");
    await page
      .getByLabel("Base URL", { exact: true })
      .fill("https://example.com/custom");
    await page.getByLabel("处理模式", { exact: true }).selectOption("2");
    await page.getByRole("button", { name: "开始使用" }).click();
    await page.getByTestId("setup-dialog").getByRole("alert").waitFor();
    expect(
      await page.getByLabel("模型名称", { exact: true }).inputValue(),
    ).toBe("demo-model");
    expect(await page.getByLabel("API Key", { exact: true }).inputValue()).toBe(
      "fake-form-key",
    );
    expect(
      await page.evaluate(() =>
        (window as any).uiFixture.calls.some(
          (c: any) => c.method === "startAgent",
        ),
      ),
    ).toBe(false);
    await page.evaluate(() => {
      (window as any).uiFixture.fail = false;
    });
    await page.getByRole("button", { name: "开始使用" }).click();
    await page.getByTestId("setup-dialog").waitFor({ state: "detached" });
    const result = await page.evaluate(() =>
      (window as any).uiFixture.calls.filter(
        (c: any) => c.method === "settings" || c.method === "startAgent",
      ),
    );
    expect(result.map((c: any) => c.method)).toEqual([
      "settings",
      "settings",
      "startAgent",
    ]);
    expect(result[1].args).toMatchObject({
      instanceId: "fixture-agent",
      packageId: "model",
      values: {
        protocol: "Anthropic Messages",
        model: "demo-model",
        endpoint: "https://example.com/custom",
        mode: 2,
        enabledFlag: false,
      },
      secrets: { apiKey: "fake-form-key" },
    });
    await page.getByTestId("nav-tab-home").click();
    await page
      .getByTestId("agent-card")
      .getByRole("button", { name: "开始使用" })
      .click();
    await page.waitForFunction(() =>
      (window as any).uiFixture.calls.some(
        (c: any) => c.method === "openAgent",
      ),
    );
    expect(await page.getByTestId("setup-dialog").count()).toBe(0);
    await page.getByTestId("nav-tab-home").click();
    await page.getByRole("button", { name: "创建 Agent", exact: true }).click();
    await page.getByLabel("Agent 名称").fill("定制助手");
    await page
      .getByTestId("assembly-dialog")
      .getByRole("button", { name: /^扩展/ })
      .click();
    await page.getByLabel("选择 工作界面 1.0.0").check();
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            'input[aria-label="选择 模型连接器 1.0.0"]',
          ) as HTMLInputElement
        )?.checked,
    );
    expect(await page.getByLabel("选择 模型连接器 1.0.0").isDisabled()).toBe(
      true,
    );
    expect(
      await page.getByLabel("工作界面", { exact: true }).inputValue(),
    ).toBe("workspace");
    await page.getByLabel("Agent 名称").press("Escape");
    await page.getByTestId("assembly-dialog").waitFor({ state: "detached" });
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

async function launchFixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "plums-shell-test-"));
  const fixture = path.join(temporary, "main.cjs");
  await writeFile(
    fixture,
    `const { app, BrowserWindow } = require('electron'); app.setPath('userData', __dirname); app.whenReady().then(() => { new BrowserWindow({ show: process.platform === 'linux', webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } }).loadURL('about:blank'); });`,
  );
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  const application = await electron.launch({
    executablePath: require("electron"),
    args: [fixture],
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(5_000);
  return { application, page, temporary };
}
const rendererUrl = pathToFileURL(
  path.resolve("packages/desktop/dist/renderer/index.html"),
).href;

it("keeps initial loading and failure distinct and rejects outdated Agent and library responses", async () => {
  const { application, page, temporary } = await launchFixture();
  try {
    await page.addInitScript(() => {
      const agents = ["a", "b", "c"].map((instanceId) => ({
        instanceId,
        name: `助手 ${instanceId}`,
        agent: { version: "1.0.0" },
        components: [],
      }));
      const state = {
        fail: true,
        waiting: [] as { id: string; finish: () => void }[],
        calls: [] as string[],
        hold: "",
        started: false,
        library: [] as any[],
        refresh: () => {},
        select: (_id: string) => {},
        releaseInitial: () => {},
      };
      const initial = new Promise<void>((resolve) => {
        state.releaseInitial = resolve;
      });
      (window as any).shellFixture = state;
      (window as any).manager = {
        async call(method: string, args?: any) {
          if (method === "cacheStatus") return [];
          if (method === "agentState") return null;
          if (method === "agentStatus") return "ready";
          if (method === "audit") return [];
          if (method === "tierPlan") return { fingerprint: "local-ui-fixture", selection: { ceiling: "sandbox", projects: [], readOnly: [], components: [] }, current: { revision: 0, tier: { instanceId: "fixture", ceiling: "sandbox", projects: [], readOnly: [], components: [] }, grants: [] }, entries: [], projects: [], readOnly: [] };
          state.calls.push(method);
          if (method === "list") {
            if (!state.started) {
              state.started = true;
              await initial;
            }
            if (state.fail) throw { message: "无法连接运行底座。" };
            return structuredClone(agents);
          }
          if (method === "library") {
            const snapshot = structuredClone(state.library);
            if (state.hold === "library") {
              state.hold = "";
              await new Promise<void>((finish) =>
                state.waiting.push({ id: "library", finish }),
              );
            }
            return snapshot;
          }
          if (method === "desktopSettings") return { dnsMode: "system" };
          if (method === "resources") {
            const record = agents.find((a) => a.instanceId === args.instanceId);
            if (state.hold === args.instanceId) {
              state.hold = "";
              await new Promise<void>((finish) =>
                state.waiting.push({ id: args.instanceId, finish }),
              );
            }
            return { record, packages: [] };
          }
          throw Error(method);
        },
        onWindowState() {
          return () => {};
        },
        onAgentState() {
          return () => {};
        },
        onRefresh(fn: () => void) {
          state.refresh = fn;
          return () => {};
        },
        onSelect(fn: (id: string) => void) {
          state.select = fn;
          return () => {};
        },
        onImport() {
          return () => {};
        },
        filePath() {
          return "fixture.zip";
        },
      };
    });
    await page.goto(rendererUrl);
    await page.getByRole("status").waitFor();
    expect(await page.getByText("还没有 Agent", { exact: true }).count()).toBe(
      0,
    );
    await page.evaluate(() => (window as any).shellFixture.releaseInitial());
    await page.getByRole("heading", { name: "工作台未能加载" }).waitFor();
    expect(await page.getByText("还没有 Agent", { exact: true }).count()).toBe(
      0,
    );
    await page.evaluate(() => {
      (window as any).shellFixture.fail = false;
    });
    await page.getByRole("button", { name: "重新加载" }).click();
    await page.getByTestId("agent-switcher").waitFor();
    await page.getByTestId("nav-tab-extension").click();
    await page.evaluate(() => {
      (window as any).shellFixture.hold = "b";
    });
    await page.getByTestId("agent-switcher").click();
    await page.getByRole("option", { name: "助手 b", exact: true }).click();
    await page.waitForFunction(() =>
      (window as any).shellFixture.waiting.some((w: any) => w.id === "b"),
    );
    await page.getByTestId("agent-switcher").click();
    await page.getByRole("option", { name: "助手 c", exact: true }).click();
    await page.getByRole("button", { name: /管理当前 Agent/ }).waitFor();
    await page.evaluate(() =>
      (window as any).shellFixture.waiting
        .find((w: any) => w.id === "b")
        .finish(),
    );
    await page.waitForFunction(
      () =>
        !(
          document.querySelector(
            '[data-testid="import-file"]',
          ) as HTMLButtonElement
        ).disabled,
    );
    expect(await page.getByTestId("agent-switcher").textContent()).toContain(
      "助手 c",
    );
    expect(
      await page.getByRole("button", { name: /管理当前 Agent/ }).count(),
    ).toBe(1);
    // An older refresh's library snapshot must not replace a newer refresh.
    await page.evaluate(() => {
      const state = (window as any).shellFixture;
      state.hold = "library";
      state.refresh();
    });
    await page.waitForFunction(() =>
      (window as any).shellFixture.waiting.some((w: any) => w.id === "library"),
    );
    await page.evaluate(() => {
      const state = (window as any).shellFixture;
      state.library = [
        {
          digest: "new",
          usedBy: [],
          missingDependencies: [],
          manifest: {
            id: "new",
            kind: "extension",
            name: "新组件",
            version: "1.0.0",
            dependencies: [],
            payload: {},
          },
        },
      ];
      state.refresh();
    });
    await page.getByRole("heading", { name: "新组件" }).waitFor();
    await page.evaluate(() =>
      (window as any).shellFixture.waiting
        .find((w: any) => w.id === "library")
        .finish(),
    );
    await page.waitForFunction(
      () =>
        !(
          document.querySelector(
            '[data-testid="import-file"]',
          ) as HTMLButtonElement
        ).disabled,
    );
    expect(await page.getByRole("heading", { name: "新组件" }).count()).toBe(1);
    await page.evaluate(() => (window as any).shellFixture.select("a"));
    await page.getByRole("heading", { name: "助手 a" }).waitFor();
    expect(
      await page.getByTestId("nav-tab-home").getAttribute("aria-current"),
    ).toBe("page");
  } finally {
    await application.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

it("renders the shell and dialogs in both themes at desktop and narrow widths with visible focus and readable colors", async () => {
  const { application, page, temporary } = await launchFixture();
  const screenshots = path.resolve(".artifacts/visual-v3");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await (
    await import("node:fs/promises")
  ).mkdir(screenshots, { recursive: true });
  try {
    await page.addInitScript(() => {
      const name = "用来验证长名称与多行说明的 Agent · Creative Workspace";
      const kinds = ["character", "extension", "connector"];
      const packages = kinds.map((kind) => ({
        id: kind,
        name: `${kind} 组件名称与边界内容`,
        kind,
        version: "1.0.0",
        enabled: false,
        settings:
          kind === "connector"
            ? {
                schema: {
                  type: "object",
                  properties: {
                    model: {
                      type: "string",
                      title: "模型名称",
                      description:
                        "请填写模型名称。这是一段较长的说明，用来检查窄屏表单的阅读体验。",
                    },
                  },
                  required: ["model"],
                },
                values: {},
                secrets: {},
              }
            : { values: {}, secrets: {} },
        desktop: {
          contributes: {
            commands: [
              {
                name: "inspect",
                title: "检查",
                inputSchema: { type: "object" },
              },
            ],
          },
        },
        manifest: {
          formatVersion: "2.0",
          id: kind,
          kind,
          name: `${kind} 组件名称与边界内容`,
          version: "1.0.0",
          description:
            "多行说明与长内容不会影响操作按钮，组件仍可在公共库与当前 Agent 中管理。",
          dependencies: [],
          permissions: [],
          payload: {},
        },
      }));
      const library = packages.map((p) => ({
        digest: p.id,
        manifest: p.manifest,
        usedBy: [],
        missingDependencies: [],
      }));
      const record = {
        instanceId: "long-agent",
        name,
        agent: { version: "1.0.0" },
        components: packages.map((p) => ({
          packageId: p.id,
          kind: p.kind,
          digest: p.id,
        })),
      };
      (window as any).manager = {
        async call(method: string) {
          if (method === "cacheStatus") return [];
          if (method === "agentState") return null;
          if (method === "agentStatus") return "needs-config";
          if (method === "audit") return [];
          if (method === "tierPlan") return { fingerprint: "local-ui-fixture", selection: { ceiling: "sandbox", projects: [], readOnly: [], components: [] }, current: { revision: 0, tier: { instanceId: "fixture", ceiling: "sandbox", projects: [], readOnly: [], components: [] }, grants: [] }, entries: [], projects: [], readOnly: [] };
          switch (method) {
            case "list":
              return [record];
            case "library":
              return library;
            case "desktopSettings":
              return { dnsMode: "system" };
            case "resources":
              return { record, packages };
            case "chooseImport":
              return {
                token: "test",
                type: "agent",
                agent: { name },
                components: packages.map((p) => ({
                  ...p,
                  permissions: [],
                  code: false,
                })),
              };
            default:
              throw Error(method);
          }
        },
        onWindowState() {
          return () => {};
        },
        onAgentState() {
          return () => {};
        },
        onRefresh() {
          return () => {};
        },
        onSelect() {
          return () => {};
        },
        onImport() {
          return () => {};
        },
        filePath() {
          return "fixture.zip";
        },
      };
    });
    await page.goto(rendererUrl);
    await page.getByTestId("agent-card").waitFor();
    const nav = page.getByRole("navigation", { name: "工作台导航" });
    expect(await nav.getByRole("button").allTextContents()).toEqual([
      "Agent",
      "角色卡",
      "扩展",
      "设置",
    ]);
    const checkLayout = async () => {
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        offenders: Array.from(document.querySelectorAll("body *"))
          .filter(
            (el) =>
              el.getBoundingClientRect().right > innerWidth + 1 &&
              getComputedStyle(el).position !== "absolute",
          )
          .slice(0, 8)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
          })),
      }));
      expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(
        overflow.width,
      );
      expect(
        await page.evaluate(() =>
          Array.from(
            document.querySelectorAll("button, small, p, input, select, pre"),
          )
            .filter((el) => el.getClientRects().length)
            .every((el) => parseFloat(getComputedStyle(el).fontSize) >= 12),
        ),
      ).toBe(true);
    };
    const screenshot = async (options: { path: string }) => {
      await page.evaluate(async () => {
        await Promise.allSettled(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished),
        );
      });
      await page.screenshot(options);
    };
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [1180, 760, 375, 320]) {
        await page.setViewportSize({ width, height: 900 });
        for (const tab of ["home", "character", "extension", "settings"]) {
          await page.getByTestId(`nav-tab-${tab}`).click();
          await checkLayout();
          if (tab === "extension") {
            await page
              .getByRole("button", { name: /管理当前 Agent/ })
              .last()
              .click();
            await checkLayout();
            await page
              .getByRole("button", {
                name: "extension 组件名称与边界内容 的更多操作",
              })
              .click();
            await page
              .getByRole("button", { name: "配置", exact: true })
              .click();
            await page.getByTestId("config-dialog").waitFor();
            await checkLayout();
            await screenshot({
              path: path.join(
                screenshots,
                `${colorScheme}-config-${width}.png`,
              ),
            });
            await page
              .getByRole("button", { name: "取消", exact: true })
              .click();
            await page.getByTestId("nav-tab-extension").click();
            const search = page.getByLabel("搜索公共库");
            await search.fill("不存在的名称");
            await page.getByText("没有匹配的组件。", { exact: true }).waitFor();
            expect(await search.isVisible()).toBe(true);
            await search.fill("");
          }
          await screenshot({
            path: path.join(screenshots, `${colorScheme}-${tab}-${width}.png`),
          });
          if (tab === "home" || tab === "settings") {
            const trigger =
              tab === "home"
                ? page.getByTestId("agent-switcher")
                : page.getByRole("button", { name: "外观主题", exact: true });
            await trigger.click();
            const menu = page.getByRole("listbox");
            await menu.waitFor();
            expect(
              await menu.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= innerWidth;
              }),
            ).toBe(true);
            await checkLayout();
            await screenshot({
              path: path.join(
                screenshots,
                `${colorScheme}-${tab}-menu-${width}.png`,
              ),
            });
            await page.keyboard.press("Escape");
          }
        }
        await page.getByTestId("nav-tab-home").click();
        await screenshot({
          path: path.join(screenshots, `${colorScheme}-home-${width}.png`),
        });
        await page.getByTestId("import-file").click();
        const importing = page.getByTestId("import-dialog");
        await importing.waitFor();
        await checkLayout();
        expect(
          await page.locator(".top-shell").evaluate((el) => el.inert),
        ).toBe(true);
        await screenshot({
          path: path.join(screenshots, `${colorScheme}-import-${width}.png`),
        });
        await importing.getByRole("button", { name: "导入并配置" }).focus();
        await page.keyboard.press("Tab");
        expect(
          await importing
            .getByRole("button", { name: "关闭弹窗" })
            .evaluate((el) => el === document.activeElement),
        ).toBe(true);
        await page.keyboard.press("Shift+Tab");
        expect(
          await importing
            .getByRole("button", { name: "导入并配置" })
            .evaluate((el) => el === document.activeElement),
        ).toBe(true);
        await importing.getByRole("button", { name: "取消" }).focus();
        await page.keyboard.press("Shift+Tab");
        expect(
          await importing.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await importing.waitFor({ state: "detached" });
        expect(
          await page
            .getByTestId("import-file")
            .evaluate((el) => el === document.activeElement),
        ).toBe(true);
        await page
          .getByTestId("agent-card")
          .getByRole("button", { name: "去配置" })
          .click();
        const setup = page.getByTestId("setup-dialog");
        await setup.waitFor();
        await checkLayout();
        await page.getByLabel("模型名称", { exact: true }).fill("Test Model");
        await screenshot({
          path: path.join(screenshots, `${colorScheme}-setup-${width}.png`),
        });
        await setup.getByRole("button", { name: "开始使用" }).focus();
        await page.keyboard.press("Tab");
        expect(
          await setup.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
        expect(
          await setup
            .getByRole("button", { name: "开始使用" })
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.bottom <= innerHeight && r.top >= 0;
            }),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await page.getByTestId("nav-tab-home").click();
        await page.getByTestId("agent-card").click();
        await screenshot({
          path: path.join(screenshots, `${colorScheme}-detail-${width}.png`),
        });
        await page.getByRole("button", { name: "编辑组合" }).click();
        const assembly = page.getByTestId("assembly-dialog");
        await assembly.waitFor();
        await checkLayout();
        await screenshot({
          path: path.join(screenshots, `${colorScheme}-assembly-${width}.png`),
        });
        expect(
          await assembly
            .getByRole("button", { name: "关闭", exact: true })
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.bottom <= innerHeight && r.top >= 0;
            }),
        ).toBe(true);
        await page.keyboard.press("Escape");
        await page.getByTestId("nav-tab-home").click();
      }
      // Measure colors from the rendered shell and controls, including focus.
      await page.getByTestId("import-file").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const contrasts = await page.evaluate(() => {
        const rgb = (value: string) =>
          value
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(
              (channel) => Number(channel) * (value.includes("srgb") ? 255 : 1),
            );
        const luminance = (value: string) =>
          rgb(value)
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
        const ratio = (a: string, b: string) => {
          const x = luminance(a),
            y = luminance(b);
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        const style = (selector: string) =>
          getComputedStyle(document.querySelector(selector)!);
        const focused = style('[data-testid="import-file"]'),
          primary = style('[data-testid="agent-card"] button.cta'),
          nav = style('[data-testid="nav-tab-home"]'),
          body = style("html"),
          muted = style(".local-hint");
        const colors = (foreground: string, background: string) => {
          const probe = document.createElement("span");
          probe.style.color = `var(${foreground})`;
          probe.style.backgroundColor = `var(${background})`;
          document.body.append(probe);
          const computed = getComputedStyle(probe),
            color = computed.color,
            bg = computed.backgroundColor;
          const alpha = Number(bg.match(/[\d.]+/g)!.at(3) ?? 1),
            behind = rgb(body.backgroundColor),
            channels = rgb(bg).map(
              (v, i) => v * alpha + behind[i]! * (1 - alpha),
            );
          probe.remove();
          return ratio(color, `rgb(${channels.join(",")})`);
        };
        const semantics = Object.fromEntries(
          ["peach", "mint", "sky", "attention", "berry"].map((kind) => [
            kind,
            colors(`--${kind}-text`, `--${kind}-bg`),
          ]),
        );
        return {
          semantics,
          rendered: {
            focusShadow: focused.boxShadow,
            topBackground: style(".top-shell").backgroundColor,
            focusMatches: document
              .querySelector('[data-testid="import-file"]')!
              .matches(":focus-visible"),
          },
          secondary: colors("--text-2", "--bg-surface"),
          tertiary: colors("--text-3", "--bg-surface"),
          primary: ratio(primary.color, primary.backgroundColor),
          selected: colors("--accent-soft-text", "--accent-soft"),
          tertiaryRaised: colors("--text-3", "--bg-raised"),
          tertiaryHover: colors("--text-3", "--bg-hover"),
          muted: ratio(muted.color, body.backgroundColor),
          focus: ratio(
            focused.boxShadow.match(/rgba?\([^)]*\)/g)!.at(-1)!,
            style(".top-shell").backgroundColor,
          ),
          control: ratio(
            primary.borderTopColor,
            style(".top-shell").backgroundColor,
          ),
        };
      });
      await writeFile(
        path.join(screenshots, `${colorScheme}-contrast.json`),
        JSON.stringify(contrasts, null, 2),
      );
      for (const value of Object.values(contrasts.semantics))
        expect(value).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.secondary).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.tertiary).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.tertiaryRaised).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.tertiaryHover).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.primary).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.selected).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.muted).toBeGreaterThanOrEqual(4.5);
      expect(contrasts.focus).toBeGreaterThanOrEqual(3);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("import-file").hover();
    expect(
      await page.getByTestId("import-file").evaluate((el) => ({
        transform: getComputedStyle(el).transform,
        transition: getComputedStyle(el).transitionDuration,
      })),
    ).toEqual({ transform: "none", transition: "0s" });
    await page.getByTestId("nav-tab-settings").click();
    expect(
      await page
        .getByRole("switch", { name: "开发者模式" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    await page.getByRole("switch", { name: "开发者模式" }).click();
    await page.getByTestId("nav-tab-extension").click();
    await page.getByRole("button", { name: /管理当前 Agent/ }).click();
    await page
      .getByTestId("component-row")
      .filter({ hasText: "extension 组件名称与边界内容" })
      .getByText("开发者信息与调用", { exact: true })
      .click();
    await page.getByRole("button", { name: "检查", exact: true }).click();
    const invocation = page.getByRole("dialog", { name: "检查", exact: true });
    await invocation.getByLabel("调用参数").fill("{");
    await invocation.getByRole("button", { name: "运行", exact: true }).click();
    await invocation.getByRole("alert").waitFor();
    expect(await invocation.getByLabel("调用参数").inputValue()).toBe("{");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "extension 组件名称与边界内容 的更多操作" })
      .click();
    await page
      .getByRole("button", { name: "从 Agent 移出", exact: true })
      .click();
    const removing = page.getByTestId("delete-dialog");
    await removing.waitFor();
    expect(
      await removing
        .getByRole("button", { name: "取消", exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await removing.waitFor({ state: "detached" });
    await page.getByTestId("nav-tab-settings").click();
    await page.getByRole("switch", { name: "开发者模式" }).click();
    await page.getByTestId("nav-tab-extension").click();
    expect(
      await page.getByText("开发者信息与调用", { exact: true }).count(),
    ).toBe(0);
    await page.getByTestId("nav-tab-home").click();
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    await page.getByTestId("nav-tab-settings").focus();
    expect(
      await page.getByTestId("nav-tab-settings").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.right <= innerWidth;
      }),
    ).toBe(true);
  } finally {
    await application.close();
    await rm(temporary, { recursive: true, force: true });
  }
}, 60_000);

it("integrates native window chrome, fullscreen events and theme updates", async () => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "plums-native-theme-"),
  );
  // Stage the same external native dependencies as desktop packaging, without
  // rebuilding a DMG or accessing a user's profile.
  await cp(
    path.resolve("packages/desktop/dist"),
    path.join(temporary, "dist"),
    { recursive: true },
  );
  await writeFile(
    path.join(temporary, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  await mkdir(path.join(temporary, "node_modules"));
  for (const [name, owner] of [
    ["better-sqlite3", "core"],
    ["isolated-vm", "host"],
  ]) {
    const dependency = createRequire(
      path.resolve(`packages/${owner}/package.json`),
    );
    await symlink(
      path.dirname(dependency.resolve(`${name}/package.json`)),
      path.join(temporary, "node_modules", name!),
    );
  }
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  const profile = path.join(temporary, "profile");
  await mkdir(profile);
  await writeFile(
    path.join(profile, "desktop.json"),
    JSON.stringify({ dnsMode: "system", theme: "dark" }),
  );
  const launch = () =>
    electron.launch({
      executablePath: require("electron"),
      args: [path.join(temporary, "dist/main.js")],
      env: {
        ...process.env,
        PLUMS_NODE: process.execPath,
        PLUMS_DATA_DIR: profile,
      },
      timeout: 10_000,
    });
  let application = await launch();
  try {
    const page = await application.firstWindow();
    page.setDefaultTimeout(5_000);
    await page.emulateMedia({ colorScheme: null });
    await page.getByTestId("nav-tab-home").waitFor();
    expect(
      await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
    ).toBe("dark");
    await page.waitForFunction(
      () =>
        getComputedStyle(document.documentElement).backgroundColor ===
        "rgb(20, 19, 17)",
    );
    for (const method of [
      "chooseUpdate",
      "chooseComponent",
      "setCharacter",
      "stop",
    ]) {
      const code = await page.evaluate(async (method) => {
        try {
          await window.manager.call(method);
          return "ACCEPTED";
        } catch (error) {
          return (error as { code: string }).code;
        }
      }, method);
      expect(code).toBe("DESKTOP_FAILED");
    }
    const chrome = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      return {
        frame: window.getBounds(),
        content: window.getContentBounds(),
        buttons:
          typeof window.getWindowButtonPosition === "function"
            ? window.getWindowButtonPosition()
            : undefined,
      };
    });
    if (process.platform === "darwin") {
      expect(chrome.content.y).toBe(chrome.frame.y);
      expect(chrome.buttons).toEqual({ x: 20, y: 21 });
    }
    expect(
      await page
        .locator(".top-shell")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("-webkit-app-region"),
        ),
    ).toBe("drag");
    expect(
      await page
        .getByTestId("import-file")
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue("-webkit-app-region"),
        ),
    ).toBe("no-drag");
    await page.evaluate(() => {
      document.querySelector("main")!.style.minHeight = "2000px";
      window.scrollTo(0, 100);
    });
    await expect
      .poll(() =>
        page
          .locator(".top-shell")
          .evaluate((el) => el.classList.contains("scrolled")),
      )
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() =>
        page
          .locator(".top-shell")
          .evaluate((el) => el.classList.contains("scrolled")),
      )
      .toBe(false);
    await page.evaluate(() =>
      document.querySelector("main")!.style.removeProperty("min-height"),
    );
    if (process.platform === "darwin") {
      for (const fullscreen of [true, false]) {
        await application.evaluate(({ app, BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          window.show();
          window.focus();
          app.focus({ steal: true });
        });
        await expect
          .poll(
            () =>
              application.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0]!.isFocused(),
              ),
            { timeout: 5_000 },
          )
          .toBe(true);
        await application.evaluate(async ({ app, BrowserWindow }, value) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          window.show();
          window.focus();
          app.focus({ steal: true });
          await new Promise<void>((resolve, reject) => {
            if (window.isFullScreen() === value) {
              resolve();
              return;
            }
            const timer = setTimeout(
              () =>
                reject(
                  Error(
                    `Fullscreen event missing: ${value}, actual=${window.isFullScreen()}, visible=${window.isVisible()}, focus=${window.isFocused()}`,
                  ),
                ),
              5_000,
            );
            window.once(
              value ? "enter-full-screen" : "leave-full-screen",
              () => {
                clearTimeout(timer);
                resolve();
              },
            );
            window.setFullScreen(value);
          });
        }, fullscreen);
        await page.waitForFunction(
          (value) =>
            document.documentElement.hasAttribute("data-fullscreen") === value,
          fullscreen,
        );
        expect(
          await page
            .locator(".top-shell-inner")
            .evaluate((el) => getComputedStyle(el).paddingLeft),
        ).toBe(fullscreen ? "20px" : "88px");
      }
    }
    for (const source of ["dark", "light"] as const) {
      await application.evaluate(({ nativeTheme }, value) => {
        nativeTheme.themeSource = value;
      }, source);
      await page.waitForFunction(
        (dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark,
        source === "dark",
      );
      const expected = source === "dark" ? "#141311" : "#f7f6f3";
      await expect
        .poll(async () =>
          application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]!
              .getBackgroundColor()
              .toLowerCase(),
          ),
        )
        .toBe(expected);
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).backgroundColor,
        ),
      ).toBe(source === "dark" ? "rgb(20, 19, 17)" : "rgb(247, 246, 243)");
    }
    await page.getByTestId("nav-tab-settings").click();
    const theme = page.getByRole("button", { name: "外观主题", exact: true });
    for (const [source, label] of [
      ["light", "浅色"],
      ["dark", "深色"],
      ["system", "跟随系统"],
    ] as const) {
      await theme.click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await expect
        .poll(() =>
          application.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
        )
        .toBe(source);
      await expect.poll(() => theme.textContent()).toContain(label);
      const settings = JSON.parse(
        await readFile(path.join(profile, "desktop.json"), "utf8"),
      );
      expect(settings).toEqual({ dnsMode: "system", theme: source });
      const dark = await application.evaluate(
        ({ nativeTheme }) => nativeTheme.shouldUseDarkColors,
      );
      await page.waitForFunction(
        (dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark,
        dark,
      );
      expect(
        await page.evaluate(
          () => getComputedStyle(document.documentElement).colorScheme,
        ),
      ).toBe(dark ? "dark" : "light");
    }
    await theme.click();
    await page.getByRole("option", { name: "深色", exact: true }).click();
    await expect.poll(() => theme.textContent()).toContain("深色");
    await application.close();
    application = await launch();
    const reopened = await application.firstWindow();
    await reopened.getByTestId("nav-tab-settings").click();
    expect(
      await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource),
    ).toBe("dark");
    await expect
      .poll(() =>
        reopened
          .getByRole("button", { name: "外观主题", exact: true })
          .textContent(),
      )
      .toContain("深色");
  } finally {
    await application.close();
    await rm(temporary, { recursive: true, force: true });
  }
}, 45_000);
