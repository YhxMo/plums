import { it, expect } from "vitest";
import { _electron as electron, expect as uiExpect } from "@playwright/test";
import { createRequire } from "node:module";
import {
  cp,
  mkdir,
  symlink,
  rm,
  writeFile,
  mkdtemp,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { createArchive } from "@plumsjs/core";
import { fixture } from "../../host/test/common-fixture.js";
import { cachePaths } from "../../host/src/project-cache.js";
import { engineManifest } from "../../host/test/platform-fixtures.js";

it.runIf(process.platform === "darwin" && process.arch === "arm64")(
  "trusted permissions summary confirms the assembly, controls a process and revokes authorization",
  async () => {
    const f = await fixture();
    const manifest = engineManifest();
    manifest.dependencies = [];
    manifest.permissions = manifest.permissions.slice(0, 1);
    const archive = await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "runtime/main.js": Buffer.from("export function activate(){}"),
      "ui/index.html": Buffer.from("<p>Internal fixture</p>"),
      "engine/main.mjs": Buffer.from(
        `import{createInterface}from'node:readline';createInterface({input:process.stdin}).on('line',l=>{const m=JSON.parse(l);if(m.method)console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocol:'jsonrpc-jsonl-v1'}:process.pid}));});`,
      ),
    });
    const imported = await f.host.importLibrary(
      ((await f.host.preview(archive)) as { token: string }).token,
    );
    await f.host.addLibraryComponent(f.a.instanceId, imported.digest);
    await f.host.enable(f.a.instanceId, manifest.id);
    await f.host.close();
    const stage = path.join(f.dir, "desktop"),
      root = process.cwd();
    await cp(
      path.join(root, "packages/desktop/dist"),
      path.join(stage, "dist"),
      { recursive: true },
    );
    for (const [name, pkg] of [
      ["isolated-vm", "host"],
      ["better-sqlite3", "core"],
    ]) {
      const resolver = createRequire(
        path.join(root, `packages/${pkg}/package.json`),
      );
      await mkdir(path.join(stage, "node_modules"), { recursive: true });
      await symlink(
        path.dirname(resolver.resolve(name + "/package.json")),
        path.join(stage, "node_modules", name),
      );
    }
    const app = await electron.launch({
      executablePath: createRequire(import.meta.url)("electron"),
      args: [path.join(stage, "dist/main.js")],
      env: {
        ...process.env,
        PLUMS_NODE: path.join(
          root,
          ".artifacts/node-v26.5.1-darwin-arm64/bin/node",
        ),
        PLUMS_DATA_DIR: f.dir,
      },
    });
    try {
      const page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Fixture A" }).click();
      const panel = page.getByRole("region", { name: "Agent 权限" });
      await uiExpect(panel.getByLabel("档位上限", { exact: true })).toHaveValue(
        "sandbox",
      );
      await panel
        .getByLabel("档位上限", { exact: true })
        .selectOption("machine");
      await panel
        .getByRole("button", { name: "查看汇总", exact: true })
        .click();
      await uiExpect(
        panel.getByText("Plums 自身数据和其他 Agent 的密钥", { exact: false }),
      ).toBeVisible();
      await uiExpect(
        panel
          .getByRole("region", { name: "待确认汇总" })
          .getByText(
            "停止或撤销该入口后，它启动且已脱离其进程组的子进程可能继续运行。",
            { exact: false },
          ),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: "在可信窗口确认", exact: true })
        .click();
      await expect
        .poll(() =>
          app
            .windows()
            .find((w) => w.url().endsWith("confirm.html"))
            ?.url(),
        )
        .toBeDefined();
      const confirmation = app
        .windows()
        .find((w) => w.url().endsWith("confirm.html"))!;
      await uiExpect(
        confirmation.getByRole("heading", { name: "确认当前组装与范围？" }),
      ).toBeVisible();
      await uiExpect(
        confirmation.getByRole("button", { name: "不允许", exact: true }),
      ).toBeFocused();
      await uiExpect(
        confirmation.getByText("Plums 自身数据和其他 Agent 的密钥", {
          exact: false,
        }),
      ).toBeVisible();
      await uiExpect(
        confirmation.getByText(
          "停止或撤销该入口后，它启动且已脱离其进程组的子进程可能继续运行。",
          { exact: false },
        ),
      ).toBeVisible();
      await confirmation
        .getByRole("button", { name: "允许", exact: true })
        .click();
      await uiExpect(panel.getByRole("status").first()).toContainText(
        "当前上限：整机",
      );
      const engine = panel.getByTestId("local-entry-engine-demo-local");
      await engine
        .getByRole("button", { name: "启动进程", exact: true })
        .click();
      await uiExpect(engine.getByRole("status")).toContainText("运行中");
      await engine
        .getByRole("button", { name: "停止进程", exact: true })
        .click();
      await uiExpect(engine.getByRole("status")).toContainText("已停止");
      await panel
        .getByRole("button", {
          name: "撤销 Engine boundary fixture 的本地执行",
          exact: true,
        })
        .click();
      await uiExpect(engine.getByRole("status")).toContainText("待确认");
      await panel
        .getByRole("button", { name: "降低到沙箱", exact: true })
        .click();
      await uiExpect(panel.getByRole("status").first()).toContainText(
        "当前上限：沙箱",
      );
      const outputs = path.join(
        root,
        ".artifacts/requirements-v1/remaining-step5",
      );
      await mkdir(outputs, { recursive: true });
      for (const width of [1120, 800, 360]) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const w = BrowserWindow.getAllWindows()[0]!;
          w.setMinimumSize(0, 0);
          w.setSize(width, 900);
        }, width);
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await panel.screenshot({
          path: path.join(outputs, `permissions-${width}.png`),
        });
      }
    } catch (error) {
      const page = app.windows().find((w) => !w.url().endsWith("confirm.html"));
      if (page)
        await writeFile(
          path.join(
            root,
            ".artifacts/requirements-v1/remaining-step5/ui-failure.txt",
          ),
          await page.locator("body").innerText(),
        );
      throw error;
    } finally {
      await app.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
  120000,
);

it.runIf(process.platform === "darwin" && process.arch === "arm64")(
  "project support performs trusted credential approval, revocation, cache clearing and real failed self-check",
  async () => {
    const f = await fixture(),
      project = await mkdtemp("/private/tmp/plums-project-ui-");
    const manifest = engineManifest();
    manifest.dependencies = [];
    manifest.permissions = [
      {
        id: "local-engine",
        kind: "engine",
        target: "local",
        tier: "project",
        network: { hosts: ["npm.example.test"] },
        credentials: [
          {
            id: "npm",
            kind: "npm-token",
            host: "npm.example.test",
            reason: "Synthetic download",
          },
        ],
        reason: "Synthetic project",
      },
    ] as typeof manifest.permissions;
    const archive = await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "runtime/main.js": Buffer.from("export function activate(){}"),
      "ui/index.html": Buffer.from("<p>Fixture</p>"),
      "engine/main.mjs": Buffer.from("throw Error('must not launch')"),
    });
    const imported = await f.host.importLibrary(
      ((await f.host.preview(archive)) as { token: string }).token,
    );
    await f.host.addLibraryComponent(f.a.instanceId, imported.digest);
    await f.host.enable(f.a.instanceId, manifest.id);
    await f.host.bindRoot(f.a.instanceId, "workspace", project);
    const selection = {
      ceiling: "project" as const,
      projects: ["workspace"],
      readOnly: [],
      components: [manifest.id],
      hosts: { [manifest.id]: { local: ["npm.example.test"] } },
    };
    const plan = await f.host.tierPlan(f.a.instanceId, selection);
    expect(
      await f.host.confirmTier(f.a.instanceId, plan.fingerprint, selection),
    ).toBe(true);
    await f.host.close();
    const cacheRoot = cachePaths(f.dir, f.a.instanceId, manifest.id).root,
      cacheFile = path.join(cacheRoot, "synthetic-cache");
    await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
    await writeFile(cacheFile, "synthetic cache");

    const stage = path.join(f.dir, "desktop"),
      root = process.cwd();
    await cp(
      path.join(root, "packages/desktop/dist"),
      path.join(stage, "dist"),
      { recursive: true },
    );
    for (const [name, pkg] of [
      ["isolated-vm", "host"],
      ["better-sqlite3", "core"],
    ]) {
      const resolver = createRequire(
        path.join(root, `packages/${pkg}/package.json`),
      );
      await mkdir(path.join(stage, "node_modules"), { recursive: true });
      await symlink(
        path.dirname(resolver.resolve(name + "/package.json")),
        path.join(stage, "node_modules", name),
      );
    }
    const app = await electron.launch({
      executablePath: createRequire(import.meta.url)("electron"),
      args: [path.join(stage, "dist/main.js")],
      env: {
        ...process.env,
        PLUMS_NODE: path.join(
          root,
          ".artifacts/node-v26.5.1-darwin-arm64/bin/node",
        ),
        PLUMS_DATA_DIR: f.dir,
      },
    });

    try {
      const page = await app.firstWindow();
      await page.getByRole("article", { name: "查看 Fixture A" }).click();
      const panel = page.getByRole("region", { name: "Agent 权限" });
      await panel
        .getByRole("button", { name: "查看汇总", exact: true })
        .click();
      await uiExpect(
        panel.getByText(
          "停止或撤销该入口后，它启动且已脱离其进程组的子进程可能继续运行。",
          { exact: false },
        ),
      ).toHaveCount(0);
      await uiExpect(
        panel.getByLabel("凭据（npm）", { exact: true }),
      ).toBeEnabled();
      const token = "SYNTHETIC_UI_TOKEN";
      await panel.getByLabel("凭据（npm）", { exact: true }).fill(token);
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()[0]?.focus();
      });
      await panel
        .getByRole("button", { name: "批准凭据 npm", exact: true })
        .click();
      await expect
        .poll(() =>
          app
            .windows()
            .find((w) => w.url().endsWith("confirm.html"))
            ?.url(),
        )
        .toBeDefined();
      const confirmation = app
        .windows()
        .find((w) => w.url().endsWith("confirm.html"))!;
      await confirmation.bringToFront();
      await app.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()
          .find((w) => w.getTitle() === "Plums · 安全确认")
          ?.focus();
      });
      await uiExpect(
        confirmation.getByText("令牌注入后扩展代码可以读到它", {
          exact: false,
        }),
      ).toBeVisible();
      expect(await confirmation.locator("body").innerText()).not.toContain(
        token,
      );
      await uiExpect(
        panel.getByLabel("凭据（npm）", { exact: true }),
      ).toHaveValue("");
      await confirmation
        .getByRole("button", { name: "允许", exact: true })
        .click();
      await uiExpect(
        panel.getByRole("button", { name: "撤销凭据 npm", exact: true }),
      ).toBeVisible();
      expect(await panel.innerText()).not.toContain(token);
      await panel
        .getByRole("button", { name: "撤销凭据 npm", exact: true })
        .click();
      await uiExpect(
        panel.getByRole("button", { name: "撤销凭据 npm", exact: true }),
      ).toHaveCount(0);
      const cacheRow = panel
        .locator(".local-project-support .root-row")
        .filter({ hasText: manifest.name });
      await uiExpect(
        cacheRow.getByRole("button", { name: "清空缓存", exact: true }),
      ).toBeEnabled();
      await cacheRow
        .getByRole("button", { name: "清空缓存", exact: true })
        .click();
      await expect
        .poll(async () =>
          lstat(cacheFile).then(
            () => true,
            () => false,
          ),
        )
        .toBe(false);
      await uiExpect(cacheRow).toContainText("0 字节 · 0 个文件");
      await panel
        .getByRole("button", { name: "重新自检项目边界", exact: true })
        .click();
      await uiExpect(
        panel.getByText("项目自检：边界检查失败", { exact: false }),
      ).toBeVisible();
      await uiExpect(
        panel
          .getByTestId("local-entry-engine-demo-local")
          .getByRole("button", { name: "启动进程", exact: true }),
      ).toBeDisabled();
      expect(await panel.innerText()).not.toContain("内核已阻止硬链接");
      const outputs = path.join(root, ".artifacts/macos-continuation/ui");
      await mkdir(outputs, { recursive: true });
      for (const width of [1120, 800, 360]) {
        await app.evaluate(({ BrowserWindow }, width) => {
          const w = BrowserWindow.getAllWindows()[0]!;
          w.setMinimumSize(0, 0);
          w.setSize(width, 900);
        }, width);
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await panel.screenshot({
          path: path.join(outputs, `project-support-${width}.png`),
        });
      }
    } finally {
      await app.close();
      await rm(f.dir, { recursive: true, force: true });
      await rm(project, { recursive: true, force: true });
    }
  },
  120000,
);

it("the revoke/stop control of a machine entry shows the detached-children limitation, a project entry does not", async () => {
  const f = await fixture();
  const root = process.cwd();
  const manifests = [engineManifest(), engineManifest()];
  manifests[1]!.id = "engine-project";
  for (const [index, manifest] of manifests.entries()) {
    manifest.dependencies = [];
    manifest.permissions = [
      {
        id: "local-engine",
        kind: "engine",
        target: "local",
        tier: index === 0 ? "machine" : "project",
        reason: "Synthetic tier",
      },
    ] as typeof manifest.permissions;
    const archive = await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "runtime/main.js": Buffer.from("export function activate(){}"),
      "ui/index.html": Buffer.from("<p>Synthetic fixture</p>"),
      "engine/main.mjs": Buffer.from("throw Error('must not launch')"),
    });
    const imported = await f.host.importLibrary(
      ((await f.host.preview(archive)) as { token: string }).token,
    );
    await f.host.addLibraryComponent(f.a.instanceId, imported.digest);
    await f.host.enable(f.a.instanceId, manifest.id);
  }
  await f.host.close();
  const stage = path.join(f.dir, "desktop");
  await cp(path.join(root, "packages/desktop/dist"), path.join(stage, "dist"), {
    recursive: true,
  });
  await mkdir(path.join(stage, "node_modules"), { recursive: true });
  for (const [name, pkg] of [
    ["isolated-vm", "host"],
    ["better-sqlite3", "core"],
  ]) {
    const resolver = createRequire(
      path.join(root, `packages/${pkg}/package.json`),
    );
    await symlink(
      path.dirname(resolver.resolve(name + "/package.json")),
      path.join(stage, "node_modules", name),
    );
  }
  const app = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.join(stage, "dist/main.js")],
    env: {
      ...process.env,
      PLUMS_NODE: path.join(
        root,
        ".artifacts/node-v26.5.1-darwin-arm64/bin/node",
      ),
      PLUMS_DATA_DIR: f.dir,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("article", { name: "查看 Fixture A" }).click();
    const panel = page.getByRole("region", { name: "Agent 权限" });
    for (const manifest of manifests) {
      const entry = panel.getByTestId(`local-entry-${manifest.id}-local`);
      await uiExpect(
        entry.getByRole("button", { name: "停止进程", exact: true }),
      ).toBeVisible();
      await uiExpect(
        entry.getByRole("button", {
          name: `撤销 ${manifest.name} 的本地执行`,
          exact: true,
        }),
      ).toBeVisible();
      const limitation = entry.getByText(
        "停止或撤销该入口后，它启动且已脱离其进程组的子进程可能继续运行。",
        { exact: true },
      );
      if (manifest.id === "engine-demo")
        await uiExpect(limitation).toBeVisible();
      else await uiExpect(limitation).toHaveCount(0);
    }
    await panel.getByTestId("local-entry-engine-demo-local").screenshot({
      path: path.join(root, ".artifacts/gate12/stop-disclosure.png"),
    });
  } finally {
    await app.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
