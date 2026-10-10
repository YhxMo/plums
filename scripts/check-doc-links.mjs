import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
export const isPublicMarkdown = (file) =>
  /^(?:README(?:\.[\w-]+)?|SECURITY|CONTRIBUTING|CODE_OF_CONDUCT|CHANGELOG)\.md$/.test(
    file,
  ) || /^docs\/.*\.md$/.test(file);
const withoutCode = (text) =>
  text
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
const slug = (text) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/&(?:amp|lt|gt|quot);/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");

export function markdownAnchors(text) {
  const anchors = new Set(),
    counts = new Map();
  const content = text.replace(
    /^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm,
    "",
  );
  const headings = [
    ...content.matchAll(
      /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$|<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gm,
    ),
  ].map((m) => ({ index: m.index, title: m[1] ?? m[2] }));
  headings.push(
    ...[...content.matchAll(/^([^\n]+)\n(?:={3,}|-{3,})\s*$/gm)].map((m) => ({
      index: m.index,
      title: m[1],
    })),
  );
  for (const { title } of headings.sort((a, b) => a.index - b.index)) {
    const base = slug(title),
      count = counts.get(base) ?? 0;
    let candidate = count ? `${base}-${count}` : base;
    let suffix = count;
    while (anchors.has(candidate)) candidate = `${base}-${++suffix}`;
    counts.set(base, suffix + 1);
    anchors.add(candidate);
  }
  for (const match of content.matchAll(
    /<(?:a|h[1-6])\b[^>]*\b(?:id|name)=["']([^"']+)["']/g,
  ))
    anchors.add(match[1]);
  return anchors;
}

function links(text) {
  const content = withoutCode(text),
    references = new Map();
  for (const match of content.matchAll(
    /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm,
  ))
    references.set(match[1].trim().toLowerCase(), match[2]);
  const result = [
    ...content.matchAll(
      /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    ),
  ].map((m) => m[1] ?? m[2]);
  for (const match of content.matchAll(/!?\[([^\]]+)\](?:\[([^\]]*)\])?/g)) {
    const value = references.get((match[2] || match[1]).trim().toLowerCase());
    if (value) result.push(value);
  }
  result.push(
    ...[...content.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)].map(
      (m) => m[1],
    ),
  );
  result.push(...references.values());
  result.push(
    ...[...content.matchAll(/<(https?:\/\/[^>]+)>/g)].map((m) => m[1]),
  );
  return result;
}

export function checkDocLinks(documents, tracked) {
  const failures = [],
    external = new Set();
  for (const [file, text] of documents) {
    if (!isPublicMarkdown(file) || !tracked.has(file)) continue;
    for (const link of links(text)) {
      if (/^https?:\/\//i.test(link)) {
        external.add(link);
        continue;
      }
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(link);
      } catch {
        failures.push({ file, link, reason: "invalid URL encoding" });
        continue;
      }
      const hash = decoded.indexOf("#"),
        anchor = hash < 0 ? "" : decoded.slice(hash + 1);
      const pathname = (hash < 0 ? decoded : decoded.slice(0, hash)).split(
        "?",
      )[0];
      const target = pathname
        ? path.posix.normalize(
            pathname.startsWith("/")
              ? pathname.slice(1)
              : path.posix.join(path.posix.dirname(file), pathname),
          )
        : file;
      const directory = [...tracked].some((name) =>
        name.startsWith(target.replace(/\/$/, "") + "/"),
      );
      if ((!tracked.has(target) && !directory) || target.startsWith("../")) {
        failures.push({
          file,
          link,
          reason: "target is not a tracked file or directory",
        });
        continue;
      }
      if (anchor) {
        const targetText = documents.get(target);
        if (
          targetText === undefined ||
          !markdownAnchors(targetText).has(anchor.replace(/^user-content-/, ""))
        )
          failures.push({ file, link, reason: "anchor does not exist" });
      }
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    external: [...external].sort(),
  };
}

export async function checkRepositoryDocLinks(root = repository) {
  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  );
  const documents = new Map(),
    missing = [];
  for (const file of tracked) {
    try {
      await access(path.join(root, file));
      if (isPublicMarkdown(file))
        documents.set(file, await readFile(path.join(root, file), "utf8"));
    } catch {
      missing.push({ file, reason: "tracked file is missing from checkout" });
    }
  }
  const result = checkDocLinks(documents, tracked);
  result.failures.push(...missing);
  result.ok = result.failures.length === 0;
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 2)
      throw Error("Usage: node scripts/check-doc-links.mjs");
    const report = await checkRepositoryDocLinks();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch {
    console.error("Document link check failed");
    process.exitCode = 1;
  }
}
