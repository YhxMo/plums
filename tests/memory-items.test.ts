import { expect, it } from "vitest";
import type { MemoryItem } from "../modules/agents/memory/contract";
import {
  PROMPT_BUDGET,
  expired,
  fromZoned,
  memorySections,
  validItem,
} from "../modules/agents/memory/items";
import {
  consolidationInput,
  parseConsolidation,
} from "../modules/agents/memory/consolidate";

const zone = "Asia/Tokyo";
const at = (iso: string) => new Date(`${iso}+09:00`).getTime();
const now = at("2026-10-25T19:30:00");
let n = 0;
const item = (fields: Partial<MemoryItem>): MemoryItem => ({
  id: `i${++n}`,
  scope: { kind: "agent", agent: "a", person: "me" },
  text: "对花生过敏",
  createdAt: n,
  updatedAt: n,
  by: "conversation",
  ...fields,
});

it("gives an Agent only the shared items and its own about that person, minus the expired", () => {
  const items = [
    item({ text: "叫小明", scope: { kind: "person", person: "me" } }),
    item({ text: "对花生过敏" }),
    item({
      text: "另一个 Agent 的记忆",
      scope: { kind: "agent", agent: "b", person: "me" },
    }),
    item({
      text: "关于别人",
      scope: { kind: "agent", agent: "a", person: "x@s" },
    }),
    item({ text: "别人的共享资料", scope: { kind: "person", person: "x@s" } }),
    item({ text: "昨天的课", at: at("2026-10-24T14:00:00") }),
    item({ text: "下周三有吉他课", at: at("2026-10-28T14:00:00") }),
  ];
  const sections = memorySections(items, {
    agent: "a",
    person: "me",
    now,
    timeZone: zone,
  });
  expect(sections).toEqual([
    { title: "关于对方", text: "对方写给所有 Agent 的资料：\n- 叫小明" },
    {
      title: "你记得的事",
      text: "你从以往的对话里记得这些，可能已经过时；和对方新说的不一致时，以新说的为准：\n- 对花生过敏\n- 下周三有吉他课（10月28日（周三） 14:00，还有 3 天）",
    },
  ]);
  const text = JSON.stringify(sections);
  for (const leak of ["另一个", "关于别人", "别人的共享", "昨天的课"])
    expect(text).not.toContain(leak);
  expect(
    memorySections([], { agent: "a", person: "me", now, timeZone: zone }),
  ).toEqual([]);
});

it("an item stops holding at its until, or at its time when it has none", () => {
  expect(expired({ at: now }, now)).toBe(true);
  expect(expired({ at: now - 1, until: now + 1 }, now)).toBe(false);
  expect(expired({}, now)).toBe(false);
});

it("keeps the most recently updated items within the prompt budget", () => {
  const long = "长".repeat(250);
  const items = Array.from({ length: 40 }, (_, i) =>
    item({ text: `${i}${long}`, updatedAt: i, createdAt: i }),
  );
  const [section] = memorySections(items, {
    agent: "a",
    person: "me",
    now,
    timeZone: zone,
  });
  expect(section.text.length).toBeLessThanOrEqual(PROMPT_BUDGET + 100);
  expect(section.text).toContain("39长");
  expect(section.text).not.toContain("\n- 0长");
});

it("reads wall-clock times in the person's time zone, across a daylight-saving change", () => {
  expect(
    fromZoned({ year: 2026, month: 10, day: 28, hour: 14, minute: 0 }, zone),
  ).toBe(at("2026-10-28T14:00:00"));
  // New York leaves daylight time on 1 November 2026.
  expect(
    new Date(
      fromZoned({ year: 2026, month: 11, day: 2, hour: 9 }, "America/New_York"),
    ).toISOString(),
  ).toBe("2026-11-02T14:00:00.000Z");
  expect(
    new Date(
      fromZoned(
        { year: 2026, month: 10, day: 30, hour: 9 },
        "America/New_York",
      ),
    ).toISOString(),
  ).toBe("2026-10-30T13:00:00.000Z");
});

it("shows the model numbered items, marks the expired and puts times in the person's zone", () => {
  const own = [
    item({ text: "对花生过敏" }),
    item({ text: "周五考试", at: at("2026-10-23T09:00:00") }),
  ];
  const input = consolidationInput({
    name: "助手",
    shared: [item({ text: "叫小明", scope: { kind: "person", person: "me" } })],
    own,
    messages: [
      {
        id: "m1",
        session: "s",
        from: "me",
        role: "user",
        text: "我下周三下午两点有吉他课",
        at: at("2026-10-25T19:20:00"),
      },
      {
        id: "m2",
        session: "s",
        from: "a",
        role: "agent",
        text: "好的",
        at: at("2026-10-25T19:21:00"),
      },
    ],
    now,
    timeZone: zone,
  });
  expect(input).toContain(
    "[1] 对花生过敏\n[2] 周五考试（at 2026-10-23T09:00，已过期）",
  );
  expect(input).toContain("- 叫小明");
  expect(input).toContain(
    "[2026-10-25 19:20] 对方：我下周三下午两点有吉他课\n[2026-10-25 19:21] 助手：好的",
  );
});

it("turns the model's answer into changes, and a date alone into a day-long event", () => {
  const own = [item({ text: "对花生过敏" }), item({ text: "周五考试" })];
  const changes = parseConsolidation(
    '好的：\n```json\n{"add":[{"text":"下周三有吉他课","at":"2026-10-28T14:00"},{"text":"10月30日出差","at":"2026-10-30"}],"update":[{"id":1,"text":"对花生和腰果过敏"}],"delete":[2]}\n```',
    own,
    zone,
  );
  expect(changes).toEqual([
    { kind: "add", text: "下周三有吉他课", at: at("2026-10-28T14:00:00") },
    {
      kind: "add",
      text: "10月30日出差",
      at: at("2026-10-30T00:00:00"),
      until: at("2026-10-31T00:00:00"),
    },
    { kind: "update", item: own[0], text: "对花生和腰果过敏" },
    { kind: "delete", item: own[1] },
  ]);
  expect(
    parseConsolidation('{"add":[],"update":[],"delete":[]}', own, zone),
  ).toEqual([]);
});

it("discards a malformed answer whole", () => {
  const own = [item({})];
  for (const bad of [
    "我记住了",
    '{"add":"x"}',
    '{"delete":[3]}',
    '{"delete":[1,1]}',
    '{"update":[{"id":1,"text":""}]}',
    '{"add":[{"text":"x","at":"下周三"}]}',
    '{"add":[{"text":"x","at":"2026-13-01"}]}',
    `{"add":[{"text":"${"长".repeat(301)}"}]}`,
  ])
    expect(() => parseConsolidation(bad, own, zone), bad).toThrow();
});

it("refuses damaged stored items", () => {
  expect(validItem(item({}))).toBe(true);
  for (const bad of [
    { text: "" },
    { scope: { kind: "agent", person: "me" } },
    { scope: { kind: "other", person: "me" } },
    { at: "tomorrow" },
    { by: "model" },
  ])
    expect(validItem({ ...item({}), ...bad })).toBe(false);
});
