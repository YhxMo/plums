import { object } from "@modules/agents/validation";
import type { MemoryItem, MemoryMessage, MemoryScope } from "./contract";
import {
  MAX_ITEM_TEXT,
  MAX_SCOPE_ITEMS,
  expired,
  formatTime,
  fromZoned,
  zoned,
} from "./items";

/** New conversation one consolidation reads at most; the newest part is kept. */
export const CONVERSATION_BUDGET = 24_000;
/** One message is cut after this many characters. */
const MESSAGE_LIMIT = 2_000;
/** Items one consolidation may add. */
const MAX_ADDS = 20;

/**
 * What the model is told. It returns operations on numbered items, as mem0
 * does (ADD / UPDATE / DELETE against short ids rather than stored ones),
 * and resolves relative times against each message's time, as Graphiti
 * resolves them against an episode's reference time.
 */
export const CONSOLIDATION_INSTRUCTIONS = `你负责整理一个 Agent 关于对方的长期记忆。读新对话，决定怎样修改已有的记忆。

只记对方明确说出、以后的对话还用得上的事：身份、偏好、习惯、正在做的事、计划与约定、重要日期。不记：寒暄、一次性的问题、Agent 自己说的话、玩笑、假设或角色扮演里的设定，以及对方要求不要记的事。对方的共享资料已经告诉所有 Agent，不要重复记。

时间：把“明天”“3 天后”这类说法按消息前的时间换算成具体时间。at 是事情发生的时间，until 是之后不再有用的时间（比如事情结束、截止）。只有日期写 YYYY-MM-DD，有时刻写 YYYY-MM-DDTHH:mm，都是当地时间。换算不了就不写时间，在内容里保留原话。

标了“已过期”的记忆要处理：删掉；或改写成长期成立的事（比如“每周三下午有吉他课”）并去掉时间；或改写成一句简短的历史并去掉时间。

每条用一句话写对方，不超过 100 字，例如“对花生过敏”。只输出一个 JSON 对象，不要别的文字：
{"add":[{"text":"…","at":"…","until":"…"}],"update":[{"id":1,"text":"…","at":"…","until":"…"}],"delete":[2]}
没有要改的就输出 {"add":[],"update":[],"delete":[]}。`;

const pad = (n: number) => String(n).padStart(2, "0");
/** `2026-10-28T14:00`, or the date alone at midnight, in `timeZone`. */
export function localTime(ms: number, timeZone: string) {
  const t = zoned(ms, timeZone);
  const date = `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  return t.hour || t.minute ? `${date}T${pad(t.hour)}:${pad(t.minute)}` : date;
}

/** The input for one consolidation: now, the shared and own items numbered from 1, then the conversation. */
export function consolidationInput({
  name,
  shared,
  own,
  messages,
  now,
  timeZone,
}: {
  name: string;
  shared: readonly MemoryItem[];
  own: readonly MemoryItem[];
  messages: readonly MemoryMessage[];
  now: number;
  timeZone: string;
}) {
  const when = (item: MemoryItem) =>
    [
      item.at !== undefined && `at ${localTime(item.at, timeZone)}`,
      item.until !== undefined && `until ${localTime(item.until, timeZone)}`,
      expired(item, now) && "已过期",
    ]
      .filter(Boolean)
      .join("，");
  const listed = (item: MemoryItem, i: number) => {
    const detail = when(item);
    return `[${i + 1}] ${item.text}${detail ? `（${detail}）` : ""}`;
  };
  let room = CONVERSATION_BUDGET;
  const lines: string[] = [];
  for (const m of [...messages].reverse()) {
    const body =
      m.text.length > MESSAGE_LIMIT
        ? `${m.text.slice(0, MESSAGE_LIMIT)}…（后略）`
        : m.text;
    const line = `[${localTime(m.at, timeZone).replace("T", " ")}] ${m.role === "user" ? "对方" : name}：${body}`;
    if (line.length > room) break;
    room -= line.length + 1;
    lines.unshift(line);
  }
  return [
    `现在是 ${formatTime(now, now, timeZone)} ${localTime(now, timeZone)}（${timeZone}）。Agent 叫「${name}」。`,
    `对方的共享资料（只读）：\n${shared.map((item) => `- ${item.text}`).join("\n") || "无"}`,
    `已有的记忆：\n${own.map(listed).join("\n") || "无"}`,
    `新对话：\n${lines.join("\n")}`,
  ].join("\n\n");
}

/** A change the model asked for, its ids resolved to stored items. */
export type MemoryChange =
  | { kind: "add"; text: string; at?: number; until?: number }
  | {
      kind: "update";
      item: MemoryItem;
      text: string;
      at?: number;
      until?: number;
    }
  | { kind: "delete"; item: MemoryItem };

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
/** A local time the model wrote; a bare date ends with its day when it is an `until`, or when it is an `at` alone. */
function parseTime(value: unknown, timeZone: string, end: boolean) {
  if (value === undefined || value === null || value === "") return undefined;
  const match = typeof value === "string" && DATE.exec(value);
  if (!match) throw new Error(`时间格式不对：${String(value)}`);
  const [year, month, day, hour = 0, minute = 0] = match
    .slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  if (
    month! < 1 ||
    month! > 12 ||
    day! < 1 ||
    day! > 31 ||
    hour > 23 ||
    minute > 59
  )
    throw new Error(`时间格式不对：${value}`);
  const start = fromZoned(
    { year: year!, month: month!, day: day!, hour, minute },
    timeZone,
  );
  if (match[4] !== undefined || !end) return start;
  return fromZoned({ year: year!, month: month!, day: day! + 1 }, timeZone);
}
function times(value: Record<string, unknown>, timeZone: string) {
  const until = parseTime(value.until, timeZone, true);
  // An event given by date alone holds through that day.
  const at = parseTime(value.at, timeZone, false);
  const day = typeof value.at === "string" && !value.at.includes("T");
  const end =
    until ??
    (at !== undefined && day ? parseTime(value.at, timeZone, true) : undefined);
  return {
    ...(at !== undefined && { at }),
    ...(end !== undefined && { until: end }),
  };
}
const itemText = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_ITEM_TEXT
  )
    throw new Error("记忆内容须是 1–300 个字符。");
  return value.trim();
};

/**
 * The model's answer as changes to `own`, or an error: anything malformed
 * discards the whole answer, so nothing half-applied is written. A JSON
 * object in a code fence or among other text is still read.
 */
export function parseConsolidation(
  output: string,
  own: readonly MemoryItem[],
  timeZone: string,
): MemoryChange[] {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  let value: unknown;
  try {
    value = JSON.parse(output.slice(start, end + 1));
  } catch {
    throw new Error("整理结果不是有效的 JSON。");
  }
  if (start < 0 || !object(value)) throw new Error("整理结果不是 JSON 对象。");
  const list = (key: string) => {
    const entries = value[key] ?? [];
    if (!Array.isArray(entries))
      throw new Error(`整理结果的 ${key} 不是列表。`);
    return entries as unknown[];
  };
  const seen = new Set<number>();
  const target = (number: unknown) => {
    if (
      !Number.isInteger(number) ||
      (number as number) < 1 ||
      (number as number) > own.length ||
      seen.has(number as number)
    )
      throw new Error(`整理结果指向不存在的记忆：${String(number)}`);
    seen.add(number as number);
    return own[(number as number) - 1];
  };
  const adds = list("add");
  if (adds.length > MAX_ADDS) throw new Error("整理结果一次新增的记忆太多。");
  const changes: MemoryChange[] = adds.map((entry) => {
    if (!object(entry)) throw new Error("整理结果的新增项无效。");
    return {
      kind: "add",
      text: itemText(entry.text),
      ...times(entry, timeZone),
    };
  });
  for (const entry of list("update")) {
    if (!object(entry)) throw new Error("整理结果的修改项无效。");
    changes.push({
      kind: "update",
      item: target(entry.id),
      text: itemText(entry.text),
      ...times(entry, timeZone),
    });
  }
  for (const number of list("delete"))
    changes.push({ kind: "delete", item: target(number) });
  return changes;
}

/**
 * `items` (one scope's) with `changes` applied, and what changed in words.
 * Past the scope's limit, the items unchanged the longest go first.
 */
export function applyChanges(
  items: readonly MemoryItem[],
  changes: readonly MemoryChange[],
  { scope, now }: { scope: MemoryScope; now: number },
) {
  let mine = [...items];
  const report = {
    added: [] as string[],
    changed: [] as string[],
    removed: [] as string[],
  };
  for (const change of changes) {
    if (change.kind === "delete") {
      mine = mine.filter((item) => item.id !== change.item.id);
      report.removed.push(change.item.text);
      continue;
    }
    const { text, at, until } = change;
    const fields = {
      text,
      ...(at !== undefined && { at }),
      ...(until !== undefined && { until }),
    };
    if (change.kind === "add") {
      mine.push({
        id: crypto.randomUUID(),
        scope,
        ...fields,
        createdAt: now,
        updatedAt: now,
        by: "conversation",
      });
      report.added.push(text);
    } else {
      mine = mine.map((item) => {
        if (item.id !== change.item.id) return item;
        const { at: _at, until: _until, ...rest } = item;
        return { ...rest, ...fields, updatedAt: now };
      });
      report.changed.push(text);
    }
  }
  mine = mine
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    .slice(0, MAX_SCOPE_ITEMS)
    .sort((a, b) => a.createdAt - b.createdAt);
  return { items: mine, report };
}
