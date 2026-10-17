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
if (process.argv.includes("--boundaries")) {
  const { checkBoundaries } = await import("./check-boundaries.mjs");
  problems.push(...checkBoundaries(boundarySources));
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
        "source inventory, local Markdown links, selected privacy patterns and whitespace; manual review still required",
    },
    null,
    2,
  ),
);
if (problems.length) process.exitCode = 1;
