import { expect, it } from "vitest";
import { readsPictures } from "../modules/models/vision";
import { requestBody, type Endpoint } from "../modules/models/protocols";

type Sent = {
  messages: {
    role: string;
    content: string | { type: string; text?: string }[];
  }[];
};
const parse = (body: string) => JSON.parse(body) as Sent;
const openai: Endpoint = {
  protocol: "openai-chat",
  model: "gpt-4o",
  maxTokens: 1000,
  context: 16_000,
};
const anthropic: Endpoint = { ...openai, protocol: "anthropic-messages" };
const pic = { mime: "image/webp" as const, data: "QUJD" };
const big = { mime: "image/webp" as const, data: "A".repeat(400_000) };

it("marks the models whose names are known to read pictures", () => {
  for (const [protocol, model] of [
    ["anthropic-messages", "claude-sonnet-5-5"],
    ["openai-chat", "gpt-4o"],
    ["openai-chat", "gpt-5"],
    ["openai-chat", "o3"],
    ["openai-chat", "anthropic/claude-sonnet-4-5"],
    ["openai-chat", "qwen3-vl-plus"],
    ["openai-chat", "glm-4.5v"],
    ["openai-chat", "gemini-2.5-pro"],
  ] as const)
    expect(readsPictures(protocol, model), model).toBe(true);
  for (const [protocol, model] of [
    ["openai-chat", "deepseek-v4-pro"],
    ["openai-chat", "gpt-3.5-turbo"],
    ["openai-chat", "kimi-k2"],
    ["anthropic-messages", "some-other-model"],
  ] as const)
    expect(readsPictures(protocol, model), model).toBe(false);
});

it("sends pictures before the text, as OpenAI image_url data URLs", () => {
  const body = parse(
    requestBody(openai, {
      history: [
        { role: "user", text: "旧", images: [pic] },
        { role: "agent", text: "好" },
      ],
      input: "新",
      images: [pic],
    }),
  );
  const url = "data:image/webp;base64,QUJD";
  expect(body.messages).toEqual([
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url } },
        { type: "text", text: "旧" },
      ],
    },
    { role: "assistant", content: "好" },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url } },
        { type: "text", text: "新" },
      ],
    },
  ]);
});

it("sends pictures before the text as Anthropic base64 blocks, caching through the new input", () => {
  const body = parse(
    requestBody(anthropic, {
      history: [{ role: "user", text: "旧", images: [pic] }],
      input: "新",
      images: [pic],
    }),
  );
  const image = {
    type: "image",
    source: { type: "base64", media_type: "image/webp", data: "QUJD" },
  };
  expect(body.messages[0].content).toEqual([
    image,
    { type: "text", text: "旧" },
  ]);
  expect(body.messages[1].content).toEqual([
    image,
    { type: "text", text: "新", cache_control: { type: "ephemeral" } },
  ]);
});

it("counts a picture as a fixed share of the window, not as its base64 text", () => {
  // 4 pictures of 400K characters would be 640K tokens counted as text.
  const request = { history: [], input: "看", images: [big, big] };
  expect(() => requestBody(openai, request)).not.toThrow();
  // Enough pictures still use up the window.
  expect(() =>
    requestBody(openai, { ...request, images: Array(12).fill(big) }),
  ).toThrow("超出上下文窗口");
});

it("trims the oldest turns first when pictures fill the window", () => {
  const history = Array.from({ length: 10 }, (_, i) => [
    { role: "user" as const, text: `问${i}`, images: [pic] },
    { role: "agent" as const, text: `答${i}` },
  ]).flat();
  const body = parse(
    requestBody(openai, { history, input: "新", images: [pic] }),
  );
  const users = body.messages
    .filter((m) => m.role === "user")
    .map((m) => (m.content as { text?: string }[]).at(-1)!.text);
  expect(users.at(-1)).toBe("新");
  expect(users.length).toBeLessThan(10);
  expect(users).not.toContain("问0");
});
