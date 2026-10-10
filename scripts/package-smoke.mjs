import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { _electron } from "@playwright/test";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function smokeResult(version, ms, appPath) {
  return { ok: true, version, ms: Math.round(ms), appPath };
}
export async function packageSmoke(applicationPath) {
  if (!applicationPath)
    throw Error("Usage: node scripts/package-smoke.mjs <Plums.app path>");
  const appPath = path.resolve(applicationPath);
  const executablePath = path.join(appPath, "Contents/MacOS/Plums");
  try {
    if (
      !appPath.endsWith(".app") ||
      !(await stat(appPath)).isDirectory() ||
      !(await stat(executablePath)).isFile()
    )
      throw Error("Invalid application");
  } catch {
    throw Error(`Packaged Plums.app executable not found: ${executablePath}`);
  }
  const { version: expectedVersion } = JSON.parse(
    await readFile(
      path.join(repository, "packages/desktop/package.json"),
      "utf8",
    ),
  );
  const profile = await mkdtemp(path.join(os.tmpdir(), "plums-package-smoke-"));
  const start = performance.now(),
    deadline = start + 20_000;
  const remaining = () => {
    const timeout = deadline - performance.now();
    if (timeout <= 0)
      throw Error("Packaged app did not become ready within 20 seconds");
    return Math.ceil(timeout);
  };
  let app;
  try {
    app = await _electron.launch({
      executablePath,
      args: [`--user-data-dir=${profile}`],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: profile,
        TMPDIR: profile,
        PLUMS_DATA_DIR: profile,
      },
      timeout: remaining(),
    });
    const child = app.process();
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    const window = await app.firstWindow({ timeout: remaining() });
    await window
      .locator("#root")
      .waitFor({ state: "visible", timeout: remaining() });
    const metadata = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      profile: app.getPath("userData"),
    }));
    if (metadata.version !== expectedVersion)
      throw Error(
        `Package version ${metadata.version} differs from ${expectedVersion}`,
      );
    // macOS may canonicalize /var to /private/var; check the actual directory identity.
    const { realpath } = await import("node:fs/promises");
    if ((await realpath(metadata.profile)) !== (await realpath(profile)))
      throw Error("Packaged application ignored the isolated data directory");
    if (!/Plums/i.test(await window.title()))
      throw Error("Packaged application has no Plums window title");
    remaining();
    await app.close();
    app = undefined;
    const { code, signal } = await exited;
    if (code !== 0 || signal)
      throw Error(`Packaged app exited with code ${code}, signal ${signal}`);
    return smokeResult(metadata.version, performance.now() - start, appPath);
  } finally {
    try {
      if (app) await app.close();
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw Error("Usage: node scripts/package-smoke.mjs <Plums.app path>");
    console.log(JSON.stringify(await packageSmoke(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
