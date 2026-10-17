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

// Each checked layer may import only downward. Business modules and src/ are
// composition-root code and are deliberately not origins here.
const business = String.raw`modules\/(?:agents|text-workbench)`;
/** @type {Array<[RegExp, RegExp]>} origin -> forbidden destination */
const layers = [
  [
    /^modules\/sdk\//,
    /^(?:src|extensions|modules\/(?!sdk(?:\/|$))[^/]+)(?:\/|$)/,
  ],
  [
    /^modules\/extension-host\//,
    new RegExp(
      String.raw`^(?:src|extensions|modules\/shell|${business})(?:\/|$)`,
    ),
  ],
  [
    /^modules\/shell\//,
    new RegExp(String.raw`^(?:src|extensions|${business})(?:\/|$)`),
  ],
  [
    /^extensions\//,
    new RegExp(
      String.raw`^(?:src|modules\/(?:shell|extension-host)|${business})(?:\/|$)`,
    ),
  ],
];
/** @param {string} file */
const forbiddenFor = (file) =>
  /\.(?:ts|tsx|js|mjs)$/.test(file)
    ? layers.find(([origin]) => origin.test(file))?.[1]
    : undefined;
/** @param {string} file */
const eligible = (file) => forbiddenFor(file) !== undefined;

// Reuse the pinned TypeScript 7 parser. Its unstable API is confined to this
// development check; the in-memory project never writes source or build output.
/** @param {Array<[string, string]>} entries */
export function checkBoundaries(entries) {
  const files = entries.filter(([file]) => eligible(file));
  if (!files.length)
    return [
      "no eligible SDK/kernel/extension source files for import boundary check",
    ];
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
      const forbidden = /** @type {RegExp} */ (forbiddenFor(file));
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
          if (forbidden.test(destination)) {
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
  // Unit callers pass arbitrary files to probe the visitor; ineligible files
  // mean "nothing to check here" rather than an empty gate run.
  if (!eligible(file)) return [];
  return checkBoundaries([[file, text]]);
}
