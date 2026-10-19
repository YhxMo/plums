import { expect, it } from "vitest";
import {
  estimateTokens,
  readReply,
  requestBody,
  type Endpoint,
} from "../modules/models/protocols";

const openai: Endpoint = {
  protocol: "openai-chat",
  model: "m",
  maxTokens: 100,
  context: 128_000,
  turns: 10,
};
const anthropic: Endpoint = { ...openai, protocol: "anthropic-messages" };
const history = [
  { role: "user" as const, text: "我是 nanan" },
  { role: "agent" as const, text: "你好 nanan" },
];
const parse = (body: string) => JSON.parse(body) as Record<string, unknown>;

it("sends instructions, history and input as OpenAI chat messages", () => {
  expect(
    parse(
      requestBody(
        { ...openai, extra: { thinking: { type: "disabled" } } },
        { instructions: "简洁回答。", history, input: "我是谁？" },
      ),
    ),
  ).toEqual({
    model: "m",
    max_tokens: 100,
    stream: false,
    thinking: { type: "disabled" },
    messages: [
      { role: "system", content: "简洁回答。" },
      { role: "user", content: "我是 nanan" },
      { role: "assistant", content: "你好 nanan" },
      { role: "user", content: "我是谁？" },
    ],
  });
});

it("puts instructions in Anthropic's system field", () => {
  expect(
    parse(
      requestBody(anthropic, {
        instructions: "简洁回答。",
        history,
        input: "我是谁？",
      }),
    ),
  ).toEqual({
    model: "m",
    max_tokens: 100,
    system: "简洁回答。",
    messages: [
      { role: "user", content: "我是 nanan" },
      { role: "assistant", content: "你好 nanan" },
      { role: "user", content: "我是谁？" },
    ],
  });
});

it("keeps the newest turns, always starting with the user", () => {
  const long = [
    { role: "agent" as const, text: "orphan" },
    ...["a", "b", "c"].flatMap((text) => [
      { role: "user" as const, text },
      { role: "agent" as const, text: text.toUpperCase() },
    ]),
  ];
  const sent = (turns: number | null) =>
    (
      parse(requestBody({ ...openai, turns }, { history: long, input: "d" }))
        .messages as { content: string }[]
    ).map((message) => message.content);
  expect(sent(2)).toEqual(["b", "B", "c", "C", "d"]);
  expect(sent(10)).toEqual(["a", "A", "b", "B", "c", "C", "d"]);
  expect(sent(0)).toEqual(["d"]);
  expect(sent(null)).toEqual(["a", "A", "b", "B", "c", "C", "d"]);
});

it("estimates CJK at a token a character and other text at a token per few characters", () => {
  expect(estimateTokens("字".repeat(1000))).toBe(1000);
  const english = estimateTokens("x".repeat(1000));
  expect(english).toBeGreaterThanOrEqual(1000 / 4);
  expect(english).toBeLessThan(1000);
});

it("drops whole old turns to fit the context window, leaving room for the reply", () => {
  const long = ["a", "b", "c", "d"].flatMap((text) => [
    { role: "user" as const, text: text + "字".repeat(900) },
    { role: "agent" as const, text: text + "答".repeat(900) },
  ]);
  const endpoint = { ...openai, context: 5000, maxTokens: 1000, turns: null };
  const body = requestBody(endpoint, { history: long, input: "e" });
  expect(estimateTokens(body)).toBeLessThanOrEqual(5000 - 1000);
  const messages = parse(body).messages as { role: string; content: string }[];
  expect(messages.map((m) => m.content[0])).toEqual(["c", "c", "d", "d", "e"]);
});

it("carries a conversation of several MB within a 1M context", () => {
  const long = Array.from({ length: 100 }, (_, i) => [
    { role: "user" as const, text: `${i}` + "问".repeat(4000) },
    { role: "agent" as const, text: `${i}` + "答".repeat(4000) },
  ]).flat();
  const request = { history: long, input: "总结" };
  const all = requestBody(
    { ...openai, context: 1_000_000, turns: null },
    request,
  );
  expect(new TextEncoder().encode(all).length).toBeGreaterThan(2 * 1024 * 1024);
  expect((parse(all).messages as unknown[]).length).toBe(201);
  // The same conversation keeps only its newest turns within 128K.
  const small = requestBody({ ...openai, turns: null }, request);
  expect(estimateTokens(small)).toBeLessThanOrEqual(128_000 - 100);
  const kept = parse(small).messages as { content: string }[];
  expect(kept.length).toBeLessThan(40);
  expect(kept.at(-2)!.content.startsWith("99")).toBe(true);
});

it("drops whole old turns to stay under the byte limit", () => {
  const big = "字".repeat(3000);
  const long = ["a", "b", "c"].flatMap((text) => [
    { role: "user" as const, text: text + big },
    { role: "agent" as const, text },
  ]);
  const body = requestBody(openai, { history: long, input: "d" }, 20000);
  expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(20000);
  const messages = parse(body).messages as { role: string; content: string }[];
  expect(messages[0]).toEqual({ role: "user", content: "b" + big });
  expect(messages.at(-1)).toEqual({ role: "user", content: "d" });
});

it("refuses before sending when the input alone exceeds the window or the byte cap", () => {
  expect(() =>
    requestBody(openai, { history, input: "字".repeat(130_000) }),
  ).toThrow(
    expect.objectContaining({
      outcome: "not-dispatched",
      message: expect.stringContaining("上下文窗口"),
    }),
  );
  expect(() =>
    requestBody(openai, { history, input: "x".repeat(2000) }, 1000),
  ).toThrow(expect.objectContaining({ outcome: "not-dispatched" }));
});

const completion = (content: unknown, reason = "stop") => ({
  status: 200,
  body: JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: reason,
        message: { role: "assistant", content },
      },
    ],
  }),
});
const message = (text: unknown, reason = "end_turn") => ({
  status: 200,
  body: JSON.stringify({
    type: "message",
    role: "assistant",
    stop_reason: reason,
    content: [{ type: "text", text }],
  }),
});

it("reads complete replies of both protocols", () => {
  expect(readReply("openai-chat", completion("你是 nanan。"))).toBe(
    "你是 nanan。",
  );
  expect(readReply("anthropic-messages", message("你是 nanan。"))).toBe(
    "你是 nanan。",
  );
});

it.each([
  ["openai-chat", completion("半句", "length"), "截断"],
  ["openai-chat", completion(""), "完整文本"],
  ["openai-chat", { status: 200, body: "not json" }, "JSON"],
  ["openai-chat", { status: 401, body: "{}" }, "密钥"],
  ["openai-chat", { status: 429, body: "{}" }, "HTTP 429"],
  ["anthropic-messages", message("半句", "max_tokens"), "截断"],
  ["anthropic-messages", message(7), "完整文本"],
  ["anthropic-messages", { status: 200, body: "[]" }, "完整文本"],
] as const)("rejects an unusable %s reply", (protocol, response, text) => {
  expect(() => readReply(protocol, response)).toThrow(text);
});
