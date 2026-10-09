const schemas = {
  write_file: {
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  read_file: { properties: { path: { type: "string" } }, required: ["path"] },
  list_dir: { properties: { path: { type: "string" } }, required: [] },
  run: {
    properties: {
      program: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string" },
    },
    required: ["program", "args"],
  },
};
const definitions = Object.entries(schemas).map(([name, schema]) => ({
  name,
  description: "Synthetic project tool",
  inputSchema: { type: "object", ...schema, additionalProperties: false },
}));
export function activate(sdk) {
  sdk.register("tools", "coding", async ({ operation, input }) => {
    if (operation === "list") return definitions;
    if (operation !== "call" || !definitions.some((t) => t.name === input.name))
      throw Error("FIXTURE_TOOL_UNKNOWN");
    await sdk.engine.start("local");
    try {
      return {
        ok: true,
        content: JSON.stringify(
          await sdk.engine.request("local", input.name, input.arguments),
        ),
      };
    } catch (error) {
      if (error?.code) throw error; // Preserve real host authorization/execution state.
      return { ok: false, content: "FIXTURE_PROJECT_FAILED" };
    }
  });
}
