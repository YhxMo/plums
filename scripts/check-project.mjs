import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { projectFiles } from "./project-files.mjs";

const paths = projectFiles();
const docs = paths.filter((name) => name.endsWith(".md"));
const problems = [];
/** @type {Array<[string, string]>} */
const boundarySources = [];
let links = 0;
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .replace(/ /g, "-");
const anchors = new Map(
  docs.map((name) => [
    resolve(name),
    new Set(
      [...readFileSync(name, "utf8").matchAll(/^#{1,6} +(.+)$/gm)].map(
        (match) => slug(match[1]),
      ),
    ),
  ]),
);
for (const name of paths) {
  if (/\.(?:png|icns)$/.test(name)) continue;
  const text = readFileSync(name, "utf8");
  boundarySources.push([name, text]);
  if (!text.endsWith("\n") || text.split("\n").some((line) => /\s$/.test(line)))
    problems.push(`${name}: whitespace`);
  if (/(?:\/Users\/|\/Volumes\/)/.test(text))
    problems.push(`${name}: private absolute path`);
  if (
    /(?:sk-[a-zA-Z0-9]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(
      text,
    )
  )
    problems.push(`${name}: potential credential`);
  if (
    name !== "goal.md" &&
    /(?:^|\/)\.env(?:\.|$)/.test(name) &&
    !name.endsWith(".example")
  )
    problems.push(`${name}: environment file`);
  if (!name.endsWith(".md")) continue;
  if (
    /用户(?:说|要求|已确认|明确|提供|希望|认可|所指)|父任务|source_thread_id|codex_delegation|我与你|你与我|本轮/.test(
      text,
    )
  )
    problems.push(`${name}: conversation attribution`);
  if (name !== "goal.md" && /dsh|harness|cordis/i.test(text))
    problems.push(`${name}: non-public architecture reference`);
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^https?:/.test(target)) continue;
    links++;
    const [file, fragment] = target.split("#");
    const destination = resolve(dirname(name), file || name.split("/").at(-1));
    const optionalLocalGoal = destination === resolve("goal.md") && !fragment;
    if (!existsSync(destination) && !optionalLocalGoal)
      problems.push(`${name}: missing link ${target}`);
    else if (fragment && !anchors.get(destination)?.has(fragment))
      problems.push(`${name}: missing anchor ${target}`);
  }
}
const localTargets = (name, text) =>
  [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^https?:/.test(target))
    .map((target) =>
      resolve(dirname(name), target.split("#")[0] || name.split("/").at(-1)),
    );
const docIndex = "docs/README.md";
const archiveIndex = "docs/spec/archive/README.md";
for (const name of [docIndex, archiveIndex])
  if (!existsSync(name)) problems.push(`${name}: missing document index`);
const targets = (name) =>
  existsSync(name)
    ? new Set(localTargets(name, readFileSync(name, "utf8")))
    : new Set();
const indexTargets = targets(docIndex);
const archiveTargets = targets(archiveIndex);
const entryTargets = new Set([
  ...targets("AGENTS.md"),
  ...targets("README.md"),
]);
if (!entryTargets.has(resolve(docIndex)))
  problems.push(`${docIndex}: not linked from AGENTS.md or README.md`);
if (!indexTargets.has(resolve(archiveIndex)))
  problems.push(`${docIndex}: missing archive index link`);
const isCurrentDoc = (name) =>
  /^docs\/[^/]+\.md$/.test(name) || /^docs\/spec\/[^/]+\.md$/.test(name);
const isArchivedDoc = (name) => /^docs\/spec\/archive\/[^/]+\.md$/.test(name);
for (const name of docs) {
  if (!/^docs\//.test(name)) continue;
  const isIndex = name === docIndex || name === archiveIndex;
  const archived = isArchivedDoc(name) && !isIndex;
  const current = isCurrentDoc(name) && !isIndex;
  if (!archived && !current && !isIndex)
    problems.push(`${name}: unexpected document location`);
  if (archived) {
    if (!archiveTargets.has(resolve(name)))
      problems.push(`${name}: missing archive index entry`);
  } else if (current) {
    if (!indexTargets.has(resolve(name)))
      problems.push(`${name}: missing docs index entry`);
    const firstBlock = readFileSync(name, "utf8").split("\n## ")[0];
    if (!/^(?:状态|更新日期|核对日期)：/m.test(firstBlock))
      problems.push(`${name}: missing status line`);
  }
}
if (process.argv.includes("--boundaries")) {
  const { checkBoundaries } = await import("./check-boundaries.mjs");
  problems.push(...checkBoundaries(boundarySources));
  const { checkIpcImports } = await import("./check-ipc-imports.mjs");
  problems.push(...checkIpcImports(boundarySources));
}
const ignored = readFileSync(".gitignore", "utf8").split("\n");
if (!ignored.includes("/goal.md"))
  problems.push(".gitignore: missing root goal rule");
if (
  paths.some(
    (name) =>
      ![
        "src/credentials.ts",
        "src-tauri/src/credentials.rs",
        "tests/web/credentials.spec.ts",
      ].includes(name) &&
      /(?:^|\/)(?:profile|credentials|id_rsa|id_ed25519)(?:\.|$)/i.test(name),
  )
)
  problems.push("Potential private data file name");
console.log(
  JSON.stringify(
    {
      files: paths.length,
      documents: docs.length,
      localLinks: links,
      problems,
      scope:
        "source inventory, local Markdown links, document index coverage, status lines, selected privacy patterns and whitespace; manual review still required",
    },
    null,
    2,
  ),
);
if (problems.length) process.exitCode = 1;
