import { readFile, realpath, mkdtemp, rm, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkVersions, PREVIEW_VERSION } from "./check-versions.mjs";
import { assertReleaseWorkflow } from "./check-release-workflow.mjs";
import { generateThirdPartyNotices } from "./generate-third-party-notices.mjs";
import {
  checkPackageManifest,
  REQUIRED_LICENSE_FILES,
} from "./package-manifest.mjs";
import { parseMacosMajor } from "./macos-version.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const privacyAllowlist = JSON.parse(
  readFileSync(new URL("./privacy-allowlist.json", import.meta.url), "utf8"),
);
const lineDigest = (line) => createHash("sha256").update(line).digest("hex");
export const APACHE_LICENSE_SHA256 =
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
export const REQUIRED_PUBLIC_FILES = Object.freeze([
  "README.md",
  "README.zh-CN.md",
  "AGENTS.md",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.txt",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  "docs/security-model.md",
  ".github/workflows/release.yml",
  ".github/release-notes-template.md",
]);
export function scanTrackedPrivacy(contents, expressions) {
  if (!expressions.length) throw Error("External denylist must not be empty");
  let patterns;
  try {
    patterns = expressions.map((expression) => new RegExp(expression, "gi"));
  } catch {
    throw Error("Invalid external denylist expression");
  }
  const hits = [];
  for (const [file, text] of contents)
    text.split("\n").forEach((line, index) => {
      // Bind each exception to exact source bytes and only the reviewed spans.
      const allowed =
        privacyAllowlist.find(
          (entry) => entry.file === file && entry.sha256 === lineDigest(line),
        )?.spans ?? [];
      if (
        patterns.some((pattern) =>
          [...line.matchAll(pattern)].some(
            (match) =>
              !allowed.some(
                ([start, end]) =>
                  match[0].length > 0 &&
                  match.index >= start &&
                  match.index + match[0].length <= end,
              ),
          ),
        )
      )
        hits.push({ file, line: index + 1 });
    });
  return hits;
}

export function evaluatePublicReadiness({
  contents,
  privacyHits,
  versionsOk,
  packagedVersion,
  installerExists,
  minimumVersion,
  nodeVersion,
  noticesCurrent,
  bundled,
  runtimeLicenses,
  inventoryOk,
}) {
  const failures = [];
  const fail = (code, files = []) => failures.push({ code, files });
  const missing = REQUIRED_PUBLIC_FILES.filter((file) => !contents.has(file));
  if (missing.length) fail("MISSING_PUBLIC_FILES", missing);
  const placeholders = new RegExp(
    "<(?:" + ["OWNER", "REPO"].join("|") + ")>|" + ["【", "用户填写"].join(""),
  );
  const unresolved = [...contents]
    .filter(([, text]) => placeholders.test(text))
    .map(([file]) => file);
  for (const file of [
    "README.md",
    "README.zh-CN.md",
    ".github/release-notes-template.md",
    "docs/security-model.md",
  ])
    if (
      /pending user\s+validation|待用户实测/i.test(contents.get(file) ?? "") &&
      !unresolved.includes(file)
    )
      unresolved.push(file);
  if (unresolved.length) fail("PUBLIC_METADATA", unresolved);
  if (privacyHits.length) fail("PRIVACY", privacyHits);
  const license = contents.get("LICENSE") ?? "",
    notice = contents.get("NOTICE") ?? "";
  let manifests;
  try {
    manifests = [
      "package.json",
      ...["core", "cli", "sdk", "host", "desktop"].map(
        (name) => `packages/${name}/package.json`,
      ),
    ].map((file) => JSON.parse(contents.get(file) ?? "null"));
  } catch {
    manifests = [];
  }
  if (
    createHash("sha256").update(license).digest("hex") !==
      APACHE_LICENSE_SHA256 ||
    !/^Copyright 2026 Plums$/m.test(notice) ||
    !notice.includes("Apache License, Version 2.0") ||
    manifests.length !== 6 ||
    manifests.some((manifest) => manifest?.license !== "Apache-2.0")
  )
    fail("LICENSES");
  const targetOk =
    parseMacosMajor(minimumVersion ?? "") !== null &&
    nodeVersion === "26.5.1" &&
    ["README.md", "README.zh-CN.md"].every((file) => {
      const text = contents.get(file) ?? "";
      return [PREVIEW_VERSION, minimumVersion, nodeVersion, "arm64"].every(
        (value) => value && text.includes(value),
      );
    });
  if (!targetOk) fail("DOCUMENTED_TARGET");
  if (!versionsOk || packagedVersion !== PREVIEW_VERSION || !installerExists)
    fail("VERSIONS");
  const expected = new Map([
    ["LICENSE", license],
    ["NOTICE", notice],
    ["THIRD_PARTY_NOTICES.txt", contents.get("THIRD_PARTY_NOTICES.txt")],
    ...runtimeLicenses,
  ]);
  if (
    !noticesCurrent ||
    REQUIRED_LICENSE_FILES.some(
      (file) =>
        !expected.get(file)?.trim() || bundled.get(file) !== expected.get(file),
    )
  )
    fail("BUNDLED_NOTICES");
  try {
    assertReleaseWorkflow(contents.get(".github/workflows/release.yml") ?? "");
  } catch {
    fail("RELEASE_WORKFLOW");
  }
  if (!inventoryOk) fail("PACKAGE_INVENTORY");
  const oldScope = "@" + ["plums", "/"].join("");
  const stale = [...contents]
    .filter(
      ([, text]) =>
        text.includes(oldScope) || text.includes(oldScope.replace("/", "\\/")),
    )
    .map(([file]) => file);
  if (stale.length) fail("NPM_SCOPE", stale);
  return {
    ok: failures.length === 0,
    failures,
    privacyHits: privacyHits.length,
    version: PREVIEW_VERSION,
  };
}

export async function checkPublicReady({ root = repository, denylist }) {
  if (!denylist)
    throw Error(
      "Usage: node scripts/check-public-ready.mjs --denylist <external-file>",
    );
  const privateFile = await realpath(denylist);
  const relative = path.relative(await realpath(root), privateFile);
  if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
    throw Error("Denylist must be outside the checkout");
  const expressions = (await readFile(privateFile, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  const files = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const contents = new Map();
  for (const file of files) {
    try {
      contents.set(file, await readFile(path.join(root, file), "utf8"));
    } catch {
      /* Missing tracked files fail their corresponding required checks. */
    }
  }
  const privacyHits = scanTrackedPrivacy(contents, expressions);
  let versionsOk = false,
    inventoryOk = false,
    noticesCurrent = false;
  try {
    await checkVersions(root);
    versionsOk = true;
  } catch {
    /* Recorded below. */
  }
  const resource = path.join(
    root,
    "release/Plums-darwin-arm64/Plums.app/Contents/Resources",
  );
  try {
    await checkPackageManifest(resource);
    inventoryOk = true;
  } catch {
    /* Recorded below. */
  }
  const temporary = await mkdtemp(path.join(tmpdir(), "plums-notices-check-"));
  try {
    const output = path.join(temporary, "notices.txt");
    await generateThirdPartyNotices({ root, output });
    noticesCurrent =
      (await readFile(output, "utf8")) ===
      contents.get("THIRD_PARTY_NOTICES.txt");
  } catch {
    /* Recorded below. */
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const bundled = new Map(),
    runtimeLicenses = new Map();
  for (const file of REQUIRED_LICENSE_FILES)
    try {
      bundled.set(file, await readFile(path.join(resource, file), "utf8"));
    } catch {
      /* Missing licenses fail below. */
    }
  for (const [name, file] of [
    ["node/LICENSE", ".build-cache/node-v26.5.1-darwin-arm64/LICENSE"],
    ["LICENSE.electron", "packages/desktop/node_modules/electron/dist/LICENSE"],
    [
      "LICENSES.chromium.html",
      "packages/desktop/node_modules/electron/dist/LICENSES.chromium.html",
    ],
  ])
    try {
      runtimeLicenses.set(name, await readFile(path.join(root, file), "utf8"));
    } catch {
      /* Missing runtime licenses fail below. */
    }
  const packaging = contents.get("scripts/package-desktop.mjs") ?? "";
  let packagedVersion,
    installerExists = false;
  try {
    packagedVersion = JSON.parse(
      await readFile(path.join(resource, "app/package.json"), "utf8"),
    ).version;
  } catch {
    /* Recorded below. */
  }
  try {
    await access(path.join(root, `release/Plums-${PREVIEW_VERSION}-arm64.dmg`));
    installerExists = true;
  } catch {
    /* Recorded below. */
  }
  return evaluatePublicReadiness({
    contents,
    privacyHits,
    versionsOk,
    inventoryOk,
    noticesCurrent,
    bundled,
    runtimeLicenses,
    packagedVersion,
    installerExists,
    minimumVersion: packaging.match(
      /LSMinimumSystemVersion:\s*["']([^"']+)["']/,
    )?.[1],
    nodeVersion: packaging.match(/nodeVersion\s*=\s*["']([^"']+)["']/)?.[1],
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--denylist")
      throw Error(
        "Usage: node scripts/check-public-ready.mjs --denylist <external-file>",
      );
    const report = await checkPublicReady({ denylist: process.argv[3] });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(
      error.code ? "Cannot read required readiness inputs" : error.message,
    );
    process.exitCode = 1;
  }
}
