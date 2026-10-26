// Writes THIRD-PARTY-NOTICES.txt: the licenses of what the Mac app ships.
// `--check` fails when the committed file no longer matches the lockfiles.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { projectEnvironment } from "./environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = "aarch64-apple-darwin";
const output = join(root, "THIRD-PARTY-NOTICES.txt");

/** Copied or derived into this repository's own sources, not installed. */
const vendored = [
  {
    name: "shadcn/ui (components in src/components/ui)",
    license: "MIT",
    text: `MIT License\n\nCopyright (c) 2023 shadcn\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
  },
];
/** Installed only as dev dependencies, but their color values are in styles.css. */
const derivedNpm = ["@radix-ui/colors"];

const licenseFile = /^(?:licen[sc]e|copying|notice|unlicense)(?:[-_.].*)?$/i;

function texts(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && licenseFile.test(entry.name))
    .map((entry) =>
      readFileSync(join(dir, entry.name), "utf8")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+$/gm, "")
        .trim(),
    )
    .filter(Boolean);
}

function rustPackages() {
  const meta = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--locked",
        "--format-version",
        "1",
        "--manifest-path",
        join(root, "src-tauri/Cargo.toml"),
        "--filter-platform",
        target,
      ],
      { env: projectEnvironment(), encoding: "utf8", maxBuffer: 1 << 28 },
    ),
  );
  const packages = new Map(meta.packages.map((entry) => [entry.id, entry]));
  const nodes = new Map(meta.resolve.nodes.map((node) => [node.id, node]));
  const linked = new Set();
  const pending = [meta.resolve.root];
  while (pending.length) {
    const id = pending.pop();
    if (linked.has(id)) continue;
    linked.add(id);
    // Build scripts and dev dependencies are not part of the binary.
    for (const dep of nodes.get(id).deps)
      if (dep.dep_kinds.some((kind) => kind.kind === null))
        pending.push(dep.pkg);
  }
  return [...linked]
    .map((id) => packages.get(id))
    .filter((entry) => entry.id !== meta.resolve.root)
    .map((entry) => ({
      name: entry.name,
      version: entry.version,
      license: entry.license ?? "unspecified",
      home: entry.repository ?? "",
      texts: texts(dirname(entry.manifest_path)),
    }));
}

function npmPackages() {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const found = new Map();
  const pending = [...Object.keys(manifest.dependencies), ...derivedNpm].map(
    (name) => [name, root],
  );
  while (pending.length) {
    const [name, from] = pending.pop();
    // Nested node_modules win over hoisted ones, as in Node's resolution.
    let dir = from;
    let file;
    for (;;) {
      file = join(dir, "node_modules", name, "package.json");
      if (existsSync(file) || dir === root) break;
      dir = dirname(dir);
    }
    if (!existsSync(file)) throw new Error(`${name} is not installed`);
    const entry = JSON.parse(readFileSync(file, "utf8"));
    const key = `${entry.name}@${entry.version}`;
    if (found.has(key)) continue;
    const home = dirname(file);
    found.set(key, {
      name: entry.name,
      version: entry.version,
      license:
        typeof entry.license === "string" ? entry.license : "unspecified",
      home: entry.repository?.url ?? entry.repository ?? "",
      texts: texts(home),
    });
    for (const dep of Object.keys(entry.dependencies ?? {}))
      pending.push([dep, home]);
  }
  return [...found.values()];
}

const byName = (a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1;

export function notices() {
  const groups = [
    ["Web interface (npm packages bundled by Vite)", npmPackages()],
    [`Native app (Rust crates linked for ${target})`, rustPackages()],
    [
      "Copied or derived into Plums' own sources",
      vendored.map((entry) => ({
        ...entry,
        version: "",
        texts: [entry.text.trim()],
      })),
    ],
  ];
  const ids = new Map();
  const missing = [];
  const lines = [
    "Plums bundles third-party software. Plums itself is licensed as described in LICENSE.",
    "Generated by scripts/notices.mjs; do not edit. Each entry lists its license",
    "and the number of the full text below that applies to it. A package that",
    'ships no license file is marked "no file": its license is as declared in its',
    "manifest and the text, with the copyright holders, is in the source repository",
    "listed.",
    "",
  ];
  for (const [title, entries] of groups) {
    lines.push(`## ${title} (${entries.length})`, "");
    for (const entry of entries.sort(byName)) {
      if (!entry.texts.length && !entry.home)
        missing.push(`${entry.name}@${entry.version}`);
      const numbers = entry.texts.map((text) => {
        // Texts that differ only in line breaks and indentation are one.
        const key = text.replace(/\s+/g, " ");
        if (!ids.has(key)) ids.set(key, { id: ids.size + 1, text });
        return `[${ids.get(key).id}]`;
      });
      lines.push(
        `${entry.name}${entry.version && `@${entry.version}`} - ${entry.license} ${
          numbers.join("") || `(no file; ${entry.home})`
        }`,
      );
    }
    lines.push("");
  }
  lines.push("## License texts", "");
  for (const { id, text } of ids.values())
    lines.push(`[${id}]`, "", text, "", "-".repeat(72), "");
  return { text: lines.join("\n"), missing };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { text, missing } = notices();
  if (missing.length) {
    console.error(`No license file or repository for: ${missing.join(", ")}`);
    process.exitCode = 1;
  } else if (process.argv.includes("--check")) {
    const current = existsSync(output) ? readFileSync(output, "utf8") : "";
    if (current !== text) {
      console.error("THIRD-PARTY-NOTICES.txt is stale; run npm run notices.");
      process.exitCode = 1;
    }
  } else writeFileSync(output, text);
}
