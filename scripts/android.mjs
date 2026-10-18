import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAndroid } from "./android-project.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const toolsRoot = process.env.PLUMS_ANDROID_TOOLS_ROOT;
const args = process.argv.slice(2);
function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}
try {
  if (!toolsRoot || !existsSync(join(toolsRoot, "env.sh")))
    throw new Error(
      "Set PLUMS_ANDROID_TOOLS_ROOT to the existing YHX Android toolchain",
    );
  if (args[0] !== "--configured") {
    // Source only in this child process; positional arguments preserve spaces.
    run("/bin/zsh", [
      "-c",
      'source "$1/env.sh" && shift && exec "$@"',
      "plums-android",
      toolsRoot,
      process.execPath,
      fileURLToPath(import.meta.url),
      "--configured",
      ...args,
    ]);
  } else {
    const action = args[1];
    if (!["init", "prepare", "build"].includes(action) || args.length !== 2)
      throw new Error("Usage: android.mjs init | prepare | build");
    const env = {
      ...process.env,
      CARGO_BUILD_JOBS: "4",
      CARGO_TARGET_DIR: resolve(root, ".cache/android/target"),
      PLUMS_ANDROID_DEBUG_KEYSTORE: resolve(
        root,
        ".cache/android/debug.keystore",
      ),
    };
    delete env.PLUMS_DATA_DIR;
    const cli = ["node_modules/@tauri-apps/cli/tauri.js", "android"];
    if (action === "init") {
      if (existsSync(join(root, "src-tauri/gen/android")))
        throw new Error("Android project already exists; use android:prepare");
      run(process.execPath, [...cli, "init", "--skip-targets-install"], env);
    }
    prepareAndroid(root, toolsRoot);
    if (action === "build") {
      if (!existsSync(env.PLUMS_ANDROID_DEBUG_KEYSTORE)) {
        mkdirSync(resolve(root, ".cache/android"), { recursive: true });
        run(
          join(env.JAVA_HOME, "bin/keytool"),
          [
            "-genkeypair",
            "-keystore",
            env.PLUMS_ANDROID_DEBUG_KEYSTORE,
            "-storepass",
            "android",
            "-keypass",
            "android",
            "-alias",
            "androiddebugkey",
            "-dname",
            "CN=Plums Local Debug",
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "10000",
            "-noprompt",
          ],
          env,
        );
      }
      run(
        process.execPath,
        [
          ...cli,
          "build",
          "--debug",
          "--target",
          "aarch64",
          "--apk",
          "--",
          "--locked",
        ],
        env,
      );
    }
    console.log(
      `Android ${action} complete (locked CLI; local generated project).`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
