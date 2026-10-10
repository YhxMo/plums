import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
const OLD_CLAIMS = [
  "separate trust approval",
  "engine-trust",
  "单独的信任批准",
  "单独的信任授权",
];
const CLAIMS = [
  {
    file: "README.md",
    project: "Project tier: currently unavailable",
    machine: "no Plums sandbox",
    limitation:
      "After you stop or revoke this entry, children it started that are detached from its process group may continue running.",
  },
  {
    file: "README.zh-CN.md",
    project: "项目档位：当前不可用",
    machine: "没有 Plums 沙箱",
    limitation:
      "停止或撤销该入口后，它启动且已脱离其进程组的子进程可能继续运行。",
  },
];
const readmes = () =>
  CLAIMS.map((claim) => ({
    ...claim,
    text: readFileSync(
      new URL(`../../../${claim.file}`, import.meta.url),
      "utf8",
    ),
  }));
it("README files no longer describe the removed engine-trust approval", () => {
  for (const { text } of readmes())
    for (const phrase of OLD_CLAIMS) expect(text).not.toContain(phrase);
});
it("README files state that the project tier is unavailable and the machine tier is unsandboxed", () => {
  for (const { text, project, machine } of readmes()) {
    expect(text).toContain(project);
    expect(text).toContain(machine);
    expect(text).toContain("TIER_UNAVAILABLE");
  }
});
it("README files carry the detached-children limitation exactly once per language", () => {
  for (const { text, limitation } of readmes())
    expect(text.split(limitation)).toHaveLength(2);
});
