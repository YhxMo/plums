import { posix } from "node:path";
import ts from "typescript";
import { lineOf, parseSources } from "./parse-sources.mjs";

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

/** @param {Array<[string, string]>} entries */
export function checkBoundaries(entries) {
  const files = entries.filter(([file]) => eligible(file));
  if (!files.length)
    return [
      "no eligible SDK/kernel/extension source files for import boundary check",
    ];
  const problems = [];
  /** @type {Map<string, Array<{destination: string, target: string, line: number}>>} */
  const imports = new Map();
  for (const { file, source, errors } of parseSources(files)) {
    problems.push(...errors);
    if (errors.length) continue;
    const allowed = /** @type {RegExp} */ (allowedFor(file));
    /** @type {Array<{destination: string, target: string, line: number}>} */
    const edges = [];
    imports.set(file, edges);
    /** @type {(node: ts.Node) => void} */
    const visit = (node) => {
      let target;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        target = node.moduleSpecifier;
      else if (ts.isExternalModuleReference(node)) target = node.expression;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        target = node.argument.literal;
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      )
        target = node.arguments[0];
      if (
        target &&
        ts.isStringLiteralLike(target) &&
        /^(?:\.{1,2}(?:\/|$)|\/)/.test(target.text)
      ) {
        const destination = posix.normalize(
          target.text.startsWith("/")
            ? target.text.slice(1)
            : posix.join(posix.dirname(file), target.text),
        );
        const line = lineOf(source, target);
        edges.push({ destination, target: target.text, line });
        if (
          !allowed.test(destination) ||
          (generic.test(file) && agentContract.test(destination))
        )
          problems.push(`${file}:${line}: forbidden import ${target.text}`);
      }
      if (
        generic.test(file) &&
        ts.isStringLiteralLike(node) &&
        businessViewIds.has(node.text)
      )
        problems.push(
          `${file}:${lineOf(source, node)}: business view id ${node.text} belongs to application composition`,
        );
      ts.forEachChild(node, visit);
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
}

/** @param {string} file @param {string} text */
export function boundaryProblems(file, text) {
  // Unit callers pass arbitrary files to probe the visitor; ineligible files
  // mean "nothing to check here" rather than an empty gate run.
  if (!eligible(file)) return [];
  return checkBoundaries([[file, text]]);
}
