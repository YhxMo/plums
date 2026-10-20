import { expect, it } from "vitest";
import {
  contextWindow,
  endpointKey,
  GPT_WINDOW_CAP,
  normalizeModel,
  readCatalog,
} from "../modules/models/catalog";

/** A trimmed models.dev shape: services with an `api` address and models. */
const catalog = readCatalog(
  JSON.stringify({
    anthropic: {
      models: { "claude-sonnet-9": { limit: { context: 1_000_000 } } },
    },
    openai: { models: { "gpt-9": { limit: { context: 1_050_000 } } } },
    deepseek: {
      api: "https://api.deepseek.com",
      models: {
        "deepseek-chat": {
          limit: { context: 1_048_576 },
          canonical_model_id: "deepseek/deepseek-chat",
        },
      },
    },
    zhipuai: {
      api: "https://open.bigmodel.cn/api/paas/v4",
      models: { "glm-9": { limit: { context: 200_000 } } },
    },
    "zhipuai-coding-plan": {
      api: "https://open.bigmodel.cn/api/coding/paas/v4",
      models: { "glm-9": { limit: { context: 128_000 } } },
    },
    openrouter: {
      api: "https://openrouter.ai/api/v1",
      models: {
        "anthropic/claude-sonnet-9": {
          limit: { context: 900_000 },
          canonical_model_id: "anthropic/claude-sonnet-9",
        },
        "openai/gpt-9": {
          limit: { context: 400_000 },
          canonical_model_id: "openai/gpt-9",
        },
        "acme/twin": { canonical_model_id: "acme-a/twin" },
      },
    },
    reseller: {
      api: "https://reseller.example/v1",
      models: {
        "gpt-9": { canonical_model_id: "openai/gpt-9" },
        twin: { canonical_model_id: "acme-b/twin" },
      },
    },
    "acme-a": { models: { twin: { limit: { context: 64_000 } } } },
    "acme-b": { models: { twin: { limit: { context: 32_000 } } } },
    broken: "not a service",
  }),
);

it("matches the same interface whatever version or request path is written", () => {
  for (const url of [
    "https://open.bigmodel.cn/api/paas/v4",
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "open.bigmodel.cn/api/paas",
  ])
    expect(endpointKey(url)).toBe("open.bigmodel.cn/api/paas");
  expect(endpointKey("https://api.anthropic.com/v1/messages")).toBe(
    "api.anthropic.com",
  );
  expect(endpointKey("")).toBeUndefined();
});

it("takes the window of the service at the same address first", () => {
  expect(
    contextWindow(catalog, "https://api.deepseek.com", "deepseek-chat"),
  ).toBe(1_048_576);
  expect(
    contextWindow(catalog, "https://openrouter.ai/api/v1", "openai/gpt-9"),
  ).toBe(400_000);
  // Another plan under the same host is a different interface.
  expect(
    contextWindow(catalog, "https://open.bigmodel.cn/api/paas/v4", "glm-9"),
  ).toBe(200_000);
  expect(
    contextWindow(
      catalog,
      "https://open.bigmodel.cn/api/coding/paas/v4",
      "glm-9",
    ),
  ).toBe(128_000);
});

it("falls back to the maker's entry that other services point at", () => {
  // models.dev lists no address for Anthropic itself.
  expect(
    contextWindow(catalog, "https://api.anthropic.com", "claude-sonnet-9"),
  ).toBe(1_000_000);
  expect(
    contextWindow(catalog, "https://gateway.example", "Claude-Sonnet-9[1m]"),
  ).toBe(1_000_000);
  expect(
    contextWindow(
      catalog,
      "https://gateway.example",
      "anthropic/claude-sonnet-9:beta",
    ),
  ).toBe(1_000_000);
});

it("caps GPT only when the window comes from the maker's entry", () => {
  expect(contextWindow(catalog, "https://api.openai.com/v1", "gpt-9")).toBe(
    GPT_WINDOW_CAP,
  );
  // A matched service keeps its own figure, even above the cap.
  expect(
    contextWindow(catalog, "https://openrouter.ai/api/v1", "openai/gpt-9"),
  ).toBe(400_000);
  // A matched service without a window borrows the maker's, capped.
  expect(contextWindow(catalog, "https://reseller.example/v1", "gpt-9")).toBe(
    GPT_WINDOW_CAP,
  );
});

it("gives nothing when the maker is unclear or the model unknown", () => {
  expect(
    contextWindow(catalog, "https://reseller.example/v1", "twin"),
  ).toBeUndefined();
  expect(
    contextWindow(catalog, "https://api.deepseek.com", "user-model"),
  ).toBeUndefined();
  expect(contextWindow(catalog, "", "deepseek-chat")).toBeUndefined();
});

it("normalizes the ways services write one model", () => {
  expect(normalizeModel("openai/GPT-9:free")).toBe("gpt-9");
  expect(normalizeModel("claude-sonnet-9@20260101")).toBe(
    "claude-sonnet-9-20260101",
  );
  expect(() => readCatalog("[]")).toThrow();
  expect(() => readCatalog("{")).toThrow();
});
