import { afterEach, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true })),
);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "plums-ci-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  const write = (name: string, text = "content\n") => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=CI Fixture",
      "-c",
      "user.email=ci@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  write("README.md");
  write("src/app.ts");
  const base = commit();
  const run = (from = base, event = "push") => {
    const output = join(root, ".ci-output");
    writeFileSync(output, "");
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/ci-changes.mjs")],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          CI_BASE: from,
          CI_HEAD: "HEAD",
          CI_EVENT: event,
          GITHUB_OUTPUT: output,
        },
      },
    );
    return {
      ...result,
      output: result.status === 0 ? readFileSync(output, "utf8") : "",
    };
  };
  return { root, git, write, commit, base, run };
}

it("runs only documentation checks for root, docs and evidence Markdown", () => {
  const f = fixture();
  f.write("README.md", "updated\n");
  f.write("docs/spec/plan.md");
  f.write("evidence/RESULTS.md");
  f.commit();
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.output).toBe("code=false\n");
});

it.each([
  "src/app.ts",
  "tests/fixtures/input.md",
  "docs/example.js",
  ".github/workflows/ci.yml",
  "package-lock.json",
])("keeps full checks for %s, even alongside documentation", (name) => {
  const f = fixture();
  f.write("README.md", "updated\n");
  f.write(name, "changed\n");
  f.commit();
  expect(f.run().output).toBe("code=true\n");
});

it("does not hide removed code renamed into documentation", () => {
  const f = fixture();
  f.git("mv", "src/app.ts", "example.md");
  f.commit();
  expect(f.run().output).toBe("code=true\n");
});

it("compares the whole push, not just its final documentation commit", () => {
  const f = fixture();
  f.write("src/app.ts", "changed\n");
  f.commit();
  f.write("README.md", "updated\n");
  f.commit();
  expect(f.run().output).toBe("code=true\n");
});

it("uses the pull request merge base, excluding unrelated base-branch changes", () => {
  const f = fixture();
  f.git("checkout", "--quiet", "-b", "docs");
  f.write("README.md", "updated\n");
  f.commit();
  f.git("checkout", "--quiet", "main");
  f.write("src/app.ts", "main change\n");
  const main = f.commit();
  f.git("checkout", "--quiet", "docs");
  expect(f.run(main, "pull_request").output).toBe("code=false\n");
});

it("runs full checks for an initial push or an empty diff", () => {
  const f = fixture();
  expect(f.run("0".repeat(40)).output).toBe("code=true\n");
  expect(f.run().output).toBe("code=true\n");
});

it("rejects added whitespace errors and an unavailable comparison base", () => {
  const f = fixture();
  f.write("README.md", "trailing space \n");
  f.commit();
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("trailing whitespace");
  expect(f.run("missing-base").status).not.toBe(0);
});
