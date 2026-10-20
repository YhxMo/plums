import { expect, it } from "vitest";
import {
  estimateTokens,
  readReply,
  requestBody,
  tokenLabel,
  type Endpoint,
} from "../modules/models/protocols";

const openai: Endpoint = {
  protocol: "openai-chat",
  model: "m",
  maxTokens: 100,
  context: 128_000,
};
const anthropic: Endpoint = { ...openai, protocol: "anthropic-messages" };
const history = [
  { role: "user" as const, text: "我是 nanan" },
  { role: "agent" as const, text: "你好 nanan" },
];
const parse = (body: string) => JSON.parse(body) as Record<string, unknown>;

it("leaves the reply length to OpenAI-compatible services unless one is set", () => {
  const request = { history: [], input: "hi" };
  const open = { ...openai, maxTokens: null };
  expect(parse(requestBody(open, request))).not.toHaveProperty("max_tokens");
  // Anthropic requires one: a share of the window, at most 32K.
  const claude = { ...anthropic, maxTokens: null };
  expect(
    parse(requestBody({ ...claude, context: 1_000_000 }, request)).max_tokens,
  ).toBe(32_000);
  expect(
    parse(requestBody({ ...claude, context: 64_000 }, request)).max_tokens,
  ).toBe(16_000);
  // The unset reply still keeps its room in the window.
  expect(() =>
    requestBody(
      { ...open, context: 64_000 },
      { history: [], input: "字".repeat(50_000) },
    ),
  ).toThrow("留给回复");
});

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
    // Marked for Anthropic's prompt cache: the next request repeats it all.
    system: [
      {
        type: "text",
        text: "简洁回答。",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: "我是 nanan" },
      { role: "assistant", content: "你好 nanan" },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "我是谁？",
            cache_control: { type: "ephemeral" },
          },
        ],
      },
    ],
  });
});

it("sends the whole conversation, always starting with the user", () => {
  const long = [
    { role: "agent" as const, text: "orphan" },
    ...["a", "b", "c"].flatMap((text) => [
      { role: "user" as const, text },
      { role: "agent" as const, text: text.toUpperCase() },
    ]),
  ];
  expect(
    (
      parse(requestBody(openai, { history: long, input: "d" })).messages as {
        content: string;
      }[]
    ).map((message) => message.content),
  ).toEqual(["a", "A", "b", "B", "c", "C", "d"]);
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
  const endpoint = { ...openai, context: 5000, maxTokens: 1000 };
  const body = requestBody(endpoint, { history: long, input: "e" });
  expect(estimateTokens(body)).toBeLessThanOrEqual(5000 - 1000);
  const messages = parse(body).messages as { role: string; content: string }[];
  // Each trim makes room for several turns more, not just this one.
  expect(messages.map((m) => m.content[0])).toEqual(["d", "d", "e"]);
});

it("sends only the input when no earlier turn fits", () => {
  const huge = [
    { role: "user" as const, text: "字".repeat(6000) },
    { role: "agent" as const, text: "好" },
  ];
  const endpoint = { ...openai, context: 5000, maxTokens: 1000 };
  expect(
    parse(requestBody(endpoint, { history: huge, input: "e" })).messages,
  ).toEqual([{ role: "user", content: "e" }]);
});

it("trims only now and then as a conversation grows, keeping the cached prefix", () => {
  const endpoint = { ...openai, context: 20_000, maxTokens: 1000 };
  const history: { role: "user" | "agent"; text: string }[] = [];
  let previous: unknown[] = [];
  let trims = 0;
  for (let i = 0; i < 60; i++) {
    const input = `${i}` + "问".repeat(300);
    const body = requestBody(endpoint, { history, input });
    expect(estimateTokens(body)).toBeLessThanOrEqual(20_000 - 1000);
    const messages = parse(body).messages as unknown[];
    const sent = messages.slice(0, -1);
    // Unless trimmed, this request repeats the last one and its reply.
    if (JSON.stringify(sent) !== JSON.stringify(previous)) trims++;
    history.push(
      { role: "user", text: input },
      { role: "agent", text: `${i}` + "答".repeat(300) },
    );
    previous = [
      ...sent,
      { role: "user", content: input },
      { role: "assistant", content: history.at(-1)!.text },
    ];
  }
  // About 30 turns fit; trimming one turn at a time would miss on every request after that.
  expect(trims).toBeGreaterThan(0);
  expect(trims).toBeLessThanOrEqual(5);
});

it("carries a conversation of several MB within a 1M context", () => {
  const long = Array.from({ length: 100 }, (_, i) => [
    { role: "user" as const, text: `${i}` + "问".repeat(4000) },
    { role: "agent" as const, text: `${i}` + "答".repeat(4000) },
  ]).flat();
  const request = { history: long, input: "总结" };
  const all = requestBody({ ...openai, context: 1_000_000 }, request);
  expect(new TextEncoder().encode(all).length).toBeGreaterThan(2 * 1024 * 1024);
  expect((parse(all).messages as unknown[]).length).toBe(201);
  // The same conversation keeps only its newest turns within 128K.
  const small = requestBody(openai, request);
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
  expect(messages[0]).toEqual({ role: "user", content: "c" + big });
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

it("labels windows so two different sizes never read the same", () => {
  expect(
    [128_000, 131_072, 1_000_000, 1_048_576, 262_144, 2_000_000].map(
      tokenLabel,
    ),
  ).toEqual(["128K", "131K", "1M", "1.05M", "262K", "2M"]);
});
