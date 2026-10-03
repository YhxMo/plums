import {
  CAPABILITY_FAILED,
  CONFIRMATION_DENIED,
  CONSENT_REQUIRED,
  DEPENDENCY_MISSING,
  ERROR_CODES,
  FORMAT_UNSUPPORTED,
  IMPORT_INVALID,
  MANIFEST_INVALID,
  PERMISSION_DENIED,
  PlumsError,
  SECRET_NOT_FOUND,
  SETTINGS_INVALID,
  SHARE_FETCH_FAILED,
} from "@plums/core";
import { describe, expect, it } from "vitest";

describe("public error codes", () => {
  it("imports the eleven fixed codes from the package entry", () => {
    expect([
      MANIFEST_INVALID,
      FORMAT_UNSUPPORTED,
      DEPENDENCY_MISSING,
      CONSENT_REQUIRED,
      PERMISSION_DENIED,
      CONFIRMATION_DENIED,
      SECRET_NOT_FOUND,
      IMPORT_INVALID,
      SHARE_FETCH_FAILED,
      SETTINGS_INVALID,
      CAPABILITY_FAILED,
    ]).toEqual([
      "MANIFEST_INVALID",
      "FORMAT_UNSUPPORTED",
      "DEPENDENCY_MISSING",
      "CONSENT_REQUIRED",
      "PERMISSION_DENIED",
      "CONFIRMATION_DENIED",
      "SECRET_NOT_FOUND",
      "IMPORT_INVALID",
      "SHARE_FETCH_FAILED",
      "SETTINGS_INVALID",
      "CAPABILITY_FAILED",
    ]);
    expect(ERROR_CODES).toEqual([
      MANIFEST_INVALID,
      FORMAT_UNSUPPORTED,
      DEPENDENCY_MISSING,
      CONSENT_REQUIRED,
      PERMISSION_DENIED,
      CONFIRMATION_DENIED,
      SECRET_NOT_FOUND,
      IMPORT_INVALID,
      SHARE_FETCH_FAILED,
      SETTINGS_INVALID,
      CAPABILITY_FAILED,
    ]);
    expect(new Set(ERROR_CODES).size).toBe(11);
  });

  it("accepts each code on PlumsError", () => {
    for (const code of ERROR_CODES) {
      const err = new PlumsError({
        code,
        message: `failed: ${code}`,
        path: "/dependencies/0",
      });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PlumsError);
      expect(err.name).toBe("PlumsError");
      expect(err.code).toBe(code);
      expect(err.path).toBe("/dependencies/0");
    }
  });

  it("keeps a JSON Pointer path and optional details", () => {
    const err = new PlumsError({
      code: MANIFEST_INVALID,
      message: "level is invalid",
      path: "/permissions/0/level",
      details: { allowed: ["read", "write", "egress"] },
    });
    expect(err.message).toBe("level is invalid");
    expect(err.path).toBe("/permissions/0/level");
    expect(err.details).toEqual({ allowed: ["read", "write", "egress"] });
  });

  it("rejects a path that does not start with a slash", () => {
    expect(
      () =>
        new PlumsError({
          code: IMPORT_INVALID,
          message: "bad path",
          path: "dependencies/0",
        }),
    ).toThrow(/JSON Pointer/);
  });

  it("rejects an unknown code", () => {
    expect(() => new PlumsError({ code: "NOPE" as never, message: "nope" })).toThrow(/Unknown PlumsError code/);
  });
});
