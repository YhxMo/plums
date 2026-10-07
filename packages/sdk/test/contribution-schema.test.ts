import { expect, it } from "vitest";
import {
  validateContributionSchema,
  validateContributionValue,
} from "../src/index.js";
it("validates local schemas and returns fixed failures without rejected content", () => {
  const schema = {
    type: "object",
    properties: { answer: { type: "string", maxLength: 3 } },
    required: ["answer"],
    additionalProperties: false,
  };
  validateContributionSchema(schema, "/fixture");
  validateContributionValue(schema, { answer: "yes" }, "input");
  for (const phase of ["input", "output"] as const) {
    try {
      validateContributionValue(
        schema,
        { answer: "private rejected text" },
        phase,
      );
      throw Error("expected rejection");
    } catch (e: any) {
      expect(e.details).toEqual({
        reason:
          phase === "input"
            ? "CONTRIBUTION_INPUT_INVALID"
            : "CONTRIBUTION_OUTPUT_INVALID",
        phase,
        executionState: phase === "input" ? "not_started" : "completed",
      });
      expect(JSON.stringify(e)).not.toContain("private rejected text");
    }
  }
  schema.properties.answer.maxLength = 2;
  expect(() =>
    validateContributionValue(schema, { answer: "yes" }, "input"),
  ).toThrow();
});
it("rejects remote, asynchronous, unknown, invalid and excessive schemas at their declaration pointer", () => {
  for (const schema of [
    { $ref: "https://fixture.example/schema" },
    { $async: true, type: "object" },
    { type: "nonsense" },
    { undeclaredKeyword: true },
    { type: "string", description: "x".repeat(65536) },
  ])
    expect(() =>
      validateContributionSchema(schema, "/payload/schema"),
    ).toThrowError(
      expect.objectContaining({
        code: "IMPORT_INVALID",
        path: "/payload/schema",
      }),
    );
  validateContributionSchema(
    {
      type: "object",
      properties: {
        format: { type: "string" },
        pattern: { type: "string" },
        text: { $ref: "#/definitions/text" },
      },
      definitions: { text: { type: "string" } },
    },
    "/local",
  );
});
