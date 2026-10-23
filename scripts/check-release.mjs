// Checks that a production build ships only what the released app loads:
// no development catalog, samples or fault tools, and every catalog entry.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentOnly } from "../vite.config.ts";
import { versionProblems } from "./versions.mjs";

const dist = process.argv[2] ?? "dist";
const problems = [];
for (const path of developmentOnly)
  if (existsSync(join(dist, path)))
    problems.push(`${path} is development-only`);
const catalog = JSON.parse(readFileSync(join(dist, "catalog.json"), "utf8"));
for (const entry of catalog)
  if (!existsSync(join(dist, entry.url)))
    problems.push(`${entry.id}: ${entry.url} missing`);
const markers = [
  "注入存储写入失败",
  "诊断与实验",
  "/catalog.dev.json",
  // The built-in text workbench is development-only.
  "文本处理工作台",
];
for (const file of readdirSync(join(dist, "assets")).filter((name) =>
  name.endsWith(".js"),
)) {
  const source = readFileSync(join(dist, "assets", file), "utf8");
  for (const marker of markers)
    if (source.includes(marker))
      problems.push(`assets/${file} contains ${marker}`);
}
// Imported files load from Blob URLs; nothing else may widen the policy.
const policy =
  "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ipc: http://ipc.localhost 'self'; object-src 'none'; base-uri 'self'";
const tauri = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
if (tauri.app.security.csp !== policy)
  problems.push(
    "src-tauri/tauri.conf.json: CSP differs from the reviewed policy",
  );
problems.push(
  ...versionProblems(fileURLToPath(new URL("..", import.meta.url))),
);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`发布内容检查：${catalog.length} 个目录扩展，无开发专用文件。`);
