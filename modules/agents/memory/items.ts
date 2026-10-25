import type { PromptSection } from "@modules/agents/instructions";
import { object, text } from "@modules/agents/validation";
import type { MemoryItem, MemoryScope } from "./contract";

/** Longest item, so a memory stays one short fact. */
export const MAX_ITEM_TEXT = 300;
/** Items one scope keeps; consolidation merges rather than piling up. */
export const MAX_SCOPE_ITEMS = 200;
/** Characters of memory one prompt carries; the most recently updated fit first. */
export const PROMPT_BUDGET = 6000;

export const sameScope = (a: MemoryScope, b: MemoryScope) =>
  a.kind === b.kind &&
  a.person === b.person &&
  (a.kind === "person" || a.agent === (b as typeof a).agent);

/** When an item stops holding, if it does. */
export const expiresAt = (item: Pick<MemoryItem, "at" | "until">) =>
  item.until ?? item.at;
export const expired = (
  item: Pick<MemoryItem, "at" | "until">,
  now: number,
) => {
  const end = expiresAt(item);
  return end !== undefined && end <= now;
};

const time = (value: unknown) => value === undefined || Number.isFinite(value);
const id = (value: unknown) => text(value, 128) && value !== "";
const scope = (value: unknown): value is MemoryScope =>
  object(value) &&
  id(value.person) &&
  (value.kind === "person" || (value.kind === "agent" && id(value.agent)));

export function validItem(value: unknown): value is MemoryItem {
  return (
    object(value) &&
    id(value.id) &&
    scope(value.scope) &&
    text(value.text, MAX_ITEM_TEXT) &&
    value.text.trim() !== "" &&
    time(value.at) &&
    time(value.until) &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.updatedAt) &&
    (value.by === "person" || value.by === "conversation")
  );
}

/** The wall-clock parts of `ms` in `timeZone`. */
export function zoned(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    })
      .formatToParts(ms)
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour,
    minute: +parts.minute,
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.weekday,
    ),
  };
}

/** The instant a wall-clock time in `timeZone` names. */
export function fromZoned(
  { year, month, day, hour = 0, minute = 0 }: Record<string, number>,
  timeZone: string,
) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  // Twice settles a guess that crossed a daylight-saving change.
  for (let i = 0; i < 2; i++) {
    const seen = zoned(guess, timeZone);
    const shown = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
    );
    guess += wall - shown;
  }
  return guess;
}

const WEEKDAYS = "日一二三四五六";
const pad = (n: number) => String(n).padStart(2, "0");
/** Days from `now`'s date to `ms`'s date, in `timeZone`. */
const daysBetween = (now: number, ms: number, timeZone: string) => {
  const a = zoned(now, timeZone);
  const b = zoned(ms, timeZone);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000,
  );
};

/** `10月28日（周三）14:00`, without the time at midnight and with the year only when it differs. */
export function formatTime(ms: number, now: number, timeZone: string) {
  const t = zoned(ms, timeZone);
  const year = t.year === zoned(now, timeZone).year ? "" : `${t.year}年`;
  const clock = t.hour || t.minute ? ` ${pad(t.hour)}:${pad(t.minute)}` : "";
  return `${year}${t.month}月${t.day}日（周${WEEKDAYS[t.weekday]}）${clock}`;
}

/** How far `ms` is from today, in days, as the model reads it. */
function distance(ms: number, now: number, timeZone: string) {
  const days = daysBetween(now, ms, timeZone);
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days > 1) return `还有 ${days} 天`;
  if (days === -1) return "昨天";
  return `${-days} 天前`;
}

/** One item as a line of the prompt, with its times by day so the prompt holds through a day. */
export function itemLine(item: MemoryItem, now: number, timeZone: string) {
  const when = [
    item.at !== undefined &&
      `${formatTime(item.at, now, timeZone)}，${distance(item.at, now, timeZone)}`,
    item.until !== undefined &&
      item.until !== item.at &&
      `到 ${formatTime(item.until, now, timeZone)} 为止`,
  ].filter(Boolean);
  return `- ${item.text}${when.length ? `（${when.join("；")}）` : ""}`;
}

/**
 * The memory sections for `agent` answering `person`: only those two
 * scopes, nothing expired, the most recently updated within the budget,
 * listed oldest first so the prompt stays the same between changes.
 */
export function memorySections(
  items: readonly MemoryItem[],
  {
    agent,
    person,
    now,
    timeZone,
  }: { agent: string; person: string; now: number; timeZone: string },
): PromptSection[] {
  const pick = (target: MemoryScope) =>
    items.filter(
      (item) => sameScope(item.scope, target) && !expired(item, now),
    );
  const shared = pick({ kind: "person", person });
  const own = pick({ kind: "agent", agent, person });
  let room = PROMPT_BUDGET;
  const kept = new Set<MemoryItem>();
  for (const item of [...shared, ...own].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )) {
    const line = itemLine(item, now, timeZone);
    if (line.length > room) continue;
    room -= line.length + 1;
    kept.add(item);
  }
  const lines = (list: MemoryItem[]) =>
    list
      .filter((item) => kept.has(item))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => itemLine(item, now, timeZone))
      .join("\n");
  const sections: PromptSection[] = [];
  const about = lines(shared);
  if (about)
    sections.push({
      title: "关于对方",
      text: `对方写给所有 Agent 的资料：\n${about}`,
    });
  const remembered = lines(own);
  if (remembered)
    sections.push({
      title: "你记得的事",
      text: `你从以往的对话里记得这些，可能已经过时；和对方新说的不一致时，以新说的为准：\n${remembered}`,
    });
  return sections;
}
