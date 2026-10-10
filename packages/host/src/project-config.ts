import type { AgentLocalGrant } from "@plumsjs/core";

export const ALLOWED_FIELDS = {
  git: [
    "user.name",
    "user.email",
    "init.defaultBranch",
    "core.autocrlf",
    "core.eol",
    "pull.rebase",
  ],
  npm: ["registry"],
  cargo: [],
  pip: ["global.index-url", "global.extra-index-url", "global.trusted-host"],
} as const;
export type ConfigTool = keyof typeof ALLOWED_FIELDS;
export interface ReadConfig {
  read(tool: ConfigTool, field: string): Promise<string | undefined>;
  /** Optional discovery of scoped registries and named cargo registries/sources. */
  fields?(tool: ConfigTool): Promise<readonly string[]>;
}
const scoped = /^@[a-z0-9-~][a-z0-9-._~]*:registry$/;
const cargo =
  /^(registries\.[a-zA-Z0-9_-]+\.index|source\.[a-zA-Z0-9_-]+\.(replace-with|registry))$/;
const forbidden =
  /^(include|alias\.|credential\.|core\.(sshCommand|hooksPath)$|url\..*\.insteadOf$|http\..*\.extraHeader$|_auth|_password|\/\/)/i;
function allowed(tool: ConfigTool, field: string) {
  return (
    !forbidden.test(field) &&
    ((ALLOWED_FIELDS[tool] as readonly string[]).includes(field) ||
      (tool === "npm" && scoped.test(field)) ||
      (tool === "cargo" && cargo.test(field)))
  );
}
export function acceptable(field: string, value: string): boolean {
  if (
    forbidden.test(field) ||
    /[\x00-\x1f\x7f]/.test(value) ||
    value.length > 4096
  )
    return false;
  for (const part of value.split(/\s+/)) {
    if (!part.includes("://")) continue;
    try {
      const url = new URL(part);
      if (
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some((key) =>
          /token|auth|key|secret|password/i.test(key),
        )
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
export async function collectConfiguration(
  reader: ReadConfig,
): Promise<AgentLocalGrant["configuration"]> {
  const items: AgentLocalGrant["configuration"] = [];
  for (const tool of Object.keys(ALLOWED_FIELDS) as ConfigTool[]) {
    const fields = [
      ...new Set([
        ...ALLOWED_FIELDS[tool],
        ...((await reader.fields?.(tool)) ?? []),
      ]),
    ].sort();
    for (const field of fields) {
      if (!allowed(tool, field)) continue;
      const value = await reader.read(tool, field);
      if (value !== undefined && acceptable(field, value))
        items.push({ tool, field, value });
    }
  }
  return items;
}
/** Revalidate stored values at rendering too; never trust an imported/raw grant. */
export function renderConfiguration(items: AgentLocalGrant["configuration"]): {
  gitconfig: string;
  npmrc: string;
  cargoConfig: string;
  pipConf: string;
} {
  const output = { gitconfig: "", npmrc: "", cargoConfig: "", pipConf: "" };
  const sections = new Map<string, string[]>();
  for (const { tool, field, value } of items) {
    if (
      !Object.hasOwn(ALLOWED_FIELDS, tool) ||
      !allowed(tool as ConfigTool, field) ||
      !acceptable(field, value)
    )
      continue;
    if (tool === "npm") output.npmrc += `${field}=${value}\n`;
    else if (tool === "git") {
      const [section, key] = field.split(".");
      output.gitconfig += `[${section}]\n\t${key} = ${JSON.stringify(value)}\n`;
    } else if (tool === "pip") {
      const lines = sections.get("pip") ?? [];
      lines.push(`${field.slice(7)} = ${value}`);
      sections.set("pip", lines);
    } else {
      const [section, name, key] = field.split(".");
      const header = `${section}.${JSON.stringify(name)}`,
        lines = sections.get(header) ?? [];
      lines.push(`${key} = ${JSON.stringify(value)}`);
      sections.set(header, lines);
    }
  }
  for (const [section, lines] of sections) {
    if (section === "pip") output.pipConf = `[global]\n${lines.join("\n")}\n`;
    else output.cargoConfig += `[${section}]\n${lines.join("\n")}\n`;
  }
  return output;
}
