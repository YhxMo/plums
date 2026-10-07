import { createHash } from "node:crypto";
import { mcpToolFingerprint, type McpTool } from "@plums/core";
import { describe, expect, it } from "vitest";

const LEAK = "plums-mcp-desc-LEAK-9f3a7c1e-DO-NOT-ECHO";
const SEARCH: McpTool = { name: "search", description: `${LEAK} search` };

describe("mcpToolFingerprint", () => {
  /** Missing schema and explicit null are both the JSON null in the hashed triple. */
  const hash = (name: string, description: string, schema: unknown = null) =>
    createHash("sha256")
      .update(JSON.stringify([name, description, schema]))
      .digest("hex");

  it("is SHA-256 of [name, description, inputSchema], and a missing schema hashes as null", () => {
    for (const tool of [
      SEARCH,
      { name: "search", description: "Search your notes." },
    ]) {
      const once = mcpToolFingerprint(tool);
      expect(once).toBe(hash(tool.name, tool.description, null));
      expect(once).toBe(mcpToolFingerprint({ ...tool }));
      expect(once).toBe(mcpToolFingerprint({ ...tool, inputSchema: null }));
      expect(once).toBe(
        mcpToolFingerprint({ name: tool.name, description: tool.description }),
      );
      expect(once).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  const changed: [string, McpTool][] = [
    [
      "one character in the description",
      { name: "search", description: `${LEAK} search!` },
    ],
    ["a trailing space", { name: "search", description: `${LEAK} search ` }],
    [
      "different case in the name",
      { name: "Search", description: SEARCH.description },
    ],
    [
      "different case at the end of the name",
      { name: "searcH", description: SEARCH.description },
    ],
    [
      "different case in the description",
      {
        name: "search",
        description: SEARCH.description.replace("LEAK", "leak"),
      },
    ],
    [
      "a quote inside the description",
      { name: "search", description: `${LEAK} "quoted"` },
    ],
    ["only the inputSchema", { ...SEARCH, inputSchema: { type: "object" } }],
  ];
  it.each(changed)("changes when %s", (_name, next) => {
    expect(mcpToolFingerprint(next)).not.toBe(mcpToolFingerprint(SEARCH));
  });

  it("sorts object keys and keeps array order, and ignores level", () => {
    const nested = { b: 1, a: { d: true, c: ["x", "y"] } };
    const sorted = { a: { c: ["x", "y"], d: true }, b: 1 };
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: nested })).toBe(
      hash(SEARCH.name, SEARCH.description, sorted),
    );
    expect(
      mcpToolFingerprint({ ...SEARCH, inputSchema: { a: 1, b: undefined } }),
    ).toBe(hash(SEARCH.name, SEARCH.description, { a: 1 }));
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: ["x", "y"] })).not.toBe(
      mcpToolFingerprint({ ...SEARCH, inputSchema: ["y", "x"] }),
    );
    expect(
      mcpToolFingerprint({ ...SEARCH, inputSchema: { items: ["a", "b"] } }),
    ).not.toBe(
      mcpToolFingerprint({ ...SEARCH, inputSchema: { items: ["b", "a"] } }),
    );
    const withLevel: McpTool = { ...SEARCH, level: "egress" };
    expect(mcpToolFingerprint(withLevel)).toBe(mcpToolFingerprint(SEARCH));
    expect(mcpToolFingerprint({ name: "ab", description: "c" })).not.toBe(
      mcpToolFingerprint({ name: "a", description: "bc" }),
    );
  });

  it("keeps a __proto__ key on a null-prototype object in the hash", () => {
    const hidden = Object.create(null) as Record<string, unknown>;
    hidden.type = "object";
    const properties = Object.create(null) as Record<string, unknown>;
    properties.__proto__ = { type: "string" };
    hidden.properties = properties;
    const plain = { type: "object", properties: {} };
    expect(mcpToolFingerprint({ ...SEARCH, inputSchema: hidden })).not.toBe(
      mcpToolFingerprint({ ...SEARCH, inputSchema: plain }),
    );
  });

  it("changes when a parameter is named __proto__", () => {
    const plain = JSON.parse('{"type":"object","properties":{}}') as unknown;
    const hidden = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
    ) as unknown;
    expect(
      mcpToolFingerprint({
        name: "search",
        description: "d",
        inputSchema: hidden,
      }),
    ).not.toBe(
      mcpToolFingerprint({
        name: "search",
        description: "d",
        inputSchema: plain,
      }),
    );
  });

  it("ignores object key order in inputSchema and keeps a real change", () => {
    const left = {
      name: "search",
      description: "d",
      inputSchema: { b: 1, a: { z: true, y: [1, { b: 2, a: 1 }] } },
    };
    const right = {
      name: "search",
      description: "d",
      inputSchema: { a: { y: [1, { a: 1, b: 2 }], z: true }, b: 1 },
    };
    expect(mcpToolFingerprint(left)).toBe(mcpToolFingerprint(right));
    expect(mcpToolFingerprint(left)).not.toBe(
      mcpToolFingerprint({
        ...left,
        inputSchema: { b: 1, a: { z: false, y: [1, { b: 2, a: 1 }] } },
      }),
    );
  });

  /** Depth starts at 1 on the root. A value at depth 64 is the last one accepted. */
  const nest = (depth: number): unknown => {
    let node: unknown = "x";
    for (let i = 1; i < depth; i += 1) node = { n: node };
    return node;
  };

  it("accepts a schema of exactly 64 levels and exactly 256 KiB", () => {
    expect(() =>
      mcpToolFingerprint({ ...SEARCH, inputSchema: nest(64) }),
    ).not.toThrow();
    const room = 256 * 1024 - Buffer.byteLength(JSON.stringify({ blob: "" }));
    const exact = { blob: "x".repeat(room) };
    expect(Buffer.byteLength(JSON.stringify(exact))).toBe(256 * 1024);
    expect(() =>
      mcpToolFingerprint({ ...SEARCH, inputSchema: exact }),
    ).not.toThrow();
  });

  it("rejects NaN, Infinity, a non-plain object, 65 levels, or more than 256 KiB", () => {
    class Box {
      n = 1;
    }
    const bad = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      new Map(),
      new Box(),
      nest(65),
      { blob: "x".repeat(256 * 1024) },
    ];
    for (const inputSchema of bad) {
      expect(() => mcpToolFingerprint({ ...SEARCH, inputSchema })).toThrow(
        TypeError,
      );
    }
  });
});
