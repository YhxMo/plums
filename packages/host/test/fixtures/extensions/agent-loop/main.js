export function activate(sdk) {
  let pending = Promise.resolve();
  const serial = (work) => {
    const next = pending.then(work);
    pending = next.catch(() => {});
    return next;
  };
  async function history() {
    const resource = (await sdk.resources.list()).find(
      (item) => item.requirementId === "private" && item.scope === "agent",
    );
    if (!resource) throw Error("PRIVATE_RESOURCE_UNAVAILABLE");
    const snapshot = await sdk.resources.read(resource.binding, "history");
    return {
      binding: resource.binding,
      revision: snapshot.revision,
      messages: snapshot.exists ? snapshot.value : [],
    };
  }
  const call = (slot, operation, input) =>
    sdk.protocols.invoke(slot, { operation, input });
  sdk.register("commands", "history", () =>
    serial(async () => (await history()).messages),
  );
  sdk.register("commands", "chat", ({ text }) =>
    serial(async () => {
      const saved = await history();
      const messages = [...saved.messages, { role: "user", content: text }];
      const slots = new Map();
      for (const slot of [
        "card",
        "memory",
        "context",
        "tools-coding",
        "tools-mcp",
      ])
        slots.set(slot, await sdk.protocols.status(slot));
      const available = (slot) => slots.get(slot).state === "available";
      let introduction = "";
      if (available("card")) {
        const card = await call("card", "parse", {});
        if (card.error) return card;
        introduction = [
          card.description,
          card.personality,
          card.scenario,
          card.systemPrompt,
        ]
          .filter(Boolean)
          .join("\n");
      }
      let context = { system: [], injections: [] };
      if (available("context")) {
        context = await call("context", "context", { messages });
        if (context.error) return context;
      }
      const system = [
        ...context.system,
        ...context.injections
          .filter((item) => item.position === "before_char")
          .map((item) => item.content),
        introduction,
        ...context.injections
          .filter((item) => item.position === "after_char")
          .map((item) => item.content),
      ]
        .filter(Boolean)
        .map((content) => ({ role: "system", content }));
      if (available("memory")) {
        const records = await call("memory", "search", { query: text });
        system.push(
          ...records.map((record) => ({
            role: "system",
            content: record.text,
          })),
        );
      }
      const routes = new Map(),
        tools = [],
        providers = new Set();
      for (const slot of ["tools-coding", "tools-mcp"]) {
        if (!available(slot)) continue;
        const status = slots.get(slot);
        const key = `${status.providerId}/${status.provideId}`;
        if (providers.has(key)) continue;
        providers.add(key);
        for (const tool of await call(slot, "list", {})) {
          if (routes.has(tool.name)) throw Error("TOOL_NAME_CONFLICT");
          routes.set(tool.name, slot);
          tools.push(tool);
        }
      }
      for (let round = 0; round < 8; round++) {
        const reply = await call("model", "complete", {
          messages: [...system, ...messages],
          ...(tools.length ? { tools } : {}),
        });
        messages.push(reply.message);
        if (!reply.message.toolCalls?.length) {
          await sdk.resources.write(
            saved.binding,
            "history",
            saved.revision,
            messages,
          );
          return reply;
        }
        for (const tool of reply.message.toolCalls) {
          const slot = routes.get(tool.name);
          const result = slot
            ? await call(slot, "call", {
                name: tool.name,
                arguments: tool.arguments,
              })
            : { ok: false, content: "TOOL_UNKNOWN" };
          messages.push({
            role: "tool",
            toolCallId: tool.id,
            content: JSON.stringify(result),
          });
        }
      }
      await sdk.resources.write(
        saved.binding,
        "history",
        saved.revision,
        messages,
      );
      return { error: { code: "LOOP_LIMIT_EXCEEDED" } };
    }),
  );
}
