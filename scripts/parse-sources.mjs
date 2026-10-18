import ts from "typescript";

/** @param {string} file */
const scriptKind = (file) =>
  file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : /\.[cm]?jsx?$/.test(file)
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;

/**
 * Parse repository sources in an in-memory program for static import checks.
 * No library loading, module resolution or file I/O happens here.
 * @param {Array<[string, string]>} entries
 * @returns {Array<{file: string, source: ts.SourceFile, errors: string[]}>}
 */
export function parseSources(entries) {
  /** @type {Map<string, ts.SourceFile>} */
  const sources = new Map(
    entries.map(([file, text]) => [
      "/" + file,
      ts.createSourceFile(
        "/" + file,
        text,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(file),
      ),
    ]),
  );
  /** @type {ts.CompilerHost} */
  const host = {
    getSourceFile: (name) => sources.get(name),
    fileExists: (name) => sources.has(name),
    readFile: (name) => sources.get(name)?.text,
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram(
    [...sources.keys()],
    { noLib: true, noResolve: true, allowJs: true, noEmit: true, types: [] },
    host,
  );
  return entries.map(([file]) => {
    const source = /** @type {ts.SourceFile} */ (sources.get("/" + file));
    const errors = program
      .getSyntacticDiagnostics(source)
      .map(
        (diagnostic) =>
          `${file}:${source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}: parse error TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
      );
    return { file, source, errors };
  });
}

/** @param {ts.SourceFile} source @param {ts.Node} node */
export const lineOf = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
