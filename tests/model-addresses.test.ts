import { expect, it } from "vitest";
import {
  chatTarget,
  modelListPaths,
  normalizeBase,
  readModelList,
} from "../modules/models/addresses";

it.each([
  ["openai-chat", "https://api.openai.com/v1", "https://api.openai.com/v1"],
  ["openai-chat", "https://api.openai.com/v1/", "https://api.openai.com/v1"],
  [
    "openai-chat",
    " https://api.openai.com/v1/chat/completions ",
    "https://api.openai.com/v1",
  ],
  [
    "anthropic-messages",
    "https://api.anthropic.com/",
    "https://api.anthropic.com",
  ],
  [
    "anthropic-messages",
    "https://api.anthropic.com/v1/messages",
    "https://api.anthropic.com",
  ],
] as const)("keeps %s base %j as %j", (protocol, input, base) => {
  expect(normalizeBase(protocol, input)).toBe(base);
});

it("derives the address each protocol posts to", () => {
  expect(chatTarget("openai-chat", "https://api.deepseek.com")).toBe(
    "https://api.deepseek.com/chat/completions",
  );
  expect(
    chatTarget("openai-chat", "https://open.bigmodel.cn/api/paas/v4"),
  ).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  expect(chatTarget("anthropic-messages", "https://api.anthropic.com")).toBe(
    "https://api.anthropic.com/v1/messages",
  );
  expect(chatTarget("anthropic-messages", "https://gateway.example/v1")).toBe(
    "https://gateway.example/v1/messages",
  );
});

it.each([
  ["openai-chat", "https://api.deepseek.com", ["/models", "/v1/models"]],
  ["openai-chat", "https://api.openai.com/v1", ["/v1/models"]],
  [
    "openai-chat",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ["/compatible-mode/v1/models"],
  ],
  [
    "openai-chat",
    "https://open.bigmodel.cn/api/paas/v4",
    ["/api/paas/v4/models"],
  ],
  ["anthropic-messages", "https://api.anthropic.com", ["/v1/models"]],
  // A compatibility suffix is also tried without it, as cc-switch does.
  [
    "anthropic-messages",
    "https://api.deepseek.com/anthropic",
    ["/anthropic/v1/models", "/v1/models", "/models"],
  ],
  [
    "anthropic-messages",
    "https://open.bigmodel.cn/api/anthropic",
    ["/api/anthropic/v1/models", "/v1/models", "/models"],
  ],
] as const)("lists models of %s %s at %j", (protocol, base, paths) => {
  expect(modelListPaths(protocol, base)).toEqual(paths);
});

it("reads model ids from the common list shapes, sorted and unique", () => {
  expect(
    readModelList(
      JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] }),
    ),
  ).toEqual(["a", "b"]);
  expect(
    readModelList(
      JSON.stringify({ models: [{ slug: "x" }, { id: "y" }, { name: "z" }] }),
    ),
  ).toEqual(["x", "y"]);
  expect(
    readModelList(
      JSON.stringify({
        data: [{ id: "" }, { id: " pad" }, { id: 3 }, { id: "x".repeat(121) }],
      }),
    ),
  ).toEqual([]);
  expect(readModelList("not json")).toEqual([]);
  expect(readModelList("[]")).toEqual([]);
});
