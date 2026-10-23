import { expect, it } from "vitest";
import { reasoningFields, reasoningLevels } from "../modules/models/reasoning";
import { requestBody, type Endpoint } from "../modules/models/protocols";

const parse = (body: string) => JSON.parse(body) as Record<string, unknown>;
const anthropic: Endpoint = {
  protocol: "anthropic-messages",
  model: "claude-sonnet-5-5",
  maxTokens: null,
  context: 1_000_000,
};
const deepseek: Endpoint = {
  protocol: "openai-chat",
  preset: "deepseek",
  model: "deepseek-v4-pro",
  maxTokens: null,
  context: 128_000,
  extra: { thinking: { type: "disabled" } },
};

it("offers strengths only where the service's documentation confirms them", () => {
  // Claude 4.6 and later think adaptively and take an effort; no switch-off.
  for (const model of [
    "claude-sonnet-5-5",
    "claude-opus-4-6",
    "claude-fable-5-1",
    "claude-haiku-5-5",
  ])
    expect(reasoningLevels("anthropic-messages", "anthropic", model)).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
  // Claude 4.5 and earlier think with a token budget and can switch it off.
  for (const model of [
    "claude-sonnet-4-5-20250929",
    "claude-3-7-sonnet-latest",
  ])
    expect(reasoningLevels("anthropic-messages", "custom", model)).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "max",
    ]);
  expect(reasoningLevels("openai-chat", "deepseek", "deepseek-v4-pro")).toEqual(
    ["off", "low", "high", "max"],
  );
  expect(reasoningLevels("openai-chat", "openai", "gpt-5")).toEqual([
    "low",
    "medium",
    "high",
  ]);
  expect(reasoningLevels("openai-chat", "openai", "gpt-4o")).toBeUndefined();
  // Not confirmed: no button rather than a guess.
  expect(reasoningLevels("openai-chat", "kimi", "kimi-k2")).toBeUndefined();
  expect(reasoningLevels("openai-chat", "custom", "o3")).toBeUndefined();
  expect(
    reasoningLevels("anthropic-messages", "custom", "some-other-model"),
  ).toBeUndefined();
});

it("sends Claude 4.6 and later an adaptive thinking mode and an effort", () => {
  expect(reasoningFields(anthropic, "high", 32_000)).toEqual({
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
  });
  expect(reasoningFields(anthropic, "max", 32_000)).toEqual({
    thinking: { type: "adaptive" },
    output_config: { effort: "max" },
  });
});

it("gives older Claude models a thinking budget below the reply room, or none", () => {
  const old = { ...anthropic, model: "claude-sonnet-4-5" };
  expect(reasoningFields(old, "off", 32_000)).toEqual({});
  expect(reasoningFields(old, "low", 32_000)).toEqual({
    thinking: { type: "enabled", budget_tokens: 2_000 },
  });
  // The budget always leaves room under max_tokens, and is never below 1024.
  expect(
    (reasoningFields(old, "max", 16_000).thinking as { budget_tokens: number })
      .budget_tokens,
  ).toBeLessThanOrEqual(16_000 - 4_096);
  expect(reasoningFields(old, "high", 4_000)).toEqual({});
  const body = parse(
    requestBody(
      { ...old, maxTokens: 20_000 },
      { history: [], input: "hi", effort: "high" },
    ),
  );
  expect(body.max_tokens).toBe(20_000);
  expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 15_904 });
});

it("switches DeepSeek's thinking by strength and overrides the preset's default", () => {
  expect(reasoningFields(deepseek, "off", 32_000)).toEqual({
    thinking: { type: "disabled" },
  });
  expect(reasoningFields(deepseek, "high", 32_000)).toEqual({
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });
  expect(reasoningFields(deepseek, "max", 32_000)).toEqual({
    thinking: { type: "enabled" },
    reasoning_effort: "max",
  });
  const request = { history: [], input: "hi" };
  // Without a choice the preset's own body stays as it was.
  expect(parse(requestBody(deepseek, request)).thinking).toEqual({
    type: "disabled",
  });
  const chosen = parse(requestBody(deepseek, { ...request, effort: "low" }));
  expect(chosen.thinking).toEqual({ type: "enabled" });
  expect(chosen.reasoning_effort).toBe("low");
});

it("sends OpenAI's own reasoning models reasoning_effort, and nothing for others", () => {
  const openai: Endpoint = {
    protocol: "openai-chat",
    preset: "openai",
    model: "gpt-5",
    maxTokens: null,
    context: 128_000,
  };
  expect(reasoningFields(openai, "medium", 32_000)).toEqual({
    reasoning_effort: "medium",
  });
  expect(
    reasoningFields({ ...openai, model: "gpt-4o" }, "high", 32_000),
  ).toEqual({});
  // A strength the model does not list is never sent.
  expect(reasoningFields(openai, "max", 32_000)).toEqual({});
  expect(
    reasoningFields({ ...openai, preset: "kimi" }, "high", 32_000),
  ).toEqual({});
});

it("lets the user pick how a model thinks, overriding the rules in either direction", () => {
  // Switched off for a model the rules would offer strengths on.
  expect(
    reasoningLevels("openai-chat", "deepseek", "deepseek-v4-pro", "none"),
  ).toBeUndefined();
  expect(
    reasoningFields({ ...deepseek, thinking: "none" }, "high", 8000),
  ).toEqual({});
  // Turned on for a service and model no rule covers.
  const custom: Endpoint = {
    protocol: "openai-chat",
    preset: "custom",
    model: "my-reasoner",
    maxTokens: null,
    context: 128_000,
  };
  expect(
    reasoningLevels("openai-chat", "custom", "my-reasoner"),
  ).toBeUndefined();
  expect(
    reasoningLevels("openai-chat", "custom", "my-reasoner", "openai"),
  ).toEqual(["low", "medium", "high"]);
  expect(
    reasoningFields({ ...custom, thinking: "openai" }, "medium", 8000),
  ).toEqual({ reasoning_effort: "medium" });
  expect(
    reasoningFields({ ...custom, thinking: "deepseek" }, "off", 8000),
  ).toEqual({ thinking: { type: "disabled" } });
  // The same on the Anthropic format.
  const gateway: Endpoint = {
    ...anthropic,
    model: "my-claude",
    maxTokens: 32_000,
  };
  expect(
    reasoningLevels("anthropic-messages", "custom", "my-claude", "adaptive"),
  ).toEqual(["low", "medium", "high", "max"]);
  expect(
    reasoningFields({ ...gateway, thinking: "budget" }, "high", 32_000),
  ).toEqual({ thinking: { type: "enabled", budget_tokens: 16_000 } });
  // A way that belongs to the other format is ignored, falling back to the rules.
  expect(
    reasoningLevels(
      "anthropic-messages",
      "custom",
      "claude-sonnet-5-5",
      "openai",
    ),
  ).toEqual(["low", "medium", "high", "max"]);
  expect(
    reasoningLevels("openai-chat", "custom", "my-reasoner", "adaptive"),
  ).toBeUndefined();
});
