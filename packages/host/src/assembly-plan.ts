import semver from "semver";
import type { LibraryItem } from "./library.js";
import { importInvalid } from "./library.js";

// Planning reads metadata only. It never installs, enables or grants consent.
export function planAssembly(library: LibraryItem[], digests: string[]) {
  if (
    !Array.isArray(digests) ||
    digests.length > 1000 ||
    digests.some((d) => typeof d !== "string")
  )
    importInvalid("组件选择无效。");
  const pinned = new Map<string, LibraryItem>();
  for (const digest of digests) {
    const p = library.find((p) => p.digest === digest);
    if (!p) importInvalid("所选组件已不在公共库，请重新选择。");
    const previous = pinned.get(p.manifest.id);
    if (previous && previous.digest !== digest)
      importInvalid(`「${p.manifest.name}」只能选择一个版本。`);
    pinned.set(p.manifest.id, p);
  }
  let attempts = 0,
    problem = "组件存在循环依赖，请选择其他组件或版本。";
  function solve(chosen: Map<string, LibraryItem>): LibraryItem[] | undefined {
    if (++attempts > 2048 || chosen.size > 1000) return;
    const constraints = [...chosen.values()].flatMap((p) =>
      p.manifest.dependencies
        .filter((d) => !d.optional)
        .map((d) => ({ owner: p, dep: d })),
    );
    for (const { owner, dep } of constraints) {
      const match = chosen.get(dep.id);
      if (
        match &&
        (match.manifest.kind !== dep.kind ||
          !semver.satisfies(match.manifest.version, dep.range))
      ) {
        problem = `「${owner.manifest.name}」需要「${match.manifest.name}」${dep.range}，与所选版本 ${match.manifest.version} 不兼容。请更换组件版本。`;
        return;
      }
    }
    const missing = constraints.find(({ dep }) => !chosen.has(dep.id));
    if (missing) {
      const { owner, dep } = missing;
      const candidates = library
        .filter(
          (p) =>
            p.manifest.id === dep.id &&
            p.manifest.kind === dep.kind &&
            semver.satisfies(p.manifest.version, dep.range) &&
            constraints.every(
              ({ dep: d }) =>
                d.id !== dep.id ||
                (d.kind === p.manifest.kind &&
                  semver.satisfies(p.manifest.version, d.range)),
            ),
        )
        .sort(
          (a, b) =>
            semver.rcompare(a.manifest.version, b.manifest.version) ||
            a.digest.localeCompare(b.digest),
        );
      if (!candidates.length)
        problem = `「${owner.manifest.name}」需要 ${dep.id}（${dep.range}）。请先导入兼容版本的${dep.kind === "connector" ? "连接器" : dep.kind === "extension" ? "扩展" : "角色卡"}。`;
      for (const candidate of candidates) {
        const result = solve(new Map([...chosen, [dep.id, candidate]]));
        if (result) return result;
      }
      return;
    }
    const order: LibraryItem[] = [],
      visiting = new Set<string>(),
      done = new Set<string>();
    function visit(id: string): boolean {
      if (done.has(id)) return true;
      if (visiting.has(id)) return false;
      visiting.add(id);
      const item = chosen.get(id)!;
      for (const d of item.manifest.dependencies)
        if (!d.optional && !visit(d.id)) return false;
      visiting.delete(id);
      done.add(id);
      order.push(item);
      return true;
    }
    if ([...chosen.keys()].every(visit)) return order;
  }
  const resolved = solve(pinned);
  if (!resolved)
    importInvalid(
      attempts > 2048
        ? "组件组合过于复杂，请减少组件或明确选择版本。"
        : problem,
    );
  return {
    digests: resolved.map((p) => p.digest),
    additions: resolved
      .filter((p) => !digests.includes(p.digest))
      .map((p) => ({
        digest: p.digest,
        name: p.manifest.name,
        version: p.manifest.version,
      })),
  };
}
