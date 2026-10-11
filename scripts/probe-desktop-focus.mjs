import { _electron as electron } from "@playwright/test";
import { cp, mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Manual diagnostic: activation requests do not replace the native focus guard.
if (process.platform !== "darwin") throw Error("This probe requires macOS.");
const output = path.resolve(
  process.argv[2] ?? ".build-cache/native-diagnostics/focus-matrix.json",
);
const installed = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const require = createRequire(path.resolve("packages/desktop/package.json"));
const reports = [];
await mkdir(path.dirname(output), { recursive: true });
for (const mode of [
  "file",
  "directory",
  "regular",
  "native",
  ...(installed ? ["packaged"] : []),
]) {
  const root = await mkdtemp("/private/tmp/plums-focus-diagnostic-");
  let application;
  const report = { mode };
  try {
    const helper = path.join(root, "focus-probe");
    execFileSync(
      "/usr/bin/clang",
      [
        "-framework",
        "AppKit",
        "-Wno-deprecated-declarations",
        path.resolve("packages/desktop/test/fixtures/focus-probe.m"),
        "-o",
        helper,
      ],
      { timeout: 10000 },
    );
    await cp("packages/desktop/dist", path.join(root, "dist"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ type: "module", main: "dist/main.js" }),
    );
    await mkdir(path.join(root, "node_modules"));
    for (const [name, owner] of [
      ["better-sqlite3", "core"],
      ["isolated-vm", "host"],
    ]) {
      const dependency = createRequire(
        path.resolve(`packages/${owner}/package.json`),
      );
      await symlink(
        path.dirname(dependency.resolve(`${name}/package.json`)),
        path.join(root, "node_modules", name),
      );
    }
    application = await electron.launch({
      executablePath:
        mode === "packaged"
          ? path.join(installed, "Contents/MacOS/Plums")
          : require("electron"),
      args:
        mode === "packaged"
          ? []
          : [mode === "directory" ? root : path.join(root, "dist/main.js")],
      env: {
        ...process.env,
        PLUMS_NODE: process.execPath,
        PLUMS_DATA_DIR: path.join(root, "profile"),
      },
      timeout: 10000,
    });
    const page = await application.firstWindow();
    await page.getByTestId("nav-tab-home").waitFor({ timeout: 5000 });
    const pid = await application.evaluate(() => process.pid);
    const native = (action) =>
      JSON.parse(
        execFileSync(helper, [String(pid), ...(action ? [action] : [])], {
          encoding: "utf8",
          timeout: 2000,
        }),
      );
    const state = () =>
      application.evaluate(({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return {
          visible: window.isVisible(),
          focused: window.isFocused(),
          focusable: window.isFocusable(),
          fullscreen: window.isFullScreen(),
          packaged: app.isPackaged,
        };
      });
    report.before = { window: await state(), native: native() };
    if (mode === "regular")
      await application.evaluate(({ app }) =>
        app.setActivationPolicy("regular"),
      );
    await application.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
      app.focus({ steal: true });
    });
    if (mode === "native") report.activation = native("activate");
    const began = Date.now();
    do {
      if ((await state()).focused) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() - began < 5000);
    report.after = {
      window: await state(),
      native: native(),
      ms: Date.now() - began,
    };
    report.status = report.after.window.focused
      ? "focused"
      : "FOCUS_NOT_GRANTED";
  } catch (error) {
    report.status = "PROBE_FAILED";
    report.reason = error.message.startsWith("Process failed to launch")
      ? "LAUNCH_FAILED"
      : "PROBE_ERROR";
  } finally {
    await application?.close();
    await rm(root, { recursive: true, force: true });
    reports.push(report);
    await writeFile(
      output,
      JSON.stringify({ ready: false, focusBudgetMs: 5000, reports }, null, 2) +
        "\n",
    );
  }
  console.log(JSON.stringify(report));
}
