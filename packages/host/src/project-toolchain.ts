import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { LocalToolchain } from "@plums/core";
import { PROJECT_EXCLUDED } from "./project-profile.js";

export interface DetectedToolchain {
  name: LocalToolchain;
  root: string;
  executable: string;
  found: boolean;
  reason?: "NOT_FOUND" | "UNSAFE_ROOT";
}
export interface ToolchainProbe {
  which(name: string, env: { PATH: string }): Promise<string | undefined>;
  realpath(file: string): Promise<string>;
  shellPath(): Promise<string>;
}
const run = promisify(execFile);
const commands: Record<LocalToolchain, string> = {
  node: "node",
  git: "git",
  rust: "rustc",
  python: "python3",
  go: "go",
};
const within = (root: string, file: string) =>
  file === root || file.startsWith(root + path.sep);

/** A version manager's shim directory is never an installation root. */
export function minimalRoot(
  name: LocalToolchain,
  executable: string,
): string | undefined {
  if (
    !path.isAbsolute(executable) ||
    path.normalize(executable) !== executable ||
    /[\x00-\x1f\x7f]/.test(executable)
  )
    return;
  if (name === "git") {
    const clt = "/Library/Developer/CommandLineTools";
    if (within(clt, executable)) return clt;
    const cellar = executable.match(
      /^(\/opt\/homebrew\/Cellar\/git\/[^/]+)\/bin\/git$/,
    );
    if (cellar) return cellar[1];
  }
  if (path.basename(path.dirname(executable)) !== "bin") return;
  const root = path.dirname(path.dirname(executable));
  if (root === path.parse(root).root) return;
  if (name === "rust" && !/\/\.rustup\/toolchains\/[^/]+$/.test(root)) return;
  if (
    name === "python"
      ? !/^python(?:\d+(?:\.\d+)*)?$/.test(path.basename(executable))
      : path.basename(executable) !== commands[name]
  )
    return;
  return root;
}

export function systemToolchainProbe(): ToolchainProbe {
  const find = async (name: string, env: { PATH: string }) => {
    for (const directory of env.PATH.split(path.delimiter).filter(
      path.isAbsolute,
    )) {
      const file = path.join(directory, name);
      try {
        await access(file, constants.X_OK);
        return file;
      } catch {
        /* Try the next PATH entry. */
      }
    }
  };
  return {
    realpath,
    async shellPath() {
      // Inspect the host's search path without executing a user's startup files.
      // This string is used for discovery only, never passed to an author process.
      return (
        process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
      );
    },
    async which(name, env) {
      if (name === "rustc") {
        const rustup = await find("rustup", env);
        if (!rustup) return;
        try {
          return (
            await run(rustup, ["which", "rustc"], {
              timeout: 3000,
              maxBuffer: 4096,
              env,
            })
          ).stdout.trim();
        } catch {
          return;
        }
      }
      const found = await find(name, env);
      if (name !== "go" || !found) return found;
      try {
        const root = (
          await run(found, ["env", "GOROOT"], {
            timeout: 3000,
            maxBuffer: 4096,
            env,
          })
        ).stdout.trim();
        return path.isAbsolute(root) ? path.join(root, "bin", "go") : undefined;
      } catch {
        return;
      }
    },
  };
}

export async function detectToolchains(
  names: readonly LocalToolchain[],
  opts: { homeDir: string; probe?: ToolchainProbe },
): Promise<DetectedToolchain[]> {
  if (!names.length) return [];
  const probe = opts.probe ?? systemToolchainProbe();
  const home = path.resolve(opts.homeDir);
  let PATH = "";
  try {
    PATH = await probe.shellPath();
  } catch {
    /* Missing tools remain unavailable. */
  }
  return Promise.all(
    [...new Set(names)].map(async (name) => {
      const missing: DetectedToolchain = {
        name,
        root: "",
        executable: "",
        found: false,
        reason: "NOT_FOUND",
      };
      try {
        const file = await probe.which(commands[name], { PATH });
        if (!file) return missing;
        const executable = await probe.realpath(file),
          root = minimalRoot(name, executable);
        if (
          !root ||
          within(root, home) ||
          PROJECT_EXCLUDED.some(
            (p) =>
              within(root, path.join(home, p)) ||
              within(path.join(home, p), root),
          )
        )
          return { ...missing, reason: "UNSAFE_ROOT" as const };
        if (name === "rust")
          await probe.realpath(path.join(root, "bin", "cargo"));
        return { name, root, executable, found: true };
      } catch {
        return missing;
      }
    }),
  );
}
