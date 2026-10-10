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
    source: "This repository contains the source of Plums.",
    project: "Project tier: currently unavailable",
    machine: "no Plums sandbox",
    limitation:
      "After you stop or revoke this entry, children it started that are detached from its process group may continue running.",
  },
  {
    file: "README.zh-CN.md",
    source: "本仓库包含 Plums 的源代码。",
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
it("README files describe the current source repository exactly once", () => {
  for (const { text, source } of readmes())
    expect(text.split(source)).toHaveLength(2);
});
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

it("README files link security and contribution policies and describe checksum/provenance verification", () => {
  for (const { text } of readmes()) {
    for (const file of [
      "docs/security-model.md",
      "SECURITY.md",
      "CONTRIBUTING.md",
    ])
      expect(text).toContain(`./${file}`);
    for (const command of [
      "shasum -a 256 -c SHA256SUMS",
      "gh attestation verify",
      "xattr -dr com.apple.quarantine Plums.app",
    ])
      expect(text).toContain(command);
    expect(text).toContain("@plumsjs/cli");
  }
});

it("the security model states authorization, revocation, audit and current containment limits", () => {
  const text = readFileSync(
    new URL("../../../docs/security-model.md", import.meta.url),
    "utf8",
  );
  for (const phrase of [
    "上限只限制、不授予权限",
    "TIER_UNAVAILABLE",
    "没有 Plums 沙箱",
    "task-or-confirm",
    "deny 优先",
    "DesktopHost.close()",
    "已脱离其进程组",
    "不记录业务正文",
    "非后代进程",
    "未公证",
  ])
    expect(text).toContain(phrase);
});
