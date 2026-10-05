const encode = (s) =>
  Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
const decode = (b) =>
  decodeURIComponent(
    Array.from(b, (c) => "%" + c.toString(16).padStart(2, "0")).join(""),
  );
export function activate(sdk) {
  const run = async (name, input) => {
    if (name === "list_directory")
      return sdk.capability("workspace", {
        kind: "fs",
        operation: "list",
        path: input.path || ".",
      });
    if (name === "read_file") {
      const r = await sdk.capability("workspace", {
        kind: "fs",
        operation: "read",
        path: input.path,
      });
      return { text: decode(r.data) };
    }
    if (name === "write_file")
      return sdk.capability("workspace", {
        kind: "fs",
        operation: "write",
        path: input.path,
        data: encode(input.text),
      });
    throw Error("Tool unavailable");
  };
  for (const name of ["list_directory", "read_file", "write_file"])
    sdk.register("tools", name, (input) => run(name, input));
  sdk.register("commands", "chat", async (input) => {
    if (!input || typeof input.text !== "string" || !input.text.trim())
      throw Error("Message required");
    const card = await sdk.character();
    const messages = [
      {
        role: "system",
        content: card?.persona?.instructions || "Help the user.",
      },
    ];
    try {
      const previous = await sdk.capability("history", {
        kind: "fs",
        operation: "read",
        path: "conversation.json",
      });
      messages.push(...JSON.parse(decode(previous.data)).slice(-30));
    } catch {}
    messages.push({ role: "user", content: input.text });
    const tools = [
      {
        type: "function",
        function: {
          name: "list_directory",
          description: "List a user-authorized workspace directory",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a user-authorized workspace file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Write a workspace file after user confirmation",
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, text: { type: "string" } },
            required: ["path", "text"],
            additionalProperties: false,
          },
        },
      },
    ];
    for (let step = 0; step < 8; step++) {
      const response = await sdk.invoke("model", "connectors", "complete", {
        messages,
        tools,
      });
      const message = response.choices?.[0]?.message;
      if (!message) throw Error("Model response unavailable");
      messages.push(message);
      if (!message.tool_calls?.length) {
        await sdk.capability("history", {
          kind: "fs",
          operation: "write",
          path: "conversation.json",
          data: encode(JSON.stringify(messages.slice(1))),
        });
        return { text: message.content || "", steps: step + 1 };
      }
      for (const call of message.tool_calls) {
        let result;
        try {
          result = await run(
            call.function.name,
            JSON.parse(call.function.arguments),
          );
        } catch (error) {
          result = {
            error: error.code || "TOOL_FAILED",
            executionState: error.details?.executionState,
          };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    throw Error("Tool loop limit reached");
  });
  sdk.register("commands", "history", async () => {
    try {
      const r = await sdk.capability("history", {
        kind: "fs",
        operation: "read",
        path: "conversation.json",
      });
      return JSON.parse(decode(r.data)).filter(
        (m) => ["user", "assistant"].includes(m.role) && m.content,
      );
    } catch {
      return [];
    }
  });
}
