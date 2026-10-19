import { expect, it } from "vitest";
import {
  readReply,
  requestBody,
  type Endpoint,
} from "../modules/models/protocols";

const openai: Endpoint = {
  protocol: "openai-chat",
  model: "m",
  maxTokens: 100,
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
  const sent = (turns: number) =>
    (
      parse(requestBody({ ...openai, turns }, { history: long, input: "d" }))
        .messages as { content: string }[]
    ).map((message) => message.content);
  expect(sent(2)).toEqual(["b", "B", "c", "C", "d"]);
  expect(sent(10)).toEqual(["a", "A", "b", "B", "c", "C", "d"]);
  expect(sent(0)).toEqual(["d"]);
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

it("refuses before sending when the input alone is too large", () => {
  expect(() =>
    requestBody(openai, { history, input: "字".repeat(30000) }),
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
