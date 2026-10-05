import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd(),
  temporary = await mkdtemp(path.join(os.tmpdir(), "plums-engine-smoke-"));
const output = path.join(
  root,
  ".artifacts/implementation-validation/engine-smoke",
);
await mkdir(output, { recursive: true });
const executablePath =
  process.env.PLUMS_APP ??
  path.join(root, "release/Plums-darwin-arm64/Plums.app/Contents/MacOS/Plums");
let application;
const errors = [];
let grants = 0;
const server = createServer((_q, r) => r.end("local network fixture"));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
try {
  application = await electron.launch({
    executablePath,
    env: { ...process.env, PLUMS_DATA_DIR: path.join(temporary, "library") },
    timeout: 30_000,
  });
  application.on(
    "window",
    (page) =>
      void (async () => {
        await page.waitForLoadState("domcontentloaded");
        if (!page.url().endsWith("confirm.html")) return;
        const kind = await page
          .locator("[data-kind]")
          .getAttribute("data-kind");
        await application.evaluate(({ app, BrowserWindow }) => {
          app.focus({ steal: true });
          BrowserWindow.getAllWindows()
            .find((w) => w.getTitle() === "Plums · 安全确认")
            ?.focus();
        });
        if (kind === "engine-trust") {
          grants++;
          await expect(
            page.getByText("信任将保留，直到你撤销授权或删除这个 Agent。"),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "暂不启动", exact: true }),
          ).toBeFocused();
          await page.screenshot({ path: path.join(output, "first-trust.png") });
        }
        const button = page.getByRole("button", {
          name: kind === "engine-trust" ? "信任并启动" : "允许",
          exact: true,
        });
        await expect(button).toBeEnabled();
        await button.click();
      })().catch((e) => errors.push(String(e))),
  );
  const manager = await application.firstWindow();
  await manager.waitForLoadState("domcontentloaded");
  const call = (method, args = {}) =>
    manager.evaluate(
      ([method, args]) => window.manager.call(method, args),
      [method, args],
    );
  const preview = await call("preview", {
    path: path.join(root, "release/examples/trusted-engine-agent.zip"),
  });
  const record = await call("install", { token: preview.token });
  const id = record.instanceId;
  await call("enable", { instanceId: id, packageId: "engine-demo" });
  assert.deepEqual(
    (await call("resources", { instanceId: id })).packages[0].engines,
    [{ engineId: "local", state: "stopped", trusted: false }],
  );
  await call("openAgent", { instanceId: id });
  let guest = application
    .windows()
    .find((p) => p.url().startsWith("plums-agent:"));
  if (!guest)
    guest = await application.waitForEvent("window", {
      predicate: (p) => p.url().startsWith("plums-agent:"),
    });
  await expect(
    guest.getByRole("heading", { name: "本机引擎示例" }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "启动引擎", exact: true }).click();
  await expect(guest.locator("#status")).toContainText("running");
  assert.equal(grants, 1);
  const file = path.join(temporary, "project.txt"),
    port = server.address().port;
  await guest.locator("#mode").selectOption("full");
  await guest.locator("#actions").fill(
    JSON.stringify([
      { type: "write", path: file, text: "packaged engine write" },
      {
        type: "exec",
        cwd: temporary,
        code: "process.stdout.write('packaged subprocess')",
      },
      { type: "network", url: `http://127.0.0.1:${port}` },
      { type: "wait", ms: 5500 },
    ]),
  );
  await guest.getByRole("button", { name: "执行任务", exact: true }).click();
  await expect(guest.locator("#output")).toContainText("packaged subprocess", {
    timeout: 15_000,
  });
  assert.equal(await readFile(file, "utf8"), "packaged engine write");
  assert.equal(grants, 1);
  await guest.locator("#actions").fill('[{"type":"wait","ms":60000}]');
  await guest.getByRole("button", { name: "执行任务", exact: true }).click();
  await guest.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "执行任务", exact: true }),
  ).toBeEnabled();
  await application.evaluate(({ webContents, Menu }) => {
    webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith("plums-agent:"))
      ?.forcefullyCrashRenderer();
    Menu.getApplicationMenu()
      .items.flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === "恢复默认界面")
      ?.click();
  });
  await expect.poll(() => call("agentState")).toBe(null);
  assert.equal(
    (
      await call("engineStatus", {
        instanceId: id,
        packageId: "engine-demo",
        engineId: "local",
      })
    ).state,
    "running",
  );
  await call("openAgent", { instanceId: id });
  guest = application.windows().find((p) => p.url().startsWith("plums-agent:"));
  if (!guest)
    guest = await application.waitForEvent("window", {
      predicate: (p) => p.url().startsWith("plums-agent:"),
    });
  await expect(guest.locator("#status")).toContainText("running");
  // Frontend identity is authoritative: a payload cannot address another component or write trust.
  const refused = await guest.evaluate(async () => {
    try {
      await window.plums.engine.start("undeclared");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(refused, true);
  await guest.evaluate(() => window.plums.openManager());
  await call("stopAgent");
  await manager
    .getByTestId("agent-card")
    .filter({ hasText: "本机引擎示例" })
    .click();
  await expect(
    manager.getByRole("heading", { name: "本机引擎", exact: true }),
  ).toBeVisible();
  for (const width of [1180, 760, 375, 320]) {
    await manager.setViewportSize({ width, height: 900 });
    assert(
      await manager.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `engine manager overflow at ${width}`,
    );
    await manager.screenshot({
      path: path.join(output, `manager-${width}.png`),
    });
  }
  await call("stopEngine", {
    instanceId: id,
    packageId: "engine-demo",
    engineId: "local",
  });
  await call("startEngine", {
    instanceId: id,
    packageId: "engine-demo",
    engineId: "local",
  });
  assert.equal(grants, 1);
  await call("revokeEngine", {
    instanceId: id,
    packageId: "engine-demo",
    engineId: "local",
  });
  assert.deepEqual(
    await call("engineStatus", {
      instanceId: id,
      packageId: "engine-demo",
      engineId: "local",
    }),
    { engineId: "local", state: "stopped", trusted: false },
  );
  await call("startEngine", {
    instanceId: id,
    packageId: "engine-demo",
    engineId: "local",
  });
  assert.equal(grants, 2);
  await call("stopEngine", {
    instanceId: id,
    packageId: "engine-demo",
    engineId: "local",
  });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        packaged: true,
        firstTrust: true,
        autonomousFileProcessNetwork: true,
        longTask: true,
        cancel: true,
        rendererRecoveryPreservesEngine: true,
        reconnect: true,
        managerStopAndRevoke: true,
        normalStopReusesTrust: true,
        undeclaredEngineRefused: true,
        widths: [1180, 760, 375, 320],
      },
      null,
      2,
    ),
  );
  console.log("Packaged engine smoke passed");
} finally {
  if (application) await application.close();
  await new Promise((r) => server.close(r));
  await rm(temporary, { recursive: true, force: true });
}
