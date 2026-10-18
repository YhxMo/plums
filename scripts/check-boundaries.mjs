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

// Repository-relative imports must stay in an explicitly allowed layer.
// Business modules and app composition roots are not origins here.
/** @type {Array<[RegExp, RegExp]>} origin -> allowed destination */
const layers = [
  [/^modules\/sdk\//, /^modules\/sdk(?:\/|$)/],
  [/^modules\/extension-host\//, /^modules\/(?:sdk|extension-host)(?:\/|$)/],
  [/^modules\/shell\//, /^modules\/(?:sdk|extension-host|shell)(?:\/|$)/],
  [/^extensions\//, /^(?:extensions|modules\/sdk)(?:\/|$)/],
  [
    /^src\/shell\//,
    /^(?:modules\/(?:sdk|extension-host|shell)(?:\/|$)|src\/(?:shell|components|features\/extensions)(?:\/|$)|src\/(?:platform|credentials)(?:\.ts)?$)/,
  ],
];
/** @param {string} file */
const allowedFor = (file) =>
  /\.(?:ts|tsx|js|mjs)$/.test(file)
    ? layers.find(([origin]) => origin.test(file))?.[1]
    : undefined;
/** @param {string} file */
const eligible = (file) => allowedFor(file) !== undefined;

const generic = /^(?:modules\/(?:shell|extension-host)|src\/shell)\//;
const agentContract = /^modules\/sdk\/agents(?:\.[cm]?[jt]sx?|\/|$)/;
const businessViewIds = new Set([
  "agents",
  "default",
  "board",
  "text-workbench",
  "broken",
  "role-settings",
]);

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
  /** @type {Map<string, Array<{destination: string, target: string, line: number}>>} */
  const imports = new Map();
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
      const allowed = /** @type {RegExp} */ (allowedFor(file));
      /** @type {Array<{destination: string, target: string, line: number}>} */
      const edges = [];
      imports.set(file, edges);
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
          /^(?:\.{1,2}(?:\/|$)|\/)/.test(target.text)
        ) {
          const destination = posix.normalize(
            target.text.startsWith("/")
              ? target.text.slice(1)
              : posix.join(posix.dirname(file), target.text),
          );
          const line =
            source.getLineAndCharacterOfPosition(target.getStart()).line + 1;
          edges.push({ destination, target: target.text, line });
          if (
            !allowed.test(destination) ||
            (generic.test(file) && agentContract.test(destination))
          )
            problems.push(`${file}:${line}: forbidden import ${target.text}`);
        }
        if (
          generic.test(file) &&
          isStringLiteralLikeNode(node) &&
          businessViewIds.has(node.text)
        ) {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          problems.push(
            `${file}:${line}: business view id ${node.text} belongs to application composition`,
          );
        }
        node.forEachChild(visit);
      };
      visit(source);
    }
    // A new SDK barrel must not smuggle business contracts into generic layers.
    // Resolve only repository sources already supplied to this gate, without I/O.
    const sourceFiles = new Set(files.map(([file]) => file));
    /** @param {string} destination */
    const sourceFor = (destination) =>
      [
        destination,
        ...[".ts", ".tsx", ".js", ".mjs"].flatMap((ext) => [
          destination + ext,
          destination + "/index" + ext,
        ]),
        destination.replace(/\.[cm]?js$/, ".ts"),
      ].find((path) => sourceFiles.has(path));
    /** @param {string} destination @param {Set<string>} [visited] @returns {boolean} */
    const reachesAgents = (destination, visited = new Set()) => {
      if (agentContract.test(destination)) return true;
      if (!/^modules\/sdk(?:\/|$)/.test(destination)) return false;
      const file = sourceFor(destination.replace(/\/$/, ""));
      if (!file || visited.has(file)) return false;
      visited.add(file);
      return (imports.get(file) ?? []).some((edge) =>
        reachesAgents(edge.destination, visited),
      );
    };
    for (const [file, edges] of imports) {
      if (!generic.test(file)) continue;
      for (const edge of edges)
        if (
          !agentContract.test(edge.destination) &&
          reachesAgents(edge.destination)
        )
          problems.push(
            `${file}:${edge.line}: forbidden import ${edge.target} (Agent contract via SDK)`,
          );
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
