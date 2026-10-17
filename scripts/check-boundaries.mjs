import { posix, resolve } from "node:path";
import { API } from "typescript/unstable/sync";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import {
  SyntaxKind,
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isStringLiteralLikeNode,
} from "typescript/unstable/ast";

/** @param {string} file */
const eligible = (file) =>
  /^(?:modules\/sdk\/|extensions\/)/.test(file) &&
  /\.(?:ts|tsx|js|mjs)$/.test(file);

// Reuse the pinned TypeScript 7 parser. Its unstable API is confined to this
// development check; the in-memory project never writes source or build output.
/** @param {Array<[string, string]>} entries */
export function checkBoundaries(entries) {
  const files = entries.filter(([file]) => eligible(file));
  if (!files.length) return [];
  const config = resolve("tsconfig.boundaries.json");
  const virtualFiles = Object.fromEntries(
    files.map(([file, text]) => [resolve(file), text]),
  );
  virtualFiles[config] = JSON.stringify({
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
    fs: createVirtualFileSystem(virtualFiles),
  });
  const problems = [];
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProject(config);
    if (!project)
      throw Error("Boundary parser could not open its in-memory project");
    for (const [file] of files) {
      const path = resolve(file);
      const source = project.program.getSourceFile(path);
      if (!source) throw Error(`Boundary parser did not load ${file}`);
      const diagnostics = project.program.getSyntacticDiagnostics(path);
      for (const diagnostic of diagnostics) {
        const line =
          source.getLineAndCharacterOfPosition(diagnostic.pos).line + 1;
        problems.push(
          `${file}:${line}: parse error TS${diagnostic.code}: ${diagnostic.text}`,
        );
      }
      if (diagnostics.length) continue;
      /** @type {(node: import("typescript/unstable/ast").Node) => void} */
      const visit = (node) => {
        let target;
        if (isImportDeclaration(node) || isExportDeclaration(node))
          target = node.moduleSpecifier;
        else if (isExternalModuleReference(node)) target = node.expression;
        else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument))
          target = node.argument.literal;
        else if (
          isCallExpression(node) &&
          (node.expression.kind === SyntaxKind.ImportKeyword ||
            (isIdentifier(node.expression) &&
              node.expression.text === "require"))
        )
          target = node.arguments[0];
        if (
          target &&
          isStringLiteralLikeNode(target) &&
          /^(?:\.{1,2}\/|\/)/.test(target.text)
        ) {
          const destination = posix.normalize(
            target.text.startsWith("/")
              ? target.text.slice(1)
              : posix.join(posix.dirname(file), target.text),
          );
          if (
            /^(?:src|modules\/(?:shell|extension-host))(?:\/|$)/.test(
              destination,
            )
          ) {
            const line =
              source.getLineAndCharacterOfPosition(target.getStart()).line + 1;
            problems.push(`${file}:${line}: forbidden import ${target.text}`);
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

/** @param {string} file @param {string} text */
export function boundaryProblems(file, text) {
  return checkBoundaries([[file, text]]);
}
