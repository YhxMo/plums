import { posix } from "node:path";
import ts from "typescript";
import { lineOf, parseSources } from "./parse-sources.mjs";

// Every repository source belongs to one layer, and its repository-relative
// imports must stay in that layer's allowed destinations.
const sdk = String.raw`modules\/sdk(?:\/|$)`;
const platform = String.raw`src\/native(?:\/|$)|src\/(?:platform|browser-state|credentials|documents|network)(?:\.ts)?$`;
/** @param {string[]} parts */
const to = (...parts) => new RegExp(`^(?:${parts.join("|")})`);
/** @type {Array<[RegExp, RegExp]>} origin -> allowed destination */
const layers = [
  [/^modules\/sdk\//, to(sdk)],
  [
    /^modules\/extension-host\//,
    to(String.raw`modules\/(?:sdk|extension-host)(?:\/|$)`),
  ],
  [
    /^modules\/shell\//,
    to(String.raw`modules\/(?:sdk|extension-host|shell)(?:\/|$)`),
  ],
  [/^extensions\//, to(String.raw`(?:extensions|modules\/sdk)(?:\/|$)`)],
  [
    /^src\/(?:native\/|(?:platform|browser-state|credentials|documents|network)\.ts$)/,
    to(sdk, platform),
  ],
  [/^src\/components\//, to(sdk, String.raw`src\/components(?:\/|$)`)],
  [
    /^src\/(?:shell|features\/extensions)\//,
    to(
      String.raw`modules\/(?:sdk|extension-host|shell)(?:\/|$)`,
      String.raw`src\/(?:shell|components|features\/extensions)(?:\/|$)`,
      platform,
    ),
  ],
  // Business modules and their default UI.
  [
    /^modules\/agents\//,
    to(
      sdk,
      String.raw`modules\/agents(?:\/|$)`,
      String.raw`extensions\/contracts(?:\.d\.ts)?$`,
    ),
  ],
  [
    /^modules\/text-workbench\//,
    to(
      sdk,
      String.raw`modules\/text-workbench(?:\/|$)`,
      String.raw`extensions\/contracts(?:\.d\.ts)?$`,
    ),
  ],
  [
    /^modules\/models\//,
    to(
      sdk,
      String.raw`modules\/models(?:\/|$)`,
      String.raw`extensions\/contracts(?:\.d\.ts)?$`,
    ),
  ],
  [
    /^src\/models\//,
    to(
      sdk,
      String.raw`modules\/models(?:\/|$)`,
      String.raw`src\/(?:models|components)(?:\/|$)`,
    ),
  ],
  [
    /^src\/agents\//,
    to(
      sdk,
      String.raw`modules\/agents(?:\/|$)`,
      String.raw`src\/(?:agents|components)(?:\/|$)`,
    ),
  ],
  // Application composition root wires everything together.
  [
    /^src\/(?:App\.tsx|main\.tsx|application\.ts)$/,
    to(String.raw`(?:src|modules|extensions)(?:\/|$)`),
  ],
];
const repositorySource = /^(?:src|modules|extensions)\/.*\.(?:ts|tsx|js|mjs)$/;
/** Vite and TypeScript aliases (vite.config.ts, tsconfig.json) for bundled code. */
const aliases = [
  ["@/", "src/"],
  ["@modules/", "modules/"],
  ["@extensions/", "extensions/"],
];
/** Bundled code leaves its folder through aliases; extensions load as files. */
const bundled = /^(?:src|modules)\//;
/** @param {string} file */
const allowedFor = (file) => layers.find(([origin]) => origin.test(file))?.[1];

const generic =
  /^(?:modules\/(?:shell|extension-host)|src\/(?:shell|components|features\/extensions))\//;
// Development experiments still drive the default composition from the
// manager; R5 moves them out of the shell, then this exception goes away.
const pendingDevTools =
  /^src\/features\/extensions\/(?:DiagnosticActions\.tsx|useExperiments\.ts)$/;
// shadcn/ui sources name their variants "default"; they hold no view ids.
const vendoredUI = /^src\/components\/ui\//;
const businessViewIds = new Set([
  "agents",
  "default",
  "board",
  "text-workbench",
  "broken",
  "model-connections",
]);

/** @param {Array<[string, string]>} entries */
export function checkBoundaries(entries) {
  const files = entries.filter(([file]) => repositorySource.test(file));
  if (!files.length)
    return ["no repository source files for import boundary check"];
  const problems = [];
  for (const [file] of files)
    if (!allowedFor(file)) problems.push(`${file}: no boundary layer`);
  for (const { file, source, errors } of parseSources(files)) {
    problems.push(...errors);
    const allowed = allowedFor(file);
    if (errors.length || !allowed) continue;
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
        /^(?:\.{1,2}(?:\/|$)|\/|@(?:modules|extensions)?\/)/.test(target.text)
      ) {
        const specifier = target.text;
        const alias = aliases.find(([prefix]) => specifier.startsWith(prefix));
        const destination = posix.normalize(
          alias
            ? alias[1] + specifier.slice(alias[0].length)
            : specifier.startsWith("/")
              ? specifier.slice(1)
              : posix.join(posix.dirname(file), specifier),
        );
        const line = lineOf(source, target);
        if (alias && file.startsWith("extensions/"))
          problems.push(
            `${file}:${line}: unbundled extensions cannot use alias ${specifier}`,
          );
        else if (!allowed.test(destination))
          problems.push(`${file}:${line}: forbidden import ${specifier}`);
        else if (bundled.test(file) && specifier.startsWith("../"))
          problems.push(
            `${file}:${line}: use an alias (@/, @modules/, @extensions/) instead of ${specifier}`,
          );
      }
      if (
        generic.test(file) &&
        !pendingDevTools.test(file) &&
        !vendoredUI.test(file) &&
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
  return problems;
}

/** @param {string} file @param {string} text */
export function boundaryProblems(file, text) {
  // Unit callers pass arbitrary files to probe the visitor; ineligible files
  // mean "nothing to check here" rather than an empty gate run.
  if (!repositorySource.test(file)) return [];
  return checkBoundaries([[file, text]]);
}
