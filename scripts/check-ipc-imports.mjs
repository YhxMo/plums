import { posix, resolve } from "node:path";
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import {
  isImportDeclaration,
  isExportDeclaration,
  isNamedExports,
  isNamedImports,
  isStringLiteralLikeNode,
} from "typescript/unstable/ast";

/** Production native calls must use the generated contract, including aliased imports.
 * @param {Array<[string, string]>} entries
 */
export function checkIpcImports(entries) {
  const files = entries.filter(([file]) =>
    /^(?:src|modules|extensions)\/.*\.(?:ts|tsx|js|mjs)$/.test(file),
  );
  if (!files.length) return ["no production sources for IPC import check"];
  const config = resolve("tsconfig.ipc-imports.json");
  const virtual = Object.fromEntries(
    files.map(([file, source]) => [resolve(file), source]),
  );
  virtual[config] = JSON.stringify({
    compilerOptions: {
      noLib: true,
      noResolve: true,
      allowJs: true,
      jsx: "preserve",
    },
    files: files.map(([file]) => resolve(file)),
  });
  const api = new API({
    cwd: process.cwd(),
    fs: createVirtualFileSystem(virtual),
  });
  const problems = [];
  try {
    const project = api
      .updateSnapshot({ openProjects: [config] })
      .getProject(config);
    if (!project) throw Error("IPC import parser unavailable");
    for (const [file] of files) {
      if (file === "src/native/invoke.ts") continue;
      const source = project.program.getSourceFile(resolve(file));
      if (!source) throw Error(`IPC source unavailable: ${file}`);
      const diagnostics = project.program.getSyntacticDiagnostics(
        resolve(file),
      );
      for (const diagnostic of diagnostics)
        problems.push(`${file}: IPC parse error TS${diagnostic.code}`);
      if (diagnostics.length) continue;
      /** @param {import("typescript/unstable/ast").Node} node */
      const visit = (node) => {
        if (isStringLiteralLikeNode(node)) {
          const reference = node.text;
          const destination = reference.startsWith(".")
            ? posix.normalize(posix.join(posix.dirname(file), reference))
            : reference.replace(/^\//, "");
          const testBridge =
            destination.replace(/\.(?:ts|js)$/, "") ===
            "tests/fixtures/native-invoke";
          const core = reference === "@tauri-apps/api/core";
          const root =
            reference === "@tauri-apps/api" ||
            reference === "@tauri-apps/api/index";
          if (core || root || testBridge) {
            const parent = node.parent;
            const bindings = isImportDeclaration(parent)
              ? parent.importClause?.namedBindings
              : undefined;
            const namedImport =
              isImportDeclaration(parent) &&
              !parent.importClause?.name &&
              bindings &&
              isNamedImports(bindings)
                ? bindings.elements
                : undefined;
            const namedExport =
              isExportDeclaration(parent) &&
              parent.exportClause &&
              isNamedExports(parent.exportClause)
                ? parent.exportClause.elements
                : undefined;
            // Allow capability detection and package-root modules that do not expose core.
            // Namespace, wildcard and dynamic imports can expose invoke and are rejected.
            const allowed =
              !testBridge &&
              (core
                ? namedImport?.length &&
                  namedImport.every(
                    (entry) =>
                      (entry.propertyName ?? entry.name).text === "isTauri",
                  )
                : (namedImport ?? namedExport)?.every(
                    (entry) =>
                      (entry.propertyName ?? entry.name).text !== "core",
                  ));
            if (!allowed)
              problems.push(
                `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: native calls must use src/native/invoke.ts`,
              );
          }
        }
        node.forEachChild(visit);
      };
      visit(source);
    }
    return problems;
  } finally {
    api.close();
  }
}
