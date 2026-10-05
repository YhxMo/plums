import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
const root = process.cwd(),
  temporary = await mkdtemp(path.join(os.tmpdir(), "plums-app-smoke-"));
const output = path.join(root, "release", "smoke");
await mkdir(output, { recursive: true });
const executablePath =
  process.env.PLUMS_APP ??
  path.join(root, "release/Plums-darwin-arm64/Plums.app/Contents/MacOS/Plums");
let application;
try {
  application = await electron.launch({
    executablePath,
    env: { ...process.env, PLUMS_DATA_DIR: path.join(temporary, "library") },
    timeout: 30000,
  });
  await application.evaluate(() => {
    globalThis.plumsSmoke = {
      allow: true,
      confirmations: 0,
      enablePrompts: 0,
      taskPrompts: 0,
    };
  });
  const confirmationErrors = [];
  application.on("window", (page) => {
    void (async () => {
      await page.waitForLoadState("domcontentloaded");
      if (!page.url().endsWith("confirm.html")) return;
      const kind = await page.locator("[data-kind]").getAttribute("data-kind");
      await application.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Plums · 安全确认")
          ?.focus();
      });
      await page.screenshot({
        path: path.join(output, `confirmation-${kind}.png`),
      });
      const allow = await application.evaluate((_electron, kind) => {
        if (kind === "capability") globalThis.plumsSmoke.confirmations++;
        else if (kind === "task") globalThis.plumsSmoke.taskPrompts++;
        else globalThis.plumsSmoke.enablePrompts++;
        return globalThis.plumsSmoke.allow;
      }, kind);
      const button = page.getByRole("button", {
        name: allow ? "允许" : "不允许",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
    })().catch((error) => confirmationErrors.push(String(error)));
  });
  const manager = await application.firstWindow();
  await manager.waitForLoadState("domcontentloaded");
  await expect(
    manager.getByRole("heading", { name: "把第一个 Agent 拖进来" }),
  ).toBeVisible();
  const windowChrome = () =>
    application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(
        (window) => window.getTitle() === "Plums",
      );
      return {
        frame: window.getBounds(),
        content: window.getContentBounds(),
        buttons: window.getWindowButtonPosition(),
        views: window.contentView.children.map((view) => view.getBounds()),
      };
    });
  const initialChrome = await windowChrome();
  assert.equal(initialChrome.content.y, initialChrome.frame.y);
  assert.deepEqual(initialChrome.buttons, { x: 20, y: 21 });
  for (const tab of ["character", "extension", "settings", "home"]) {
    await manager.getByTestId(`nav-tab-${tab}`).click();
    await expect(manager.getByTestId(`nav-tab-${tab}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await manager.screenshot({ path: path.join(output, "manager.png") });
  const call = async (method, args) => {
    const r = await manager.evaluate(
      async ([method, args]) => {
        try {
          return { value: await window.manager.call(method, args) };
        } catch (error) {
          return { error };
        }
      },
      [method, args],
    );
    if (r.error)
      throw Error(
        `${method}${args?.packageId ? ` (${args.packageId})` : ""}: ${JSON.stringify(r.error)}`,
      );
    return r.value;
  };
  assert.equal((await call("desktopSettings")).dnsMode, "auto");
  async function drop(file, surface = manager, button = "导入并配置") {
    const cdp = await surface.context().newCDPSession(surface);
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", "drop"])
      await cdp.send("Input.dispatchDragEvent", { type, x: 620, y: 390, data });
    await cdp.detach();
    await expect(manager.getByRole("button", { name: button })).toBeVisible();
    await manager.getByRole("button", { name: button }).click();
    await expect(manager.getByTestId("import-dialog")).toHaveCount(0);
    await expect(manager.getByTestId("import-file")).toBeEnabled();
  }
  const jsonPath = path.join(temporary, "原始角色.json"),
    pngPath = path.join(temporary, "原始PNG.png");
  await writeFile(
    jsonPath,
    JSON.stringify({
      persona: { instructions: "手动装配测试" },
      unknown: { retained: true },
    }),
  );
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]),
      out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), out.length - 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(
    pngPath,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk(
        "tEXt",
        Buffer.from(
          "ccv3\0" +
            Buffer.from(
              '{"spec":"chara_card_v3","data":{"name":"PNG"}}',
            ).toString("base64"),
        ),
      ),
      chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  for (const file of [
    jsonPath,
    pngPath,
    path.join(root, "release/examples/board-ui.zip"),
    path.join(root, "release/examples/http-connector.zip"),
  ])
    await drop(file, manager, "导入公共库");
  assert.equal((await call("library")).length, 4);
  assert.equal((await call("list")).length, 0);
  await manager.getByTestId("nav-tab-home").click();
  await manager
    .getByRole("button", { name: "从组件库组装", exact: true })
    .click();
  await manager.getByLabel("Agent 名称").fill("Empty Smoke");
  await manager
    .locator(".modal")
    .getByRole("button", { name: "创建 Agent", exact: true })
    .click();
  await expect(manager.getByTestId("assembly-dialog")).toHaveCount(0);
  await expect(manager.getByTestId("setup-dialog")).toBeVisible();
  await manager.getByRole("button", { name: "稍后配置" }).click();
  const empty = (await call("list"))[0];
  assert.equal(empty.components.length, 0);
  assert.equal(empty.agent.startup, undefined);
  await call("openAgent", { instanceId: empty.instanceId });
  await expect(
    manager.getByRole("heading", { name: "Empty Smoke" }),
  ).toBeVisible();
  await manager.getByTestId("nav-tab-home").click();
  await manager
    .getByRole("button", { name: "创建 Agent", exact: true })
    .click();
  await manager.getByLabel("Agent 名称").fill("Manual Board");
  await manager
    .getByTestId("assembly-dialog")
    .getByRole("button", { name: /^扩展/ })
    .click();
  await manager.getByLabel("选择 纸上看板 1.0.0").check();
  await manager
    .getByTestId("assembly-dialog")
    .getByRole("button", { name: /^角色卡/ })
    .click();
  await manager.getByLabel("选择 原始角色 1.0.0").check();
  const card = (await call("library")).find(
    (p) => p.manifest.name === "原始角色",
  );
  await expect(manager.getByLabel("默认角色卡")).toHaveValue(card.manifest.id);
  await expect(manager.getByLabel("工作界面", { exact: true })).toHaveValue(
    "board",
  );
  await expect(
    manager.getByRole("button", { name: "创建 Agent", exact: true }).last(),
  ).toBeEnabled();
  await manager.screenshot({ path: path.join(output, "assembly.png") });
  await manager
    .locator(".modal")
    .getByRole("button", { name: "创建 Agent", exact: true })
    .click();
  await expect(manager.getByTestId("assembly-dialog")).toHaveCount(0);
  const board = (await call("list")).find((a) => a.name === "Manual Board");
  assert(board);
  await expect(manager.getByTestId("setup-dialog")).toBeVisible();
  await application.evaluate(() => {
    globalThis.plumsSmoke.allow = false;
  });
  await manager
    .getByTestId("setup-dialog")
    .getByRole("button", { name: "开始使用" })
    .click();
  await expect
    .poll(() => application.evaluate(() => globalThis.plumsSmoke.enablePrompts))
    .toBe(1);
  await expect(
    manager
      .getByTestId("setup-dialog")
      .getByRole("button", { name: "开始使用" }),
  ).toBeEnabled();
  assert(
    (await call("resources", { instanceId: board.instanceId })).packages.every(
      (p) => !p.enabled && !p.consented,
    ),
  );
  await application.evaluate(() => {
    globalThis.plumsSmoke.allow = true;
  });
  await manager
    .getByTestId("setup-dialog")
    .getByRole("button", { name: "开始使用" })
    .click();
  await expect
    .poll(() => application.evaluate(() => globalThis.plumsSmoke.enablePrompts))
    .toBe(2);
  await expect(manager.getByTestId("setup-dialog")).toHaveCount(0);
  assert(
    (await call("resources", { instanceId: board.instanceId })).packages.every(
      (p) => p.enabled,
    ),
  );
  let guest = application
    .windows()
    .find((p) => p.url().startsWith("plums-agent:"));
  if (!guest)
    guest = await application.waitForEvent("window", {
      predicate: (p) => p.url().startsWith("plums-agent:"),
    });
  await expect(guest.locator("#text")).toBeVisible();
  const runningChrome = await windowChrome();
  assert.deepEqual(runningChrome.buttons, { x: 16, y: 13 });
  assert(
    runningChrome.views.some(
      (view) =>
        view.y === 40 && view.height === runningChrome.content.height - 40,
    ),
  );
  assert.equal(
    await manager
      .getByTestId("running-bar")
      .evaluate((el) => el.getBoundingClientRect().height),
    40,
  );
  const beforeTaskWrite = await application.evaluate(
    () => globalThis.plumsSmoke.confirmations,
  );
  await guest.locator("#text").fill("实际应用数据写入");
  await guest.getByRole("button", { name: "＋ 添加卡片" }).click();
  await expect(
    guest.getByText("实际应用数据写入", { exact: true }),
  ).toBeVisible();
  const saved = await readFile(
    path.join(
      temporary,
      "library/instances",
      board.instanceId,
      "agent-data/board.json",
    ),
    "utf8",
  );
  assert(saved.includes("实际应用数据写入"));
  await guest.locator("#text").fill("同范围连续写入");
  await guest.getByRole("button", { name: "＋ 添加卡片" }).click();
  await expect(
    guest.getByText("同范围连续写入", { exact: true }),
  ).toBeVisible();
  assert.equal(
    await application.evaluate(() => globalThis.plumsSmoke.confirmations),
    beforeTaskWrite,
  );
  assert(
    (await call("audit", { instanceId: board.instanceId })).some(
      (event) => event.taskId && event.phase === "result",
    ),
  );
  await guest.screenshot({ path: path.join(output, "board.png") });
  await manager
    .getByTestId("running-bar")
    .screenshot({ path: path.join(output, "running-bar.png") });
  const guestUrl = guest.url();
  await manager.getByRole("button", { name: "返回", exact: true }).click();
  assert.deepEqual((await windowChrome()).buttons, { x: 20, y: 21 });
  assert.equal((await call("agentState")).visible, false);
  assert.equal(guest.isClosed(), false);
  for (const width of [1180, 900, 760, 375, 320]) {
    await manager.setViewportSize({ width, height: 800 });
    await expect(manager.getByTestId("resume-agent")).toBeVisible();
    assert(
      await manager.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `runtime return layout overflow at ${width}`,
    );
  }
  await manager.setViewportSize({ width: 1180, height: 800 });
  await manager.getByTestId("resume-agent").click();
  assert.deepEqual((await windowChrome()).buttons, { x: 16, y: 13 });
  assert.equal((await call("agentState")).visible, true);
  assert.equal(guest.url(), guestUrl);
  await guest.evaluate(() => window.plums.openManager());
  assert.equal((await call("agentState")).visible, false);
  assert.equal(guest.isClosed(), false);
  await call("showAgent");
  await manager.getByRole("button", { name: "停止", exact: true }).click();
  await expect.poll(() => call("agentState")).toBe(null);
  await expect.poll(() => guest.isClosed()).toBe(true);
  await call("openAgent", { instanceId: board.instanceId });
  guest = application
    .windows()
    .find((page) => page.url().startsWith("plums-agent:"));
  if (!guest)
    guest = await application.waitForEvent("window", {
      predicate: (page) => page.url().startsWith("plums-agent:"),
    });
  await expect(
    guest.getByText("实际应用数据写入", { exact: true }),
  ).toBeVisible();

  assert.equal(await guest.evaluate(() => typeof process), "undefined");
  assert.equal(
    await guest.evaluate(() => typeof window.manager?.call),
    "undefined",
  );
  const blocked = await guest.evaluate(async () => {
    try {
      await fetch("https://example.com");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(blocked, true);
  await drop(path.join(root, "release/examples/plum-chat.zip"), guest);
  const chat = (await call("list")).find((a) => a.agent.id === "plum-chat");
  assert(chat);
  await expect(manager.getByTestId("setup-dialog")).toBeVisible();
  await expect(manager.getByLabel("模型名称", { exact: true })).toBeVisible();
  await expect(manager.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await expect(manager.getByLabel("协议", { exact: true })).toHaveValue(
    "OpenAI Chat Completions",
  );
  await expect(
    manager.getByLabel("协议", { exact: true }).locator("option"),
  ).toHaveCount(5);
  assert(
    await manager
      .getByLabel("Base URL", { exact: true })
      .evaluate((el) => !el.closest("details")),
  );
  await expect(manager.getByLabel("Base URL", { exact: true })).toHaveValue(
    "https://api.openai.com/v1",
  );
  await manager.screenshot({ path: path.join(output, "import-setup.png") });
  await manager.getByRole("button", { name: "开始使用" }).click();
  assert(
    (await call("resources", { instanceId: chat.instanceId })).packages.every(
      (p) => !p.enabled && !p.consented,
    ),
  );
  await manager.getByRole("button", { name: "稍后配置" }).click();
  await call("settings", {
    instanceId: chat.instanceId,
    packageId: "model",
    values: {
      model: "test-model",
      endpoint: "https://api.openai.com/v1/chat/completions",
    },
    secrets: { apiKey: "fake-smoke-credential" },
  });
  const secretFile = path.join(
    temporary,
    "library/instances",
    chat.instanceId,
    "secrets",
    createHash("sha256").update("secret:model/apiKey").digest("hex"),
  );
  assert.equal(await readFile(secretFile, "utf8"), "fake-smoke-credential");
  assert(
    !JSON.stringify(
      await call("resources", { instanceId: chat.instanceId }),
    ).includes("fake-smoke-credential"),
  );
  for (const packageId of [
    "persona",
    "model",
    "chat",
    "http-example",
    "remote-mcp",
  ])
    await call("enable", { instanceId: chat.instanceId, packageId });
  assert(
    (await call("resources", { instanceId: chat.instanceId })).packages.every(
      (p) => p.enabled && p.consented,
    ),
    "all chat components must be enabled before packaged I/O validation",
  );
  const workspace = path.join(temporary, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "source.txt"), "真实选定目录");
  await application.evaluate(({ dialog }, workspace) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [workspace],
    });
  }, workspace);
  await call("chooseRoot", { instanceId: chat.instanceId, name: "workspace" });
  const invoke = (pkg, kind, name, input = {}) =>
    call("invoke", {
      instanceId: chat.instanceId,
      packageId: pkg,
      kind,
      name,
      input,
    });
  const listed = await invoke("chat", "tools", "list_directory");
  assert(listed.entries.some((e) => e.name === "source.txt"));
  assert.equal(
    (await invoke("chat", "tools", "read_file", { path: "source.txt" })).text,
    "真实选定目录",
  );
  await invoke("chat", "tools", "write_file", {
    path: "result.txt",
    text: "已确认写入",
  });
  assert.equal(
    await readFile(path.join(workspace, "result.txt"), "utf8"),
    "已确认写入",
  );
  await application.evaluate(() => {
    globalThis.plumsSmoke.allow = false;
  });
  await assert.rejects(
    invoke("chat", "tools", "write_file", {
      path: "denied.txt",
      text: "不应执行",
    }),
  );
  await assert.rejects(readFile(path.join(workspace, "denied.txt")));
  await manager.getByTestId("nav-tab-home").click();
  await manager
    .getByTestId("agent-card")
    .filter({ hasText: chat.name })
    .click();
  await manager.getByRole("button", { name: "解除绑定", exact: true }).click();
  await manager
    .getByTestId("delete-dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert(
    (await call("resources", { instanceId: chat.instanceId })).record.roots
      .workspace,
  );
  await manager.getByRole("button", { name: "解除绑定", exact: true }).click();
  await manager
    .getByTestId("delete-dialog")
    .getByRole("button", { name: "解除绑定", exact: true })
    .click();
  await expect(
    manager.getByRole("button", { name: "绑定", exact: true }),
  ).toBeVisible();
  await assert.rejects(
    invoke("chat", "tools", "read_file", { path: "source.txt" }),
  );
  assert.equal(
    await readFile(path.join(workspace, "source.txt"), "utf8"),
    "真实选定目录",
  );
  await manager.getByRole("button", { name: "绑定", exact: true }).click();
  await expect(
    manager.getByRole("button", { name: "更换", exact: true }),
  ).toBeVisible();
  await application.evaluate(() => {
    globalThis.plumsSmoke.allow = true;
  });
  assert.equal(
    (await invoke("chat", "tools", "read_file", { path: "source.txt" })).text,
    "真实选定目录",
  );
  const https = await invoke("http-example", "connectors", "inspect");
  assert.equal(https.status, 200);
  const tools = await invoke("remote-mcp", "connectors", "discover");
  assert(tools.length > 0);
  const selected =
    tools.find((t) => t.name === "read_wiki_structure") ?? tools[0];
  await call("approveMcp", {
    instanceId: chat.instanceId,
    packageId: "remote-mcp",
    permissionId: "mcp-api",
    tools: [selected],
  });
  if (selected.name === "read_wiki_structure") {
    const response = await invoke("remote-mcp", "connectors", "call", {
      name: selected.name,
      arguments: { repoName: "openai/openai-node" },
    });
    assert(response.content?.length);
  }
  await call("openAgent", { instanceId: chat.instanceId });
  guest = application.windows().find((p) => p.url().startsWith("plums-agent:"));
  if (!guest)
    guest = await application.waitForEvent("window", {
      predicate: (p) => p.url().startsWith("plums-agent:"),
    });
  await expect(guest.locator("h1")).toContainText(/plum\s*chat/i);
  await expect(guest.getByLabel("使用工作目录工具")).not.toBeChecked();
  await guest.screenshot({ path: path.join(output, "chat.png") });
  await application.evaluate(({ webContents, Menu }) => {
    const guest = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith("plums-agent:"));
    void guest.executeJavaScript("while(true){}").catch(() => {});
  });
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()
      .items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === "恢复默认界面");
    item.click();
  });
  await expect(manager.getByTestId("import-file")).toBeVisible();
  await call("openAgent", { instanceId: chat.instanceId });
  await application.evaluate(({ webContents }) => {
    const guest = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith("plums-agent:"));
    guest.forcefullyCrashRenderer();
  });
  await expect(manager.getByTestId("import-file")).toBeVisible();
  await call("resources", { instanceId: chat.instanceId });
  await manager.getByTestId("nav-tab-home").click();
  await manager
    .getByTestId("agent-card")
    .filter({ hasText: "Manual Board" })
    .click();
  await manager.getByRole("button", { name: "编辑组合", exact: true }).click();
  await expect(manager.getByLabel("Agent 名称")).toHaveValue("Manual Board");
  await manager.getByLabel("默认角色卡").selectOption("");
  await expect
    .poll(
      async () =>
        (await call("resources", { instanceId: board.instanceId })).record
          .characterId,
    )
    .toBeUndefined();
  await manager.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(manager.getByTestId("assembly-dialog")).toHaveCount(0);
  assert.equal(
    (await call("list")).find((a) => a.instanceId === board.instanceId)
      .characterId,
    undefined,
  );
  await manager.getByTestId("nav-tab-home").click();
  await manager
    .getByTestId("agent-card")
    .filter({ hasText: "Manual Board" })
    .click();
  await manager.getByRole("button", { name: "编辑组合", exact: true }).click();
  await manager
    .locator(".assembly-item")
    .filter({ hasText: "原始角色" })
    .getByRole("button", { name: "移出", exact: true })
    .click();
  await manager
    .getByTestId("delete-dialog")
    .getByRole("button", { name: "移出", exact: true })
    .click();
  await expect(
    manager
      .locator(".assembly-item")
      .filter({ hasText: "原始角色" })
      .getByRole("button", { name: "加入 Agent", exact: true }),
  ).toBeVisible();
  assert(
    !(await call("list"))
      .find((a) => a.instanceId === board.instanceId)
      .components.some((c) => c.packageId === card.manifest.id),
  );
  await manager.getByRole("button", { name: "关闭", exact: true }).click();
  await manager.screenshot({ path: path.join(output, "manual-assembly.png") });
  await application.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    },
    path.join(root, "release/examples/paper-board.zip"),
  );
  await manager.getByTestId("import-file").click();
  await expect(manager.getByLabel("这是完整的 Agent，直接使用")).toBeChecked();
  await manager.getByLabel("我还要补充功能，继续组装").check();
  await manager.screenshot({ path: path.join(output, "zip-choice.png") });
  const agentCount = (await call("list")).length;
  await manager.getByRole("button", { name: "导入并继续组装" }).click();
  await expect(manager.getByTestId("assembly-dialog")).toBeVisible();
  await expect(manager.getByLabel("Agent 名称")).toHaveValue("纸上看板");
  assert.equal((await call("list")).length, agentCount);
  await manager
    .getByTestId("assembly-dialog")
    .getByRole("button", { name: /^扩展/ })
    .click();
  await expect(manager.getByLabel("选择 纸上看板 1.0.0")).toBeChecked();
  await manager.getByRole("button", { name: "关闭", exact: true }).click();
  for (const colorScheme of ["light", "dark"]) {
    await manager.emulateMedia({ colorScheme });
    for (const width of [1180, 760, 375, 320]) {
      await manager.setViewportSize({ width, height: 900 });
      assert(
        await manager.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `manager layout overflow at ${width}`,
      );
      await manager.screenshot({
        path: path.join(output, `manager-${colorScheme}-${width}.png`),
      });
    }
  }
  assert.deepEqual(confirmationErrors, []);
  await manager.setViewportSize({ width: 1180, height: 800 });
  const count = await application.evaluate(
    () => globalThis.plumsSmoke.confirmations,
  );
  assert(count >= 7);
  const audit = await call("audit", { instanceId: chat.instanceId });
  assert(
    audit.some((e) => e.phase === "confirmation" && e.outcome === "denied"),
  );
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        packaged: true,
        mergedTitleBar: true,
        nativeButtonsFollowRuntime: true,
        runningBarHeight: 40,
        navigationClickable: true,
        dragImport: true,
        independentImports: ["json", "png", "extension", "connector"],
        emptyAgent: true,
        manualAssembly: true,
        automaticDefaultChoices: true,
        groupedAssembly: true,
        immediateConfiguration: true,
        requiredFieldsPreventEnable: true,
        unifiedEnableAndOpen: true,
        rejectedUnifiedConsent: true,
        zipImportChoices: true,
        editAssembly: true,
        defaultCharacterClear: true,
        immediateAssemblyPreferences: true,
        directoryUnbindAndRebind: true,
        genericStatus: true,
        distinctFrontends: true,
        filesystem: true,
        localSecretStorage: true,
        automaticDns: true,
        httpsStatus: https.status,
        mcpTools: tools.map((t) => t.name),
        rendererRecovery: true,
        infiniteLoopRecovery: true,
        guestDragImport: true,
        confirmations: count,
        runtimeReturnAndResume: true,
        sdkReturnPreservesRuntime: true,
        runtimeStopAndRestart: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Packaged app smoke passed: ZIP drag, frontends, FS, HTTPS, remote MCP, denial, renderer recovery",
  );
} finally {
  if (application) await application.close();
  await rm(temporary, { recursive: true, force: true });
}
