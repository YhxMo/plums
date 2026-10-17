import { expect, it } from "vitest";
import { validateCredentialBindings } from "../modules/sdk/credential-bindings";

const binding = () => ({
  text: {
    label: "模型文本",
    target: "https://api.deepseek.com/chat/completions",
    contentType: "application/json",
    headers: {},
    authentication: { type: "bearer" },
  },
});

it("accepts a JSON binding and an approved protocol header without adding secrets or request options", () => {
  const declarations = binding();
  declarations.text.headers = { "anthropic-version": "2023-06-01" };
  expect(() =>
    validateCredentialBindings(declarations, ["credential.request"]),
  ).not.toThrow();
});

it.each([
  { target: "http://api.deepseek.com/chat/completions" },
  { target: "https://api.deepseek.com/chat/completions?key=value" },
  { target: "https://user@api.deepseek.com/chat/completions" },
  { target: "https://api.deepseek.com:8443/chat/completions" },
  { headers: { Authorization: "synthetic" } },
  { headers: { Host: "example.invalid" } },
  { headers: { "content-type": "text/plain" } },
  { headers: { "x-version": "one\r\ntwo" } },
  { headers: { "X-Version": "one", "x-version": "two" } },
  { authentication: { type: "header", name: "Content-Length" } },
  { authentication: { type: "header", name: "Content-Type" } },
  { authentication: { type: ["bearer"], name: "x-api-key" } },
  {
    authentication: {
      type: { toString: (): string => "header" },
      name: "x-api-key",
    },
  },
  { contentType: "application/json\r\nx: value" },
  { secret: "synthetic" },
])("rejects an unsafe or ambiguous binding declaration (case %#)", (change) => {
  const declarations = { text: { ...binding().text, ...change } };
  expect(() =>
    validateCredentialBindings(declarations, ["credential.request"]),
  ).toThrow();
});

it("requires a credential capability and validates aliases", () => {
  expect(() => validateCredentialBindings(binding(), [])).toThrow();
  expect(() =>
    validateCredentialBindings({ "../text": binding().text }, [
      "credential.request",
    ]),
  ).toThrow();
  expect(() => validateCredentialBindings(undefined, [])).not.toThrow();
});
