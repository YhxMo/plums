import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const EXPERIMENT_FILES = Object.freeze([
  "packages/host/test/project-members.experiments.test.ts",
]);
const SERIAL_FILES = Object.freeze([
  ["packages/host/test/local-callbacks.test.ts", "local-callbacks-serial"],
  ["packages/host/test/confirm-once.test.ts", "confirm-once-serial"],
]);
export function assertProjectGroups(projects, groups) {
  const names = projects
    .map((project) => (typeof project === "string" ? project : project.name))
    .filter((name) => name !== "experiments");
  const assignments = Object.values(groups);
  if (
    assignments.some(
      (group) =>
        !Array.isArray(group) ||
        !group.length ||
        group.some((name) => typeof name !== "string"),
    )
  )
    throw Error("CI groups must contain nonempty project lists");
  const grouped = assignments.flat();
  const failures = [];
  for (const name of names) {
    const count = grouped.filter((project) => project === name).length;
    if (count !== 1)
      failures.push(`${name}: expected exactly one CI group, found ${count}`);
  }
  for (const name of grouped)
    if (!names.includes(name)) failures.push(`Unexpected CI project: ${name}`);
  if (failures.length) throw Error(failures.join("\n"));
}

async function testFiles(directory, root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await testFiles(file, root)));
    else if (entry.isFile() && entry.name.endsWith(".test.ts"))
      files.push(path.relative(root, file).split(path.sep).join("/"));
  }
  return files;
}

export function assertCoverage(
  { files, specifications, projects },
  experiments = false,
) {
  const failures = [];
  const matches = new Map(files.map((file) => [file, []]));
  for (const { file, project } of specifications) {
    if (!matches.has(file)) failures.push(`Unexpected test file: ${file}`);
    else matches.get(file).push(project);
  }
  for (const [file, names] of matches) {
    const expected = !experiments && EXPERIMENT_FILES.includes(file) ? 0 : 1;
    if (names.length !== expected)
      failures.push(
        `${file}: expected ${expected} project, found ${names.length} (${names.join(", ")})`,
      );
    if (
      EXPERIMENT_FILES.includes(file) &&
      names.some((name) => name !== "experiments")
    )
      failures.push(`${file}: must belong to experiments`);
  }
  const unit = projects.find((p) => p.name === "unit");
  const orders = [];
  for (const [file, name] of SERIAL_FILES) {
    const hits = matches.get(file) ?? [];
    if (hits.length !== 1 || hits[0] !== name)
      failures.push(`${file}: must belong only to ${name}`);
    const project = projects.find((p) => p.name === name);
    if (
      !unit ||
      !project ||
      !Number.isFinite(project.groupOrder) ||
      project.groupOrder <= unit.groupOrder ||
      project.maxWorkers !== 1
    )
      failures.push(`${name}: must follow unit with one worker`);
    orders.push(project?.groupOrder);
  }
  if (new Set(orders).size !== orders.length)
    failures.push(
      "Serial confirmation projects must have different groupOrder values",
    );
  if (failures.length) throw Error(failures.join("\n"));
}

export async function inspectCoverage(root = repository) {
  const files = [];
  for (const pkg of await readdir(path.join(root, "packages"), {
    withFileTypes: true,
  })) {
    if (!pkg.isDirectory()) continue;
    const directory = path.join(root, "packages", pkg.name, "test");
    try {
      files.push(...(await testFiles(directory, root)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const vitest = await createVitest("test", {
    root,
    config: path.join(root, "vitest.config.ts"),
    watch: false,
  });
  try {
    const specs = await vitest.globTestSpecifications();
    return {
      files: files.sort(),
      specifications: specs.map((s) => ({
        file: path.relative(root, s.moduleId).split(path.sep).join("/"),
        project: s.project.name,
      })),
      projects: vitest.projects.map((p) => ({
        name: p.name,
        groupOrder: p.config.sequence.groupOrder,
        maxWorkers: p.config.maxWorkers,
      })),
    };
  } finally {
    await vitest.close();
  }
}

export async function checkRuntimeVersions(root = repository) {
  const workflow = await readFile(
    path.join(root, ".github/workflows/ci.yml"),
    "utf8",
  );
  const pinned = workflow.match(/node-version: ['"]([^'"]+)['"]/g) ?? [];
  const versions = pinned.map((line) => line.match(/['"]([^'"]+)['"]/)?.[1]);
  if (!versions.length || new Set(versions).size !== 1)
    throw Error("CI must pin one exact Node version");
  for (const file of [
    "scripts/prepare-test-runtime.mjs",
    "scripts/package-desktop.mjs",
  ]) {
    const source = await readFile(path.join(root, file), "utf8");
    const version = source.match(
      /(?:const version|const nodeVersion) = "([^"]+)"/,
    )?.[1];
    if (version !== versions[0])
      throw Error(`${file}: fixed Node version differs from CI`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const coverage = await inspectCoverage();
    assertCoverage(coverage, process.env.PLUMS_NATIVE_EXPERIMENTS === "1");
    assertProjectGroups(
      coverage.projects,
      JSON.parse(
        await readFile(path.join(repository, "ci/groups.json"), "utf8"),
      ),
    );
    await checkRuntimeVersions();
    console.log(
      JSON.stringify({
        ok: true,
        totalFiles: coverage.files.length,
        defaultFiles: coverage.specifications.length,
        projects: coverage.projects,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
