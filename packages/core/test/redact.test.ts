import {
  IMPORT_INVALID,
  PlumsError,
  REDACTED,
  SECRET_NOT_FOUND,
  redact,
} from "@plumsjs/core";
import { describe, expect, it } from "vitest";

const secret = "sk-live-EXAMPLE";
const other = "second-secret-value";

describe("redact", () => {
  it("removes known secret values from strings", () => {
    expect(redact(`prefix ${secret} and ${secret}`, [secret])).toBe(
      `prefix ${REDACTED} and ${REDACTED}`,
    );
  });

  it("removes known secret values from objects without mutating the input", () => {
    const input = {
      note: `see ${secret}`,
      [secret]: "visible",
      nested: [{ token: other }, secret],
    };
    const output = redact(input, [secret, other]);
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(other);
    expect(output).toEqual({
      note: `see ${REDACTED}`,
      [REDACTED]: "visible",
      nested: [{ token: REDACTED }, REDACTED],
    });
    expect(input.note).toContain(secret);
    expect(input.nested[1]).toBe(secret);
  });

  it("removes known secret values from errors", () => {
    const err = new PlumsError({
      code: SECRET_NOT_FOUND,
      message: `missing ${secret}`,
      path: `/settings/${secret}`,
      details: { leaked: secret, plain: new Error(`cause ${other}`) },
    });
    const redacted = redact(err, [secret, other]);
    const blob = `${redacted.message}\n${redacted.path ?? ""}\n${redacted.stack ?? ""}\n${JSON.stringify(redacted.details)}`;

    expect(redacted).toBeInstanceOf(PlumsError);
    expect(redacted).not.toBe(err);
    expect(redacted.code).toBe(SECRET_NOT_FOUND);
    expect(redacted.message).toBe(`missing ${REDACTED}`);
    expect(redacted.path).toBe(`/settings/${REDACTED}`);
    const details = redacted.details as { leaked: string; plain: Error };
    expect(details.leaked).toBe(REDACTED);
    expect(details.plain).toBeInstanceOf(Error);
    expect(details.plain.message).toBe(`cause ${REDACTED}`);
    expect(blob).not.toContain(secret);
    expect(blob).not.toContain(other);
    expect(err.message).toContain(secret);
    expect(err.path).toContain(secret);
  });

  it("redacts a plain Error message and leaves the original in place", () => {
    const err = new Error(`failed ${other}`);
    const redacted = redact(err, [other]);
    expect(redacted).toBeInstanceOf(Error);
    expect(redacted).not.toBeInstanceOf(PlumsError);
    expect(redacted.message).toBe(`failed ${REDACTED}`);
    expect(redacted.stack ?? "").not.toContain(other);
    expect(err.message).toContain(other);
  });

  it("replaces a longer secret before a shorter one and ignores empty secrets", () => {
    expect(redact("abcd", ["ab", "abcd"])).toBe(REDACTED);
    expect(redact("v1.2.3", ["1.2"])).toBe(`v${REDACTED}.3`);
    expect(redact("keep-this", ["", "keep"])).toBe(`${REDACTED}-this`);
    expect(redact("untouched", [""])).toBe("untouched");
  });

  it("redacts a shared object twice and stops on a real cycle", () => {
    const shared = { token: secret };
    const cycle: { token: string; self?: unknown } = { token: secret };
    cycle.self = cycle;
    expect(redact({ a: shared, b: shared }, [secret])).toEqual({
      a: { token: REDACTED },
      b: { token: REDACTED },
    });
    expect(redact(cycle, [secret])).toEqual({
      token: REDACTED,
      self: REDACTED,
    });
  });

  it("preserves opaque JSON keys as own data properties while redacting nested values", () => {
    const input = JSON.parse(
      JSON.stringify({
        nested: JSON.parse(
          '{"__proto__":{"token":"placeholder"},"constructor":{"prototype":{"opaque":true}}}',
        ),
      }).replace("placeholder", secret),
    );
    const output = redact(input, [secret]) as {
      nested: Record<string, unknown>;
    };
    expect(Object.getPrototypeOf(output.nested)).toBe(Object.prototype);
    expect(Object.hasOwn(output.nested, "__proto__")).toBe(true);
    expect(output.nested["__proto__"]).toEqual({ token: REDACTED });
    expect(output.nested["constructor"]).toEqual({
      prototype: { opaque: true },
    });
    expect(JSON.stringify(output)).not.toContain(secret);
    expect(JSON.stringify(redact(input, []))).toBe(JSON.stringify(input));
    expect(input.nested["__proto__"].token).toBe(secret);
    expect(Object.getPrototypeOf(input.nested)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty("token");
  });

  it("drops a secret that is the entire path", () => {
    const pointer = "/settings/apiKey";
    const err = new PlumsError({
      code: IMPORT_INVALID,
      message: "bad",
      path: pointer,
    });
    const redacted = redact(err, [pointer]);
    expect(redacted.path).toBe(REDACTED);
    expect(redacted.path).not.toContain("apiKey");
  });
});
