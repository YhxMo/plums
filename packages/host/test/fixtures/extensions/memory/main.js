const tools = [
  {
    name: "memory_save",
    description: "Save synthetic private memory",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" } },
      required: ["id", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "memory_search",
    description: "Search synthetic private memory",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
];
export function activate(sdk) {
  sdk.register("commands", "localProbe", ({ operation, engineId }) =>
    operation === "start"
      ? sdk.engine.start(engineId)
      : sdk.engine.request(engineId, "pid", {}),
  );
  let pending = Promise.resolve();
  const serial = (work) => {
    const next = pending.then(work);
    pending = next.catch(() => {});
    return next;
  };
  const binding = async () => {
    const resource = (await sdk.resources.list()).find(
      (item) => item.requirementId === "private" && item.scope === "agent",
    );
    if (!resource) throw Error("PRIVATE_RESOURCE_UNAVAILABLE");
    return resource.binding;
  };
  async function operation(name, input) {
    const handle = await binding();
    const snapshot = await sdk.resources.read(handle, "records");
    const records = snapshot.exists ? snapshot.value : [];
    if (name === "search") {
      const query = input.query.toLowerCase();
      return records.filter((record) =>
        record.text.toLowerCase().includes(query),
      );
    }
    const next = records.filter((record) => record.id !== input.id);
    next.push({ id: input.id, text: input.text });
    await sdk.resources.write(handle, "records", snapshot.revision, next);
    return { id: input.id };
  }
  sdk.register("tools", "memory", ({ operation: name, input }) =>
    serial(() => operation(name, input)),
  );
  sdk.register("tools", "tools", ({ operation: name, input }) => {
    if (name === "list") return tools;
    const saving = input.name === "memory_save";
    if (!saving && input.name !== "memory_search")
      return { ok: false, content: "TOOL_UNKNOWN" };
    const args = input.arguments;
    const fields = saving ? ["id", "text"] : ["query"];
    if (
      Object.keys(args).length !== fields.length ||
      fields.some((field) => typeof args[field] !== "string")
    )
      return { ok: false, content: "TOOL_INPUT_INVALID" };
    return serial(async () => ({
      ok: true,
      content: JSON.stringify(
        await operation(saving ? "upsert" : "search", args),
      ),
    }));
  });
}
