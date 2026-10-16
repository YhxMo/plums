import { expect, test } from "vitest";
import { resolveNavigation } from "../modules/sdk";
const a = {
  id: "a",
  route: "home",
  label: "工作台",
  priority: 0,
  viewId: "a.view",
};
const b = {
  id: "b",
  route: "home",
  label: "替代工作台",
  priority: 2,
  viewId: "b.view",
};
test("priority and id tie break independent of registration order", () => {
  for (const entries of [
    [a, b],
    [b, a],
  ]) {
    const result = resolveNavigation(entries, "home");
    expect(result.selected?.id).toBe("b");
    expect(result.conflicts).toEqual([
      { route: "home", winner: "b", others: ["a"] },
    ]);
  }
  expect(resolveNavigation([{ ...b, priority: 0 }, a]).selected?.id).toBe("a");
});
test("removal falls back within route then first route then empty", () => {
  const note = { ...a, id: "note", viewId: "note.view", route: "notes" };
  expect(resolveNavigation([a, note], "home").selected?.id).toBe("a");
  expect(resolveNavigation([note], "home").selected?.id).toBe("note");
  expect(resolveNavigation([], "home").selected).toBeUndefined();
});
test("rejects duplicate identity, view alias and invalid priorities", () => {
  for (const entries of [
    [a, a],
    [a, { ...b, viewId: a.viewId }],
    [{ ...a, priority: Infinity }],
    [{ ...a, priority: 0.5 }],
    [{ ...a, route: "" }],
  ])
    expect(() => resolveNavigation(entries)).toThrow();
});
test("input and result are detached and explicit route is respected", () => {
  const note = { ...a, id: "note", viewId: "note.view", route: "notes" };
  const input = [note, a, b];
  const r = resolveNavigation(input, "notes");
  expect(r.selected?.id).toBe("note");
  r.selected!.label = "changed";
  expect(note.label).toBe("工作台");
  expect(input).toEqual([note, a, b]);
});
