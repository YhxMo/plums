import { it, expect } from "vitest";
import { modelEndpoint, modelProtocol } from "./model-endpoint-fixture.js";
it.each([
  ["https://provider.example", "https://provider.example/v1/chat/completions"],
  [
    "https://provider.example/v1/",
    "https://provider.example/v1/chat/completions",
  ],
  [
    "https://opencode.ai/zen/go",
    "https://opencode.ai/zen/go/v1/chat/completions",
  ],
  [
    "https://provider.example/custom/chat/completions",
    "https://provider.example/custom/chat/completions",
  ],
])("normalizes %s without restricting providers", (input, expected) => {
  expect(modelEndpoint(input)).toBe(expected);
});
it.each([
  [
    "OpenAI Responses",
    "https://gateway.example/custom/v1",
    "https://gateway.example/custom/v1/responses",
  ],
  [
    "OpenAI Responses",
    "https://gateway.example/custom/responses",
    "https://gateway.example/custom/responses",
  ],
  [
    "Anthropic Messages",
    "https://gateway.example",
    "https://gateway.example/v1/messages",
  ],
  [
    "Anthropic Messages",
    "https://gateway.example/proxy/v1/messages",
    "https://gateway.example/proxy/v1/messages",
  ],
  [
    "Gemini",
    "https://gateway.example",
    "https://gateway.example/v1beta/models/any-model:generateContent",
  ],
  [
    "Gemini",
    "https://gateway.example/proxy/v1beta/models",
    "https://gateway.example/proxy/v1beta/models/any-model:generateContent",
  ],
  [
    "Gemini",
    "https://gateway.example/v1/models/old:generateContent",
    "https://gateway.example/v1/models/any-model:generateContent",
  ],
])("builds %s paths from %s", (protocol, base, expected) => {
  expect(
    modelEndpoint(base, "endpoint", modelProtocol(protocol), "any-model"),
  ).toBe(expected);
});
it("keeps old components compatible and rejects unknown protocols without exposing their value", () => {
  expect(modelProtocol(undefined)).toBe("OpenAI Chat Completions");
  try {
    modelProtocol("fake-private-unsupported-protocol");
    throw Error("accepted");
  } catch (error) {
    expect(error).toMatchObject({
      code: "SETTINGS_INVALID",
      path: "/settings/protocol",
    });
    expect(JSON.stringify(error)).not.toContain("fake-private");
  }
});
it("encodes model identifiers as one Gemini path segment", () => {
  const url = new URL(
    modelEndpoint(
      "https://gateway.example/v1beta",
      "endpoint",
      "Gemini",
      "models/a/b?key=x",
    ),
  );
  expect(url.pathname).toBe("/v1beta/models/a%2Fb%3Fkey%3Dx:generateContent");
  expect(url.search).toBe("");
});
it.each([
  "http://provider.example",
  "https://user:password@provider.example",
  "https://127.0.0.1",
  "https://[::1]",
  "https://localhost",
  "https://service.localhost",
  "https://provider.example.",
  "https://provider.example?key=secret",
  "https://provider.example#secret",
])("rejects unsafe or credential-bearing endpoint %s", (input) => {
  try {
    modelEndpoint(input);
    throw Error("accepted");
  } catch (error) {
    expect(error).toMatchObject({
      code: "SETTINGS_INVALID",
      path: "/settings/endpoint",
    });
    expect(JSON.stringify(error)).not.toContain(input);
  }
});
