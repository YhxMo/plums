import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PlumsError, type AgentLocalGrant } from "@plums/core";
import { SecureFsSink } from "./io.js";
import {
  collectConfiguration,
  renderConfiguration,
  type ConfigTool,
  type ReadConfig,
} from "./project-config.js";
const failure = () =>
  new PlumsError({
    code: "TIER_UNAVAILABLE",
    message: "隔离配置未能安全准备。",
    details: { reason: "PROJECT_CONFIGURATION_UNSAFE" },
  });
const helper = () => {
  const sibling = fileURLToPath(new URL("./secure-fs", import.meta.url));
  return existsSync(sibling)
    ? sibling
    : fileURLToPath(new URL("../dist/secure-fs", import.meta.url));
};
async function directory(root: string) {
  if (!path.isAbsolute(root) || path.normalize(root) !== root || root === "/")
    throw failure();
  let current = root;
  while (current !== "/") {
    const st = await lstat(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw failure();
    current = path.dirname(current);
  }
  if ((await realpath(root)) !== root) throw failure();
}
// Parse data only: never invoke git, a shell, includes, helpers or interpolations.
function parse(tool: ConfigTool, input: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  let section = "";
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    const header = line.match(/^\[([a-zA-Z]+)(?:\.([a-zA-Z0-9_-]+))?\]$/);
    if (header) {
      section = header[1]!.toLowerCase() + (header[2] ? "." + header[2] : "");
      continue;
    }
    if (line.startsWith("[")) {
      section = "";
      continue;
    }
    const pair = line.match(/^([^=\s]+)\s*=\s*(.*?)\s*$/);
    if (!pair) continue;
    let value = pair[2]!;
    if (/[\x00-\x1f\x7f]/.test(value) || /\$|`/.test(value)) continue;
    if (value.startsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(value);
        if (typeof decoded !== "string") continue;
        value = decoded;
      } catch {
        continue;
      }
    }
    const field =
      tool === "npm" ? pair[1]! : section ? section + "." + pair[1] : "";
    if (field) fields[field] = value;
  }
  return fields;
}
/** Explicit host operation; constructing a host or reading a tier plan does not read user files. */
export async function readProjectConfiguration(
  home: string,
): Promise<AgentLocalGrant["configuration"]> {
  try {
    await directory(home);
    const sink = new SecureFsSink(helper());
    const data: Record<ConfigTool, Record<string, string>> = {
      git: {},
      npm: {},
      cargo: {},
      pip: {},
    };
    const inputs: [ConfigTool, string][] = [
      ["git", ".gitconfig"],
      ["npm", ".npmrc"],
      ["cargo", ".cargo/config.toml"],
      ["pip", ".pip/pip.conf"],
      ["pip", ".config/pip/pip.conf"],
    ];
    for (const [tool, relative] of inputs) {
      const file = path.join(home, relative);
      try {
        await lstat(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const bytes = await sink.readConfiguration({
        rootPath: home,
        path: file,
      });
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      Object.assign(data[tool], parse(tool, text));
    }
    const reader: ReadConfig = {
      fields: async (tool) => Object.keys(data[tool]),
      read: async (tool, field) => data[tool][field],
    };
    return await collectConfiguration(reader);
  } catch {
    throw failure();
  }
}
/** Writes only host-filtered data using descriptor-relative atomic replacement. */
export async function writeProjectConfiguration(
  home: string,
  cargoHome: string,
  items: AgentLocalGrant["configuration"],
): Promise<Record<string, string>> {
  try {
    await directory(home);
    await directory(cargoHome);
    const pip = path.join(home, ".config", "pip");
    const sink = new SecureFsSink(helper());
    for (const relative of [".config", ".config/pip"])
      await sink.makeDirectory({
        rootPath: home,
        path: path.join(home, relative),
      });
    await directory(pip);
    const output = renderConfiguration(items);
    for (const [root, relative, text] of [
      [home, ".gitconfig", output.gitconfig],
      [home, ".npmrc", output.npmrc],
      [home, ".config/pip/pip.conf", output.pipConf],
      [cargoHome, "config.toml", output.cargoConfig],
    ] as const) {
      await sink.write({
        rootPath: root,
        path: path.join(root, relative),
        data: Buffer.from(text),
      });
    }
    return {
      HOME: home,
      GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      npm_config_userconfig: path.join(home, ".npmrc"),
      CARGO_HOME: cargoHome,
      PIP_CONFIG_FILE: path.join(pip, "pip.conf"),
      XDG_CONFIG_HOME: path.join(home, ".config"),
    };
  } catch {
    throw failure();
  }
}
