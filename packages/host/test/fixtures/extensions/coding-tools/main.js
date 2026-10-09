const definitions = ["write_file", "read_file", "list_dir", "run"].map(
  (name) => ({
    name,
    description: "Synthetic project tool",
    inputSchema: { type: "object" },
  }),
);
export function activate(sdk) {
  sdk.register("tools", "coding", async ({ operation, input }) => {
    if (operation === "list") return definitions;
    if (operation !== "call" || !definitions.some((t) => t.name === input.name))
      throw Error("FIXTURE_TOOL_UNKNOWN");
    await sdk.engine.start("local");
    return sdk.engine.request("local", input.name, input.arguments);
  });
}
