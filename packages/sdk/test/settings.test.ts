import { expect, it } from "vitest";
import type { SettingsDescription } from "@plumsjs/core";
import { missingRequiredSettings } from "../src/settings.js";

it("uses configured secret flags and accepts false, zero and described defaults", () => {
  const settings: SettingsDescription = {
    schema: {
      type: "object",
      required: ["token", "flag", "count", "text", "defaulted", "missing"],
      properties: {
        token: {
          type: "string",
          title: "Token",
          description: "Token",
          "x-secret": true,
        },
        flag: { type: "boolean", title: "Flag", description: "Flag" },
        count: { type: "integer", title: "Count", description: "Count" },
        text: { type: "string", title: "Text", description: "Text" },
        defaulted: {
          type: "string",
          title: "Default",
          description: "Default",
          default: "default",
        },
        missing: { type: "string", title: "Missing", description: "Missing" },
      },
    },
    values: {
      token: "reference",
      flag: false,
      count: 0,
      text: " \t",
      defaulted: "default",
    },
    secrets: { token: false },
  };
  expect(missingRequiredSettings(settings)).toEqual([
    "token",
    "text",
    "missing",
  ]);
  settings.secrets.token = true;
  settings.values.text = " value ";
  settings.values.missing = "supplied";
  expect(missingRequiredSettings(settings)).toEqual([]);
});

it("does not invent required configuration without a schema or required list", () => {
  expect(missingRequiredSettings({ values: {}, secrets: {} })).toEqual([]);
  expect(
    missingRequiredSettings({
      schema: { type: "object", properties: {} },
      values: {},
      secrets: {},
    }),
  ).toEqual([]);
});
