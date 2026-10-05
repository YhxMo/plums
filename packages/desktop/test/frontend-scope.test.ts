import { it, expect } from "vitest";
import { _electron as electron, expect as uiExpect } from "@playwright/test";
import { createRequire } from "node:module";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  cp,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArchive, MemorySecretStore, type ManifestV2 } from "@plums/core";
import { DesktopHost } from "../../host/src/host.js";

it("frontend cancel cannot restore implicit reads through main IPC, broker and a rebuilt host core", async () => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "plums-frontend-scope-"),
  );
  const dataDir = path.join(temporary, "profile");
  const sinkLog = path.join(temporary, "sink.jsonl");
  const host = new DesktopHost({
    dataDir,
    secretStore: () => new MemorySecretStore(),
  });
  await host.initialize();
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    id: "files",
    kind: "extension",
    name: "Files",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [
      {
        id: "files",
        kind: "fs",
        target: "agent-data",
        operations: ["read", "list", "write"],
        reason: "Synthetic file test",
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "1",
        frontend: "index.html",
        runtime: "main.js",
        contributes: {
          commands: ["read", "list", "write"].map((name) => ({
            name,
            title: name,
          })),
        },
      },
    },
  };
  const preview = (await host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "index.html": Buffer.from(
        "<!doctype html><title>Scope fixture</title><p>File commands</p>",
      ),
      "main.js": Buffer.from(
        `export function activate(s){for(const operation of ['read','list','write'])s.register('commands',operation,()=>s.capability('files',{kind:'fs',operation,path:operation==='list'?'.':'task.txt',...(operation==='write'?{data:[1]}:{})}));}`,
      ),
    }),
  )) as { token: string };
  const item = await host.importLibrary(preview.token);
  const agent = await host.createAgent("Scope fixture", [item.digest]);
  await host.enable(agent.instanceId, "files");
  await host.setStartup(agent.instanceId, "files");
  host.close();
  await writeFile(
    path.join(dataDir, "instances", agent.instanceId, "agent-data", "task.txt"),
    "synthetic",
  );
  await writeFile(sinkLog, "");
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
    const require = createRequire(
      path.resolve(`packages/${owner}/package.json`),
    );
    await symlink(
      path.dirname(require.resolve(`${name}/package.json`)),
      path.join(temporary, "node_modules", name!),
    );
  }
  // Instrument only the disposable packaged fixture at the I/O edge. The real
  // main/preload, broker IPC, DesktopHost, runtime/SDK and core remain in use.
  // A recording sink makes a bypass observable even on Linux (no macOS helper).
  const brokerPath = path.join(temporary, "dist/broker.mjs");
  const broker = await readFile(brokerPath, "utf8");
  const marker = "new DesktopHost({";
  expect(broker.split(marker)).toHaveLength(2);
  await writeFile(
    brokerPath,
    `import {appendFileSync as recordSink} from 'node:fs';\n` +
      broker.replace(
        marker,
        `${marker}
    fs: Object.fromEntries(['read','list','write'].map(operation => [operation, async () => {
      recordSink(${JSON.stringify(sinkLog)}, JSON.stringify({operation})+'\\n');
      return operation === 'read' ? new Uint8Array() : operation === 'list' ? [] : undefined;
    }])),`,
      ),
  );
  const require = createRequire(path.resolve("packages/desktop/package.json"));
  const application = await electron.launch({
    executablePath: require("electron"),
    args: [path.join(temporary, "dist/main.js")],
    env: {
      ...process.env,
      PLUMS_NODE: process.execPath,
      PLUMS_DATA_DIR: dataDir,
    },
  });
  try {
    const manager = await application.firstWindow();
    await manager.getByTestId("nav-tab-home").waitFor();
    await manager.evaluate((instanceId) => {
      void window.manager.call("openAgent", { instanceId }).catch((error) => {
        (window as any).openError = error;
      });
    }, agent.instanceId);
    const confirmation = async () => {
      await expect
        .poll(
          async () =>
            (await manager.evaluate(() => (window as any).openError)) ??
            application.windows().some((p) => p.url().endsWith("confirm.html")),
          { timeout: 5000 },
        )
        .toBe(true);
      const page = application
        .windows()
        .find((p) => p.url().endsWith("confirm.html"))!;
      await page.getByRole("alertdialog").waitFor();
      await page.bringToFront();
      await application.evaluate(({ app, BrowserWindow }) => {
        app.focus({ steal: true });
        BrowserWindow.getAllWindows()
          .find((window) => window.getTitle() === "Plums · 安全确认")
          ?.focus();
      });
      return page;
    };
    const task = await confirmation();
    await task
      .getByLabel("Files · agent-data · 读取", { exact: true })
      .uncheck();
    await task
      .getByLabel("Files · agent-data · 列出", { exact: true })
      .uncheck();
    await uiExpect(task.getByTestId("confirm-allow")).toBeEnabled();
    await task.getByTestId("confirm-allow").click();
    const frontend = async (script: string) =>
      application.evaluate(async ({ webContents }, script) => {
        const view = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith("plums-agent://"));
        if (!view) return undefined;
        return view.executeJavaScript(script);
      }, script);
    await expect
      .poll(
        async () =>
          (await manager.evaluate(() => (window as any).openError)) ??
          (await frontend("typeof window.plums")),
        { timeout: 5000 },
      )
      .toBe("object");
    const sinkRecords = async () =>
      (await readFile(sinkLog, "utf8"))
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    await frontend("window.plums.invoke('commands','write',{})");
    expect(await sinkRecords()).toEqual([{ operation: "write" }]);
    const audit = () =>
      manager.evaluate(
        async (instanceId) =>
          (await window.manager.call("audit", { instanceId })) as any[],
        agent.instanceId,
      );
    const approved = (await audit()).find(
      (e) => e.phase === "task" && e.outcome === "allowed",
    );
    expect(approved?.taskId).toEqual(expect.any(String));
    await frontend("window.plums.cancel()");

    // The same frontend is intentionally still usable after cancel. A fresh
    // host execution core must apply desktop policy before its first read/list.
    for (const operation of ["read", "list"]) {
      await frontend(
        `void (window.scopeResult = undefined, window.plums.invoke('commands',${JSON.stringify(operation)},{}).then(() => window.scopeResult = 'UNEXPECTED_ALLOW', error => window.scopeResult = error.code))`,
      );
      const prompt = await confirmation();
      await uiExpect(prompt.locator('[data-kind="capability"]')).toBeVisible();
      await prompt.getByRole("button", { name: "不允许", exact: true }).click();
      await expect
        .poll(() => frontend("window.scopeResult"))
        .toBe("CONFIRMATION_DENIED");
      expect(await sinkRecords()).toEqual([{ operation: "write" }]);
    }
    expect(
      (await audit()).some(
        (e) =>
          e.phase === "task" &&
          e.reason === "TASK_REVOKED" &&
          e.taskId === approved.taskId,
      ),
    ).toBe(true);
  } finally {
    await application.close();
    await rm(temporary, { recursive: true, force: true });
  }
}, 30_000);
