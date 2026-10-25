/** The 设定 a new Agent starts with, shown in the add page for the user to change. */
export const DEFAULT_INSTRUCTIONS = "简洁、友好地回答用户的问题。";
/** Longest 设定 an Agent keeps. */
export const MAX_INSTRUCTIONS = 20_000;

/** A part of the system prompt contributed by an extension the Agent is composed of, such as its memory. */
export type PromptSection = { title: string; text: string };

/**
 * What an Agent's model is told before the conversation: who it is and what
 * day it is, then its 设定, then each section. Only the date is given, so
 * the prompt stays the same, and cacheable, through a day. The introduction
 * is for people and never enters it.
 */
export function systemPrompt({
  name,
  instructions,
  now,
  timeZone,
  sections = [],
}: {
  name: string;
  instructions: string;
  now: number;
  timeZone: string;
  sections?: readonly PromptSection[];
}) {
  const today = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    dateStyle: "full",
  }).format(now);
  return [
    `你是「${name}」。今天是 ${today}（${timeZone}）。你只能在收到消息时回复，不能主动发消息，也不能到时间再提醒对方。`,
    instructions.trim(),
    ...sections.map(({ title, text }) => `## ${title}\n${text}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}
