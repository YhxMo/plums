import {
  stateRejection,
  type StateErrorCode,
} from "../src/native/state-errors";
import { expect, it } from "vitest";
import { ContractError, type ErrorCode } from "../modules/sdk/errors";
import {
  array,
  object,
  oneOf,
  optional,
  string,
} from "../modules/sdk/validation";
import { errorMessage, stateMessage } from "../src/shell/messages";
import { Host } from "../modules/extension-host/host";
import type { Platform } from "../modules/sdk";
import { validateCredentialBindings } from "../modules/sdk/credential-bindings";

it.each([
  ["state.version", "应用配置版本不支持，原数据已保留。"],
  ["state.corrupt", "应用配置损坏，原数据已保留。"],
  ["state.imports", "扩展路径配置无效，原数据已保留。"],
  ["state.pages", "页面偏好损坏，原数据已保留。"],
  ["state.composition", "组合配置版本不支持或已损坏，原数据已保留。"],
  ["host.invalid", "宿主操作无效。"],
  ["extension.invalid", "扩展声明无效。"],
] as const)("maps %s to Chinese copy", (code, copy) => {
  expect(errorMessage(new ContractError(code))).toBe(copy);
});
it.each([
  ["state.corrupt", "pages.view", "页面偏好损坏，原数据已保留。"],
  ["state.corrupt", "configurations.version", "扩展配置损坏，原数据已保留。"],
  ["state.imports", "imports", "扩展路径配置损坏，原数据已保留。"],
  [
    "state.composition",
    "composition.enabled.0.id",
    "组合配置无效，原数据已保留。",
  ],
  ["extension.invalid", "configuration.values", "扩展配置无效。"],
  ["extension.invalid", "credentialBindings.text.target", "凭据绑定声明无效。"],
  ["extension.invalid", "theme.colors.text", "主题声明无效。"],
] as const)("preserves the message for %s at %s", (code, path, copy) => {
  expect(errorMessage(new ContractError(code, path))).toBe(copy);
});
it("retains fallback behavior for unknown errors and future codes", () => {
  expect(errorMessage(Error("custom failure"))).toBe("custom failure");
  expect(errorMessage("custom failure")).toBe("custom failure");
  expect(errorMessage(null)).toBe("null");
  expect(errorMessage({ message: "object" })).toBe("[object Object]");
  expect(errorMessage(new ContractError("future" as ErrorCode))).toBe("future");
});
it.each([
  ["state-corrupt", "应用状态已损坏，原数据已保留。"],
  ["state-schema", "状态版本不支持或已损坏，原数据已保留。"],
  ["state-read", "状态读取失败，原数据已保留。"],
  ["state-write", "状态写入失败，原数据已保留。"],
  ["state-temporary", "状态临时文件不可用，原数据已保留。"],
  ["state-too-large", "状态超过 64 KiB 实验上限，未保存。"],
  ["revision-conflict", "状态已被其他操作更新，请重新加载应用后重试。"],
  ["state-directory", "状态目录不可用，原数据已保留。"],
  ["revision-limit", "状态修订号已达上限，未保存。"],
])("translates platform state failure %s", (code, copy) => {
  expect(errorMessage(stateRejection(code as StateErrorCode))).toBe(copy);
});
it.each([
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "__defineGetter__",
])(
  "preserves unknown error text matching an inherited property: %s",
  (message) => {
    expect(errorMessage(Error(message))).toBe(message);
    expect(errorMessage(message)).toBe(message);
  },
);
it("validates primitive types and bounds without coercing values", () => {
  for (const value of [null, [], "object", 1])
    expect(() => object(value, "state.corrupt")).toThrow(ContractError);
  expect(object({ field: 1 }, "state.corrupt")).toEqual({ field: 1 });
  for (const value of [1, [], "", "long", "A"])
    expect(() =>
      string(value, "state.corrupt", {
        path: "pages.route",
        min: 1,
        max: 3,
        pattern: /^[a-z]+$/,
      }),
    ).toThrow(ContractError);
  expect(string("abc", "state.corrupt", { min: 1, max: 3 })).toBe("abc");
  expect(oneOf(false, "extension.invalid", [true, false])).toBe(false);
  expect(() => oneOf(["dark"], "state.corrupt", ["light", "dark"])).toThrow(
    ContractError,
  );
  expect(optional(undefined, () => expect.unreachable())).toBeUndefined();
  expect(optional("", (v) => string(v, "state.corrupt"))).toBe("");
  expect(() => optional(null, (v) => string(v, "state.corrupt"))).toThrow(
    ContractError,
  );
});
it("reports the failing array element path and rejects non-arrays", () => {
  expect(() => array({}, "state.corrupt")).toThrow(ContractError);
  expect(() =>
    array(Array(1), "state.corrupt", (value) => string(value, "state.corrupt")),
  ).toThrow(ContractError);
  try {
    array(
      ["valid", 1],
      "state.corrupt",
      (value, path) => string(value, "state.corrupt", { path }),
      { path: "pages" },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({ code: "state.corrupt", detail: "pages.1" });
  }
});
it("formats coded failures before Host flattens diagnostics to strings", async () => {
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: async () => null,
  };
  const host = new Host(platform, undefined, errorMessage);
  host.install(
    {
      manifest: {
        id: "configured",
        version: "1",
        apiVersion: 1,
        configuration: {
          version: 1,
          fields: {
            title: {
              label: "Title",
              type: "string",
              maxLength: 20,
              default: "default",
            },
          },
        },
      },
      activate() {},
    },
    { version: 2, values: {} },
  );
  await host.start("configured");
  expect(host.configuration("configured").error).toBe(
    "扩展配置损坏，原数据已保留。",
  );
  expect(host.inspect("configured").error).toBe(
    "Configuration invalid: 扩展配置损坏，原数据已保留。",
  );
  expect(stateMessage(host.inspect("configured"))).toBe(
    "扩展配置无效：扩展配置损坏，原数据已保留。",
  );
  host.install({
    manifest: { id: "broken", version: "1", apiVersion: 1 },
    activate() {
      throw new ContractError("extension.invalid", "theme.colors");
    },
  });
  await expect(host.start("broken")).rejects.toThrow("主题声明无效。");
  expect(host.inspect("broken").error).toBe("主题声明无效。");
});
it.each([
  [
    { version: 1 },
    "Configuration version or shape is invalid; original preserved",
  ],
  [
    { version: 1, values: { enabled: "false" } },
    "Invalid configuration value: enabled",
  ],
] as const)(
  "preserves default Host configuration diagnostics: %j",
  async (input, message) => {
    const platform: Platform = {
      kind: "browser",
      available: () => true,
      grant: async () => {},
      call: async () => null,
    };
    const host = new Host(platform);
    host.install(
      {
        manifest: {
          id: "configured",
          version: "1",
          apiVersion: 1,
          configuration: {
            version: 1,
            fields: {
              enabled: { type: "boolean", label: "Enabled", default: true },
            },
          },
        },
        activate() {
          expect.unreachable();
        },
      },
      input,
    );
    await host.start("configured");
    expect(host.configuration("configured").error).toBe(message);
    expect(host.inspect("configured")).toMatchObject({
      status: "waiting",
      error: `Configuration invalid: ${message}`,
    });
  },
);
it("retains developer diagnostics for invalid credential declaration shapes", () => {
  expect(() =>
    validateCredentialBindings(null, ["credential.request"]),
  ).toThrow("Invalid credential bindings");
  expect(() =>
    validateCredentialBindings(
      {
        text: {
          label: "Text",
          target: "https://example.invalid/",
          contentType: "application/json",
          headers: {},
        },
      },
      ["credential.request"],
    ),
  ).toThrow("Invalid credential authentication");
});

it.each([
  "Agent 配置损坏",
  "会话配置损坏",
  "当前会话不存在",
  "工作台状态版本或内容无效",
  "独立业务数据损坏",
])("preserves provider-owned corrupt-state explanation: %s", (reason) => {
  expect(
    errorMessage(new ContractError("state.corrupt", "provider.opaque", reason)),
  ).toBe(`${reason}，原数据已保留。`);
});

it("keeps unknown native receipts distinct from explicit rejection", () => {
  expect(errorMessage(Error("Native write receipt unavailable"))).toBe(
    "写入回执未确认，请重新加载应用后再修改。",
  );
});
