import { it, expect } from "vitest";
import { _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function protocolUiFixture(single = false) {
  const f = await fixture();
  await f.page.evaluate((single) => {
    const state = (window as any).interaction;
    const requires = [
      {
        id: "store",
        protocol: "org.example.store",
        range: "^1.0.0",
        features: ["read", "write"],
      },
      {
        id: "optional",
        protocol: "org.example.optional",
        range: "^1.0.0",
        optional: true,
      },
    ];
    for (const packages of Object.values(state.packages) as any[][])
      packages[0].desktop.protocols = { requires };
    state.library[0].manifest.payload.plumsDesktop.protocols = { requires };
    const choices = Object.fromEntries(["a", "b"].map((id) => [id, []]));
    state.protocols = {
      choices,
      fail: false,
      revision: 0,
      single,
      autoBound: false,
    };
    if (!single) {
      const alternative = structuredClone(
        state.library.find((p: any) => p.digest === "beta"),
      );
      alternative.digest = "alternative";
      alternative.manifest.id = "alternative";
      alternative.manifest.name = "记忆乙";
      state.library.push(alternative);
    }
    const candidates = [
      {
        name: "记忆甲",
        enabled: true,
        compatibility: { compatible: true },
        intent: {
          consumerId: "alpha",
          consumerDigest: "alpha",
          requirementId: "store",
          providerId: "beta",
          providerDigest: "beta",
          provideId: "store",
          protocolVersion: "1.0.0",
          contribution: { kind: "tools", name: "store" },
        },
      },
      {
        name: "记忆乙",
        enabled: true,
        compatibility: { compatible: true },
        intent: {
          consumerId: "alpha",
          consumerDigest: "alpha",
          requirementId: "store",
          providerId: "alternative",
          providerDigest: "alternative",
          provideId: "store",
          protocolVersion: "1.2.0",
          contribution: { kind: "tools", name: "store" },
        },
      },
      {
        name: "旧记忆",
        enabled: true,
        compatibility: {
          compatible: false,
          reason: "FEATURES_MISSING",
          missingFeatures: ["write"],
        },
        intent: {
          consumerId: "alpha",
          consumerDigest: "alpha",
          requirementId: "store",
          providerId: "limited",
          providerDigest: "limited",
          provideId: "store",
          protocolVersion: "1.0.0",
          contribution: { kind: "tools", name: "store" },
        },
      },
      {
        name: "新版记忆",
        enabled: true,
        compatibility: { compatible: false, reason: "VERSION_MISMATCH" },
        intent: {
          consumerId: "alpha",
          consumerDigest: "alpha",
          requirementId: "store",
          providerId: "v2",
          providerDigest: "v2",
          provideId: "store",
          protocolVersion: "2.0.0",
          contribution: { kind: "tools", name: "store" },
        },
      },
    ];
    const requirements = (id: string) =>
      requires.map((r) => ({
        consumerId: "alpha",
        consumerName: "工具甲",
        requirement: r,
        candidates: r.id === "store" ? candidates : [],
        state: choices[id]?.find((b: any) => b.requirementId === r.id)
          ? "bound"
          : r.id === "store"
            ? "choose"
            : "missing",
        selected: choices[id]?.find((b: any) => b.requirementId === r.id),
        ...(state.protocols.autoBound &&
        choices[id]?.some((b: any) => b.requirementId === r.id)
          ? { autoBound: true }
          : {}),
      }));
    const original = (window as any).manager.call;
    (window as any).manager.call = async (method: string, args: any = {}) => {
      if (method === "protocolPlan")
        return {
          fingerprint: `${args.instanceId}:${state.protocols.revision}`,
          requirements: structuredClone(requirements(args.instanceId)),
        };
      if (method === "setProtocolBinding") {
        state.calls.push({ method, args });
        if (state.protocols.fail) throw { message: "连接未保存，请重新选择" };
        choices[args.instanceId] = args.choice ? [args.choice] : [];
        state.protocols.autoBound = false;
        state.protocols.revision++;
        return null;
      }
      if (method === "planAssembly")
        return {
          digests: args.digests,
          additions: [],
          protocols: args.digests.includes("alpha")
            ? requirements("draft").map((r) => ({
                ...r,
                candidates: r.candidates.filter((c: any) =>
                  args.digests.includes(c.intent.providerDigest),
                ),
                state:
                  args.digests.filter((d: string) =>
                    r.candidates.some(
                      (c: any) =>
                        c.compatibility.compatible &&
                        c.intent.providerDigest === d,
                    ),
                  ).length === 1
                    ? "unbound"
                    : r.state,
              }))
            : [],
        };
      return original(method, args);
    };
    state.refresh();
  }, single);
  return f;
}

it("chooses protocol providers, explains conflicts, retains failed saves and isolates Agent selections", async () => {
  const f = await protocolUiFixture(),
    { page } = f;
  try {
    await page.getByTestId("agent-card").filter({ hasText: "助手 a" }).click();
    const panel = page.getByRole("region", { name: "组件连接" });
    const select = panel.getByLabel("工具甲 的 store");
    await select.waitFor();
    expect(await select.inputValue()).toBe("");
    expect(
      await panel.getByText("旧记忆：缺少功能 write", { exact: true }).count(),
    ).toBe(1);
    expect(
      await select
        .locator("option")
        .filter({ hasText: "新版记忆" })
        .getAttribute("disabled"),
    ).not.toBeNull();
    expect(
      await panel
        .getByText("未连接；此可选功能暂不可用", { exact: true })
        .count(),
    ).toBe(1);
    await page.evaluate(
      () => ((window as any).interaction.protocols.fail = true),
    );
    await select.selectOption({ label: "记忆甲 · 协议 1.0.0 · store" });
    await panel.getByText("连接未保存，请重新选择", { exact: true }).waitFor();
    expect(await select.inputValue()).toBe("");
    await page.evaluate(
      () => ((window as any).interaction.protocols.fail = false),
    );
    await select.selectOption({ label: "记忆乙 · 协议 1.2.0 · store" });
    await panel.getByText("已连接", { exact: true }).waitFor();
    expect(await select.inputValue()).toContain("alternative");
    const artifact = path.resolve(".artifacts/extension-composition/phase2-ui");
    await mkdir(artifact, { recursive: true });
    for (const colorScheme of ["light", "dark"] as const)
      for (const width of [1180, 760, 375, 320]) {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height: 850 });
        expect(
          await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        const contrast = await panel.evaluate((root) => {
          const luminance = (color: string) => {
            const rgb = color
              .match(/[\d.]+/g)!
              .slice(0, 3)
              .map(Number)
              .map((n) => {
                const c = n / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
          };
          const background = luminance(getComputedStyle(root).backgroundColor);
          return Math.min(
            ...[...root.querySelectorAll("small,p,strong")].map((el) => {
              const foreground = luminance(getComputedStyle(el).color);
              return (
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05)
              );
            }),
          );
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        expect(
          await select.evaluate((el) => el.getBoundingClientRect().height),
        ).toBeGreaterThanOrEqual(24);
        await page.screenshot({
          path: path.join(artifact, `${colorScheme}-${width}.png`),
        });
      }
    await page.getByTestId("agent-switcher").click();
    await page.getByRole("option", { name: "助手 b" }).click();
    await page.getByLabel("工具甲 的 store").waitFor();
    expect(await page.getByLabel("工具甲 的 store").inputValue()).toBe("");
    expect(
      await page.evaluate(
        () => (window as any).interaction.protocols.choices.a[0].providerId,
      ),
    ).toBe("alternative");
  } finally {
    await f.close();
  }
});

it("collects required protocol choices in a new assembly before creation", async () => {
  const f = await protocolUiFixture(),
    { page } = f;
  try {
    await page.getByRole("button", { name: "创建 Agent", exact: true }).click();
    const dialog = page.getByTestId("assembly-dialog"),
      create = dialog.getByRole("button", { name: "创建 Agent", exact: true });
    await dialog.getByLabel("Agent 名称", { exact: true }).fill("协议组合");
    await dialog
      .getByRole("button", { name: "扩展", exact: false })
      .first()
      .click();
    await dialog.getByLabel("选择 工具甲 1.0.0").check();
    await dialog.getByLabel("选择 工具乙 1.0.0").check();
    await dialog.getByLabel("选择 记忆乙 1.0.0").check();
    const select = dialog.getByLabel("工具甲 的 store");
    await select.waitFor();
    expect(await create.isDisabled()).toBe(true);
    await select.selectOption({ label: "记忆甲 · 协议 1.0.0 · store" });
    await dialog.getByText("已选择，创建后启用", { exact: true }).waitFor();
    expect(await create.isEnabled()).toBe(true);
    await create.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).interaction.calls.filter(
              (c: any) => c.method === "createAgent",
            ).length,
        ),
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.find(
            (c: any) => c.method === "createAgent",
          ).args.protocolBindings[0].providerId,
      ),
    ).toBe("beta");
  } finally {
    await f.close();
  }
});

it("creates with a single protocol candidate and shows an automatic connection that can be replaced", async () => {
  const f = await protocolUiFixture(true),
    { page } = f;
  try {
    await page.getByRole("button", { name: "创建 Agent", exact: true }).click();
    const dialog = page.getByTestId("assembly-dialog");
    await dialog.getByLabel("Agent 名称", { exact: true }).fill("自动连接组合");
    await dialog
      .getByRole("button", { name: "扩展", exact: false })
      .first()
      .click();
    await dialog.getByLabel("选择 工具甲 1.0.0").check();
    await dialog.getByLabel("选择 工具乙 1.0.0").check();
    await dialog
      .getByText("创建后将自动连接 工具甲 的 store → 记忆甲", { exact: true })
      .waitFor();
    expect(
      await dialog
        .getByRole("button", { name: "创建 Agent", exact: true })
        .isEnabled(),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "创建 Agent", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).interaction.calls.find(
              (c: any) => c.method === "createAgent",
            )?.args.protocolBindings,
        ),
      )
      .toEqual([]);
    await page
      .getByTestId("setup-dialog")
      .getByRole("button", { name: "稍后配置", exact: true })
      .click();
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.protocols.choices.a = [
        {
          consumerId: "alpha",
          requirementId: "store",
          providerId: "beta",
          providerDigest: "beta",
          provideId: "store",
        },
      ];
      s.protocols.autoBound = true;
      s.refresh();
    });
    await page.getByTestId("agent-switcher").click();
    await page.getByRole("option", { name: "助手 a" }).click();
    const panel = page.getByRole("region", { name: "组件连接" });
    await panel
      .getByText("已自动连接 工具甲 的 store → 记忆甲", { exact: true })
      .waitFor();
    const artifact = path.resolve(".artifacts/requirements-v1/r10-ui");
    await mkdir(artifact, { recursive: true });
    await panel.screenshot({ path: path.join(artifact, "automatic-1180.png") });
    const select = panel.getByLabel("工具甲 的 store");
    await panel
      .getByRole("button", {
        name: "工具甲 更换 store 的提供组件",
        exact: true,
      })
      .click();
    expect(await select.evaluate((el) => document.activeElement === el)).toBe(
      true,
    );
    await select.selectOption({ label: "记忆乙 · 协议 1.2.0 · store" });
    await panel.getByText("已连接", { exact: true }).waitFor();
    expect(await panel.getByText("已自动连接", { exact: false }).count()).toBe(
      0,
    );
    for (const width of [1180, 760, 375, 320]) {
      await page.setViewportSize({ width, height: 850 });
      expect(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await panel.screenshot({
        path: path.join(artifact, `replacement-${width}.png`),
      });
    }
  } finally {
    await f.close();
  }
});

it("views complete component JSON, edits payloads, resolves external conflicts and locates working copies", async () => {
  const f = await fixture(),
    { page } = f;
  try {
    await page.getByTestId("nav-tab-extension").click();
    expect(
      await page
        .getByRole("button", { name: "查看 / 编辑内容", exact: true })
        .count(),
    ).toBe(0);
    await page.getByTestId("nav-tab-settings").click();
    await page.getByRole("switch", { name: "开发者模式" }).click();
    await page.getByTestId("nav-tab-extension").click();
    const opener = page
      .getByRole("button", { name: "查看 / 编辑内容", exact: true })
      .first();
    await opener.click();
    const dialog = page.getByTestId("component-content-dialog");
    const manifest = dialog.getByLabel("完整 Manifest JSON"),
      payload = dialog.getByLabel("完整 Payload JSON");
    await expect.poll(() => manifest.inputValue()).toContain("全文结尾标记");
    expect(await manifest.getAttribute("readonly")).not.toBeNull();
    expect(JSON.parse(await manifest.inputValue()).opaqueFuture).toEqual({
      preserved: [1, 2, 3],
    });
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls.filter(
            (x: any) => x.method === "openComponentDraft",
          ).length,
      ),
    ).toBe(0);
    await dialog.getByText("组件标识与摘要", { exact: true }).click();
    await dialog.getByText("SHA-256", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    await expect
      .poll(async () => JSON.parse(await manifest.inputValue()).version)
      .toBe("1.0.1");
    await dialog.getByRole("tab", { name: "Payload", exact: true }).click();
    const edited = {
      ...JSON.parse(await payload.inputValue()),
      description: "修改后的正文",
      unknown: [1, 2],
    };
    await payload.fill(JSON.stringify(edited));
    await dialog.getByRole("button", { name: "校验", exact: true }).click();
    await dialog
      .getByText("包格式、声明、入口和组合校验通过。保存时会重新校验。", {
        exact: true,
      })
      .waitFor();
    edited.description = "校验后继续编辑的正文";
    await payload.fill(JSON.stringify(edited));
    await dialog.getByRole("button", { name: "格式化", exact: true }).click();
    await dialog.getByRole("tab", { name: "Manifest", exact: true }).click();
    expect(JSON.parse(await manifest.inputValue()).payload).toEqual(edited);
    const valid = await manifest.inputValue();
    await manifest.fill("{");
    await dialog.getByRole("button", { name: "校验", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    expect(await manifest.inputValue()).toBe("{");
    await manifest.fill(valid);
    await dialog.getByRole("tab", { name: "文件目录", exact: true }).click();
    await dialog
      .getByRole("button", { name: "在 Finder 中显示 nested/deeper/main.js" })
      .click();
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.calls
            .filter((x: any) => x.method === "revealComponentDraft")
            .at(-1).args,
      ),
    ).toEqual({ token: "draft-token", relative: "nested/deeper/main.js" });
    await dialog.getByRole("tab", { name: "Payload", exact: true }).click();
    await payload.fill(
      JSON.stringify({ ...edited, description: "本地未保存内容" }),
    );
    await page.evaluate(() => {
      const state = (window as any).interaction.content;
      const m = JSON.parse(state.disk);
      m.payload.description = "外部内容";
      state.disk = JSON.stringify(m);
      state.revision++;
    });
    await dialog.getByRole("button", { name: "重新读取", exact: true }).click();
    await dialog
      .getByRole("button", { name: "采用外部文件", exact: true })
      .waitFor();
    expect(await dialog.getByLabel("本地 JSON").inputValue()).toContain(
      "本地未保存内容",
    );
    expect(await dialog.getByLabel("外部 Manifest").inputValue()).toContain(
      "外部内容",
    );
    await dialog
      .getByRole("button", { name: "采用外部文件", exact: true })
      .click();
    expect(JSON.parse(await payload.inputValue()).description).toBe("外部内容");
    const artifactDir = path.resolve(".artifacts/component-content-ui");
    await mkdir(artifactDir, { recursive: true });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const width of [1180, 760, 375]) {
        await page.setViewportSize({ width, height: 850 });
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        await page.screenshot({
          path: path.join(artifactDir, `${colorScheme}-${width}.png`),
        });
      }
    }
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "保存为新版本", exact: true })
      .click();
    await dialog.getByText("新版本已保存到公共库。", { exact: true }).waitFor();
    expect(
      await page.evaluate(
        () =>
          (window as any).interaction.content.snapshots.at(-1).payload
            .description,
      ),
    ).toBe("外部内容");
    await dialog
      .getByRole("button", { name: "删除工作副本并关闭", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    expect(await opener.evaluate((el) => el === document.activeElement)).toBe(
      true,
    );
  } finally {
    await f.close();
  }
});

it("retains invalid draft input, restores conflicts, and keeps cancelled or failed Agent updates reviewable", async () => {
  const f = await fixture(),
    { page } = f;
  try {
    await page.getByTestId("nav-tab-settings").click();
    await page.getByRole("switch", { name: "开发者模式" }).click();
    await page.getByTestId("nav-tab-extension").click();
    await page.getByRole("button", { name: /管理当前 Agent/ }).click();
    await page
      .getByTestId("component-row")
      .filter({ hasText: "工具甲" })
      .getByRole("button", { name: "查看 / 编辑内容", exact: true })
      .click();
    let dialog = page.getByTestId("component-content-dialog");
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    await dialog.getByRole("tab", { name: "Payload", exact: true }).click();
    await dialog.getByLabel("完整 Payload JSON").fill("{invalid");
    await page.keyboard.press("Escape");
    await dialog
      .getByRole("button", { name: "保留草稿并关闭", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    await page.evaluate(() => {
      const state = (window as any).interaction.content,
        m = JSON.parse(state.disk);
      m.version = "1.0.1";
      m.payload.extra = "外部修改";
      state.disk = JSON.stringify(m);
      state.revision++;
    });
    await page
      .getByTestId("component-row")
      .filter({ hasText: "工具甲" })
      .getByRole("button", { name: "查看 / 编辑内容", exact: true })
      .click();
    dialog = page.getByTestId("component-content-dialog");
    await dialog.getByRole("button", { name: "编辑", exact: true }).click();
    await dialog
      .getByRole("button", { name: "采用外部文件", exact: true })
      .waitFor();
    expect(await dialog.getByLabel("本地 JSON").inputValue()).toBe("{invalid");
    await dialog
      .getByRole("button", { name: "采用外部文件", exact: true })
      .click();
    await page.evaluate(
      () => ((window as any).interaction.content.cancelled = true),
    );
    await dialog
      .getByRole("button", { name: "保存并更新当前 Agent", exact: true })
      .click();
    await dialog
      .getByText("已取消更新，草稿已保留。", { exact: true })
      .waitFor();
    await page.evaluate(() => {
      const s = (window as any).interaction.content;
      s.cancelled = false;
      s.failApply = true;
    });
    await dialog
      .getByRole("button", { name: "保存并更新当前 Agent", exact: true })
      .click();
    await dialog.getByRole("alert").waitFor();
    expect(await dialog.getByRole("alert").textContent()).toContain(
      "/settings/note",
    );
    await dialog
      .getByText("新版本已入公共库，当前 Agent 更新未完成，可重试更新。", {
        exact: true,
      })
      .waitFor();
    expect(
      await page.evaluate(() => (window as any).interaction.content.source),
    ).toEqual({ kind: "agent", instanceId: "a", packageId: "alpha" });
    await page.evaluate(
      () => ((window as any).interaction.content.failApply = false),
    );
    await dialog
      .getByRole("button", { name: "保存并更新当前 Agent", exact: true })
      .click();
    await dialog
      .getByText("新版本已入公共库并应用到当前 Agent。", { exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "删除工作副本并关闭", exact: true })
      .click();
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
      theme: "system",
      failTheme: false,
      content: {
        view: undefined as any,
        editor: undefined as any,
        revision: 0,
        disk: "",
        source: undefined as any,
        cancelled: false,
        failApply: false,
        snapshots: [] as any[],
      },
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
          case "foundationManagement":
            return { catalog: [], agents: [], catalogFailure: false };
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
          case "inspectComponent": {
            const p =
              args.source.kind === "library"
                ? state.library.find((p) => p.digest === args.source.digest)!
                    .manifest
                : state.packages[args.source.instanceId as "a" | "b"].find(
                    (p) => p.id === args.source.packageId,
                  )!.manifest;
            const m = {
              ...p,
              opaqueFuture: { preserved: [1, 2, 3] },
              payload: {
                ...p.payload,
                long: "完整正文".repeat(2500) + "全文结尾标记",
                nested: { unknown: true },
              },
            };
            return {
              source: args.source,
              baseDigest: "component-sha256",
              suggestedVersion: "1.0.1",
              manifestText: JSON.stringify(m),
              files: [
                { path: "manifest.json", size: 12000 },
                { path: "nested/deeper/main.js", size: 640 },
                { path: "source/card.png", size: 128 },
              ],
            };
          }
          case "openComponentDraft": {
            if (!state.content.view) {
              const view = await (window as any).manager.call(
                "inspectComponent",
                args,
              );
              state.content.view = {
                ...view,
                token: "draft-token",
                revision: "revision-0",
              };
              state.content.disk = view.manifestText;
              state.content.source = args.source;
            }
            return {
              ...structuredClone(state.content.view),
              manifestText: state.content.disk,
              revision: `revision-${state.content.revision}`,
              editor: state.content.editor,
            };
          }
          case "retainComponentDraft":
            state.content.editor = structuredClone(args.editor);
            return null;
          case "writeComponentDraft": {
            if (args.revision !== `revision-${state.content.revision}`)
              throw {
                message: "外部文件已变化",
                details: { reason: "DRAFT_CONFLICT" },
              };
            state.content.disk = args.text;
            state.content.revision++;
            return {
              ...structuredClone(state.content.view),
              manifestText: args.text,
              revision: `revision-${state.content.revision}`,
            };
          }
          case "readComponentDraft":
            return {
              ...structuredClone(state.content.view),
              manifestText: state.content.disk,
              revision: `revision-${state.content.revision}`,
              editor: state.content.editor,
            };
          case "revealComponentDraft":
            return null;
          case "discardComponentDraft":
            state.content.view = undefined;
            state.content.editor = undefined;
            return null;
          case "validateComponentDraft": {
            const m = JSON.parse(state.content.disk);
            if (m.version === "1.0.0")
              throw { message: "新版本必须高于基版", path: "/version" };
            state.content.snapshots.push(m);
            return {
              validationToken: "snapshot",
              manifest: m,
              source: state.content.source,
            };
          }
          case "saveComponentDraft": {
            if (state.content.cancelled)
              return { cancelled: true, librarySaved: false, applied: false };
            if (state.content.failApply)
              return {
                librarySaved: true,
                applied: false,
                error: { message: "已有配置不兼容", path: "/settings/note" },
              };
            return {
              librarySaved: true,
              applied: state.content.source.kind === "agent",
            };
          }
          case "desktopSettings":
            return { dnsMode: state.dnsMode, theme: state.theme };
          case "setDesktopTheme":
            if (state.failTheme) throw { message: "外观未保存" };
            state.theme = args.theme;
            return null;
          case "setDesktopSettings":
            state.dnsMode = args.dnsMode;
            return null;
          case "audit":
            return [];
          case "workspacePlan":
            return {
              componentId: record.agent.startup ?? null,
              fingerprint: "workspace-fixture",
              layout: null,
              diagnostics: [],
              frontends: resources
                .filter((p) => p.desktop?.frontend)
                .map((p) => ({
                  componentId: p.id,
                  name: p.name,
                  digest: p.id,
                  enabled: p.enabled,
                  requirements: [],
                })),
            };
          case "tierPlan": return { fingerprint: "local-ui-fixture", selection: { ceiling: "sandbox", projects: [], readOnly: [], components: [] }, current: { revision: 0, tier: { instanceId: args.instanceId, ceiling: "sandbox", projects: [], readOnly: [], components: [] }, grants: [] }, entries: [], projects: [], readOnly: [] };
          case "policyPlan":
            return {
              fingerprint: "policy-fixture",
              selected: null,
              active: null,
              candidates: [],
              available: [],
              componentNames: {},
              targetNames: {},
            };
          case "resourcePlan":
            return {
              fingerprint: "resource-fixture",
              epoch: 0,
              spaces: [],
              qualifications: [],
              bindings: [],
              requirements: [],
            };
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
        const listeners: Set<() => void> = ((state as any).refreshListeners ??=
          new Set());
        listeners.add(fn);
        state.refresh = () => {
          for (const listener of listeners) listener();
        };
        return () => {
          listeners.delete(fn);
        };
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

it("selects Agents with the keyboard, closes menus, and returns from detail while keeping the selection", async () => {
  const f = await fixture();
  const { page } = f;
  const trigger = page.getByTestId("agent-switcher");
  const focused = () =>
    page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  try {
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect.poll(focused).toBe("助手 a");
    expect(
      await page
        .getByRole("option", { name: "助手 a" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await page.keyboard.press("End");
    await expect.poll(focused).toBe("助手 b");
    await page.keyboard.press("Home");
    await expect.poll(focused).toBe("助手 a");
    await page.keyboard.press("ArrowUp");
    await expect.poll(focused).toBe("助手 b");
    await page.keyboard.press("ArrowDown");
    await expect.poll(focused).toBe("助手 a");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect.poll(() => trigger.textContent()).toContain("助手 b");
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    await expect.poll(focused).toBe("当前 Agent");
    await trigger.click();
    await expect.poll(focused).toBe("助手 b");
    await page.keyboard.press("Escape");
    await expect.poll(focused).toBe("当前 Agent");
    await trigger.click();
    await page.keyboard.press("Tab");
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      await page
        .getByTestId("import-file")
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await trigger.click();
    await page.getByRole("heading", { name: "我的 Agent" }).click();
    expect(await trigger.getAttribute("aria-expanded")).toBe("false");
    await page.getByTestId("agent-card").filter({ hasText: "助手 b" }).click();
    await page.getByTestId("agent-detail").waitFor();
    await page
      .getByRole("button", { name: "返回我的 Agent", exact: true })
      .click();
    await page.getByTestId("agent-card").first().waitFor();
    expect(await page.getByTestId("agent-detail").count()).toBe(0);
    expect(await trigger.textContent()).toContain("助手 b");
    await page.evaluate(() => {
      const s = (window as any).interaction;
      for (let index = 1; index <= 30; index++) {
        s.agents.push({
          ...s.agents[0],
          instanceId: `extra-${index}`,
          name: `临时助手 ${index}`,
        });
      }
      s.refresh();
    });
    await expect.poll(() => page.getByTestId("agent-card").count()).toBe(32);
    await trigger.click();
    const menu = page.getByRole("listbox", { name: "当前 Agent" });
    expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    await page.keyboard.press("End");
    await expect.poll(focused).toBe("临时助手 30");
    expect(await menu.evaluate((el) => el.scrollTop > 0)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await trigger.textContent()).toContain("助手 b");
  } finally {
    await f.close();
  }
});

it("keeps theme choices after failures and stale refreshes, disables pending saves, and permits retry", async () => {
  const f = await fixture();
  const { page } = f;
  try {
    await page.getByTestId("nav-tab-settings").click();
    const trigger = page.getByRole("button", { name: "外观主题", exact: true });
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.runtime({ instanceId: "a", name: "助手 a", visible: false });
      s.failTheme = true;
    });
    await trigger.click();
    await page.getByRole("option", { name: "深色", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "外观未保存" }).waitFor();
    expect(await trigger.textContent()).toContain("跟随系统");
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.failTheme = false;
      s.hold = ["setDesktopTheme:"];
    });
    await trigger.click();
    await page.getByRole("option", { name: "浅色", exact: true }).click();
    await expect.poll(() => trigger.isDisabled()).toBe(true);
    await page.evaluate(() => (window as any).interaction.waiting[0].resolve());
    await expect.poll(() => trigger.textContent()).toContain("浅色");
    expect(await page.getByRole("alert").count()).toBe(0);
    await page.evaluate(() => {
      const s = (window as any).interaction;
      s.hold = ["library:"];
      s.refresh();
    });
    await page.waitForFunction(
      () => (window as any).interaction.waiting.length === 2,
    );
    await trigger.click();
    await page.getByRole("option", { name: "深色", exact: true }).click();
    await expect.poll(() => trigger.textContent()).toContain("深色");
    await page.evaluate(() => (window as any).interaction.waiting[1].resolve());
    await expect
      .poll(() => page.locator("main").getAttribute("aria-busy"))
      .toBe("false");
    expect(await trigger.textContent()).toContain("深色");
    expect(await page.getByTestId("resume-agent").isVisible()).toBe(true);
  } finally {
    await f.close();
  }
});

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
    await page.getByTestId("agent-switcher").click();
    await page.getByRole("option", { name: "助手 b", exact: true }).click();
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
          target: "https",
          operations: ["request"],
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
            "连接当前 Agent 配置的 HTTPS 服务：opencode.ai（custom-model）",
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
            "连接当前 Agent 配置的 HTTPS 服务：custom.example（new-model）",
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

it("keeps resource bindings locked until authoritative refresh and uses its current fingerprint for the next change", async () => {
  const f = await fixture(),
    { page } = f;
  try {
    await page.evaluate(() => {
      const original = window.manager.call;
      const state = (window as any).interaction;
      state.resourceBinding = "private";
      state.resourceRevision = 0;
      state.holdResourcePlan = false;
      state.resourceWrites = [];
      window.manager.call = async (method, args = {}) => {
        if (method === "setResourceBinding") {
          state.resourceWrites.push(structuredClone(args));
          if (args.fingerprint !== String(state.resourceRevision))
            throw { message: "陈旧状态拒绝" };
          if (state.failResourceWrite) throw { message: "资源绑定未保存" };
          state.resourceBinding = args.resourceId;
          state.resourceRevision++;
          return null;
        }
        if (method === "resourcePlan") {
          const plan = {
            fingerprint: String(state.resourceRevision),
            epoch: 0,
            active: null,
            spaces: ["private", "shared"].map((id) => ({
              id,
              name: id,
              scope: id === "private" ? "agent" : "shared",
              ownerAgentId: "a",
              contentContract: "fixture",
            })),
            qualifications: [],
            requirements: [
              {
                componentId: "alpha",
                componentName: "工具甲",
                id: "shared",
                target: "business",
                operations: ["read"],
                enabled: true,
                installation: "same",
              },
            ],
            bindings: [
              {
                componentId: "alpha",
                requirementId: "shared",
                resourceId: state.resourceBinding,
                installation: "same",
              },
            ],
          };
          if (state.holdResourcePlan) {
            state.planWaiting = true;
            await new Promise<void>((resolve) => {
              state.releaseResourcePlan = () => {
                state.holdResourcePlan = false;
                state.planWaiting = false;
                resolve();
              };
            });
          }
          return plan;
        }
        return original(method, args);
      };
    });
    await page.getByTestId("agent-card").filter({ hasText: "助手 a" }).click();
    const panel = page.getByRole("region", { name: "业务资源" });
    const select = panel.getByLabel("工具甲 的资源 shared", { exact: true });
    await select.waitFor();
    await page.evaluate(() => {
      (window as any).interaction.holdResourcePlan = true;
    });
    await select.selectOption("shared");
    await expect
      .poll(() => page.evaluate(() => (window as any).interaction.planWaiting))
      .toBe(true);
    expect(await select.isDisabled()).toBe(true);
    await page.evaluate(() => {
      (window as any).interaction.releaseResourcePlan();
    });
    await expect.poll(() => select.isEnabled()).toBe(true);
    await expect.poll(() => select.inputValue()).toBe("shared");
    await select.selectOption("private");
    await expect.poll(() => select.inputValue()).toBe("private");
    const writes = await page.evaluate(
      () => (window as any).interaction.resourceWrites,
    );
    expect(writes.map((w: any) => w.fingerprint)).toEqual(["0", "1"]);
    await page.evaluate(() => {
      (window as any).interaction.failResourceWrite = true;
    });
    await select.selectOption("shared");
    await panel.getByText("资源绑定未保存", { exact: true }).waitFor();
    expect(await select.inputValue()).toBe("private");
    expect(await select.isEnabled()).toBe(true);
  } finally {
    await f.close();
  }
});
