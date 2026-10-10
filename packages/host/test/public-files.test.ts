import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
const required = [
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
];

describe("public contribution files", () => {
  it.each(required)("ships nonempty %s", (file) => {
    expect(read(file).trim().length).toBeGreaterThan(0);
  });

  it("routes security reports privately and states the supported scope", () => {
    const policy = read("SECURITY.md");
    for (const phrase of [
      "advisories/new",
      "## Supported versions",
      "## Private disclosure",
      "## In scope",
      "## Out of scope and known limitations",
      "TIER_UNAVAILABLE",
      "no Plums sandbox",
      "Detached descendants may continue",
    ])
      expect(policy).toContain(phrase);
    expect(policy).toContain("Do not open a public issue");
  });

  it("documents the contribution contract and the CI setup sequence", () => {
    const guide = read("CONTRIBUTING.md");
    for (const phrase of [
      "AGENTS.md",
      "pnpm install --frozen-lockfile",
      "node scripts/prepare-test-runtime.mjs",
      "node scripts/prepare-electron.mjs",
      "pnpm build",
      "pnpm test",
      "Node.js 26.5.1",
      "macOS 15 arm64",
      "original synthetic test fixtures",
      "Do not weaken assertions",
      "SECURITY.md",
    ])
      expect(guide).toContain(phrase);
  });

  it("retains the upstream Covenant version and attribution", () => {
    const covenant = read("CODE_OF_CONDUCT.md");
    expect(covenant).toContain("version 2.1");
    expect(covenant).toContain("## Enforcement Guidelines");
    expect(covenant).toContain("## Attribution");
    expect(covenant).toContain("creativecommons.org/licenses/by/4.0/");
  });

  it("prepares Electron before cold-clone tests, desktop startup and packaging", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    for (const [name, consumer] of [
      ["test", "vitest run"],
      ["desktop:dev", "node scripts/run-desktop.mjs"],
      ["desktop:package", "node scripts/package-desktop.mjs"],
    ]) {
      const command = scripts[name];
      const preparation = command.indexOf("node scripts/prepare-electron.mjs");
      expect(preparation).toBeGreaterThanOrEqual(0);
      expect(command.indexOf(consumer)).toBeGreaterThan(preparation);
    }
  });

  it("uses structured issue forms and preserves PR security checks", () => {
    expect(read(".github/ISSUE_TEMPLATE/config.yml")).toContain(
      "blank_issues_enabled: false",
    );
    const bug = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    for (const id of [
      "version",
      "macos",
      "chip",
      "tier",
      "reproduction",
      "expected",
      "actual",
    ])
      expect(bug).toContain(`id: ${id}`);
    expect(read(".github/PULL_REQUEST_TEMPLATE.md")).toContain(
      "No assertions, budgets, timeouts, or security gates were weakened",
    );
  });
});
