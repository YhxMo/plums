// Install explicitly before testing; readiness checks never import electron/index.js,
// whose fallback would download the runtime inside a test.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(
  new URL("../packages/desktop/package.json", import.meta.url),
);
export async function assertElectronReady({
  full = false,
  directory = path.dirname(require.resolve("electron/package.json")),
} = {}) {
  const { devDependencies } = JSON.parse(
    await readFile(
      new URL("../packages/desktop/package.json", import.meta.url),
      "utf8",
    ),
  );
  let executable;
  try {
    const relative = (
      await readFile(path.join(directory, "path.txt"), "utf8")
    ).trim();
    const expectedPath =
      process.platform === "darwin"
        ? "Electron.app/Contents/MacOS/Electron"
        : process.platform === "win32"
          ? "electron.exe"
          : "electron";
    if (relative !== expectedPath) throw Error("Unexpected Electron path");
    executable = path.join(directory, "dist", relative);
    await access(executable, constants.X_OK);
    const installed = (
      await readFile(path.join(directory, "dist/version"), "utf8")
    )
      .trim()
      .replace(/^v/, "");
    if (installed !== devDependencies.electron)
      throw Error("Electron version mismatch");
  } catch {
    throw Error(
      "Electron is not ready; run node scripts/prepare-electron.mjs before the tests",
    );
  }
  if (full) {
    const version = execFileSync(executable, ["--version"], {
      encoding: "utf8",
    })
      .trim()
      .replace(/^v/, "");
    if (version !== devDependencies.electron)
      throw Error("Electron executable version mismatch");
    if (process.platform === "darwin")
      execFileSync(
        "/usr/bin/codesign",
        ["--verify", "--deep", path.join(directory, "dist/Electron.app")],
        { stdio: "inherit" },
      );
  }
  return { executable, version: devDependencies.electron };
}
export async function prepareElectron() {
  const directory = path.dirname(require.resolve("electron/package.json"));
  // install.js otherwise trusts the extracted version cache. Rebuild from a ZIP
  // whose pinned checksums are verified by @electron/get, before local signing.
  await rm(path.join(directory, "dist"), { recursive: true, force: true });
  await rm(path.join(directory, "path.txt"), { force: true });
  execFileSync(process.execPath, [require.resolve("electron/install.js")], {
    stdio: "inherit",
    env: {
      ...process.env,
      electron_use_remote_checksums: "",
      npm_config_electron_use_remote_checksums: "",
      electron_config_cache:
        process.env.ELECTRON_CACHE ??
        process.env.electron_config_cache ??
        path.resolve(".build-cache/electron-cache"),
    },
  });
  if (process.platform === "darwin") {
    // The official development ZIP omits resource signature envelopes. This is
    // a local test signature, not publisher identity or notarization evidence.
    execFileSync(
      "/usr/bin/codesign",
      [
        "--force",
        "--deep",
        "--sign",
        "-",
        path.join(directory, "dist/Electron.app"),
      ],
      { stdio: "inherit" },
    );
  }
  console.log(
    JSON.stringify({
      ...(await assertElectronReady({ full: true })),
      signing:
        process.platform === "darwin"
          ? "local-ad-hoc-after-verified-extraction"
          : "not-applicable",
    }),
  );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await prepareElectron();
