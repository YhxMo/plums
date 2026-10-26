import { readComposition, type Composition } from "@modules/shell/composition";
import type { ImportedExtension } from "@modules/shell/uninstall";
import { ContractError } from "@modules/sdk/errors";
import {
  isPackageImport,
  isRetiredFileImport,
} from "@modules/shell/extension-package";
import {
  array,
  object,
  optional,
  sameOrigin,
  string,
} from "@modules/sdk/validation";

// Preserve opaque fields and legacy layout intent, including absent page preferences.
export type Preferences = Record<string, unknown> & {
  version: 1;
  layout: string;
  layoutIntent?: unknown;
  theme: "system" | "light" | "dark";
  themeId: string | null;
  imports: ImportedExtension[];
  configurations: Record<string, unknown>;
  pages?: Record<string, string>;
  composition?: Composition;
};
export function checkImportIds(
  imports: ImportedExtension[],
  catalog: ImportedExtension[],
) {
  if (
    imports.some((entry) => catalog.some((builtIn) => builtIn.id === entry.id))
  )
    throw new ContractError("state.imports", "imports.entry.id");
}
export function parsePersistedState(input: unknown): Preferences {
  const value =
    input === undefined
      ? {}
      : object(input, "state.version", { path: "version" });
  if (input !== undefined && value.version !== 1)
    throw new ContractError("state.version", "version");
  const composition = readComposition(value.composition);
  const pages = optional(value.pages, (v) => {
    const pages = object(v, "state.corrupt", { path: "pages" });
    for (const [key, route] of Object.entries(pages))
      string(route, "state.corrupt", { path: `pages.${key}` });
    return Object.assign(Object.create(null), pages) as Record<string, string>;
  });
  const configurations = Object.assign(
    Object.create(null),
    optional(value.configurations, (v) =>
      object(v, "state.corrupt", { path: "configurations" }),
    ) ?? {},
  ) as Record<string, unknown>;
  const seen = new Set<string>();
  const imports =
    optional(value.imports, (v) =>
      array(
        v,
        "state.imports",
        (v, path) => {
          const entry = object(v, "state.imports", { path });
          const id = string(entry.id, "state.imports", { path: `${path}.id` });
          const url = string(entry.url, "state.imports", {
            path: `${path}.url`,
          });
          string(entry.label, "state.imports", { path: `${path}.label` });
          if (
            !isPackageImport(url) &&
            !isRetiredFileImport(url) &&
            !sameOrigin(url, location.href)
          )
            throw new ContractError("state.imports", `${path}.url`);
          if (seen.has(id))
            throw new ContractError("state.imports", `${path}.id`);
          seen.add(id);
          return entry as ImportedExtension;
        },
        { path: "imports" },
      ),
    ) ?? [];
  return {
    ...value,
    version: 1,
    layout: typeof value.layout === "string" ? value.layout : "",
    theme:
      value.theme === "light" || value.theme === "dark"
        ? value.theme
        : "system",
    themeId: typeof value.themeId === "string" ? value.themeId : null,
    imports,
    configurations,
    ...(composition === undefined ? {} : { composition }),
    ...(pages === undefined ? {} : { pages }),
  };
}
