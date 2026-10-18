import { posix } from "node:path";
import ts from "typescript";
import { lineOf, parseSources } from "./parse-sources.mjs";

/** Production native calls must use the generated contract, including aliased imports.
 * @param {Array<[string, string]>} entries
 */
export function checkIpcImports(entries) {
  const files = entries.filter(([file]) =>
    /^(?:src|modules|extensions)\/.*\.(?:ts|tsx|js|mjs)$/.test(file),
  );
  if (!files.length) return ["no production sources for IPC import check"];
  const problems = [];
  for (const { file, source, errors } of parseSources(files)) {
    if (file === "src/native/invoke.ts") continue;
    for (const error of errors) problems.push(`IPC ${error}`);
    if (errors.length) continue;
    /** @param {ts.Node} node */
    const visit = (node) => {
      if (ts.isStringLiteralLike(node)) {
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
          const bindings = ts.isImportDeclaration(parent)
            ? parent.importClause?.namedBindings
            : undefined;
          const namedImport =
            ts.isImportDeclaration(parent) &&
            !parent.importClause?.name &&
            bindings &&
            ts.isNamedImports(bindings)
              ? bindings.elements
              : undefined;
          const namedExport =
            ts.isExportDeclaration(parent) &&
            parent.exportClause &&
            ts.isNamedExports(parent.exportClause)
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
                  (entry) => (entry.propertyName ?? entry.name).text !== "core",
                ));
          if (!allowed)
            problems.push(
              `${file}:${lineOf(source, node)}: native calls must use src/native/invoke.ts`,
            );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return problems;
}
