import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectProfile } from "../src/project-profile.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it.runIf(process.platform === "darwin" && process.arch === "arm64")(
  "allows project hardlinks but rejects external link sources and project ancestor rename",
  async () => {
    const base = await realpath(
      await mkdtemp(path.join(tmpdir(), "plums-project-creation-")),
    );
    dirs.push(base);
    const ancestor = path.join(base, "parent"),
      project = path.join(ancestor, "project"),
      privateRoot = path.join(base, "platform/private"),
      snapshot = path.join(base, "snapshot");
    const home = path.join(privateRoot, "home"),
      temporary = path.join(privateRoot, "tmp"),
      cache = path.join(privateRoot, "cache");
    await Promise.all(
      [project, home, temporary, cache, snapshot].map((d) =>
        mkdir(d, { recursive: true }),
      ),
    );
    const inside = path.join(project, "inside"),
      outside = path.join(base, "outside");
    await writeFile(inside, "project");
    await writeFile(outside, "outside");
    const code = `const fs=require('node:fs');let own=false,external=false,renamed=false;try{fs.linkSync(${JSON.stringify(inside)},${JSON.stringify(path.join(project, "alias"))});own=true;}catch{}try{fs.linkSync(${JSON.stringify(outside)},${JSON.stringify(path.join(project, "external"))});external=true;}catch{}try{fs.renameSync(${JSON.stringify(ancestor)},${JSON.stringify(ancestor + "-moved")});renamed=true;}catch{}console.log(JSON.stringify({own,external,renamed}));`;
    const profile = projectProfile({
      node: process.execPath,
      snapshot,
      projects: [project],
      privateRoot,
      home,
      temporary,
      cache,
      userHome: path.join(base, "user"),
      dataDir: path.join(base, "platform"),
      toolchains: [],
      readOnly: [],
    });
    const r = spawnSync(
      "/usr/bin/sandbox-exec",
      ["-p", profile, process.execPath, "-e", code],
      {
        env: { HOME: home, TMPDIR: temporary, PATH: "/usr/bin:/bin" },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      own: true,
      external: false,
      renamed: false,
    });
  },
);
