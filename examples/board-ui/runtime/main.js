const encode = (s) =>
  Array.from(unescape(encodeURIComponent(s)), (c) => c.charCodeAt(0));
const decode = (b) =>
  decodeURIComponent(
    Array.from(b, (c) => "%" + c.toString(16).padStart(2, "0")).join(""),
  );
export function activate(sdk) {
  let notes = [];
  sdk.register("commands", "load", async () => {
    try {
      const result = await sdk.capability("board-data", {
        kind: "fs",
        operation: "read",
        path: "board.json",
      });
      notes = JSON.parse(decode(result.data));
    } catch {
      notes = [];
    }
    return notes;
  });
  sdk.register("commands", "add", async (input) => {
    if (!input || typeof input.text !== "string" || !input.text.trim())
      throw Error("Text required");
    const next = [
      ...notes,
      { id: String(Date.now()), text: input.text, done: false },
    ];
    await sdk.capability("board-data", {
      kind: "fs",
      operation: "write",
      path: "board.json",
      data: encode(JSON.stringify(next)),
    });
    notes = next;
    return notes;
  });
  sdk.register("commands", "toggle", async (input) => {
    const next = notes.map((n) =>
      n.id === input.id ? { ...n, done: !n.done } : n,
    );
    await sdk.capability("board-data", {
      kind: "fs",
      operation: "write",
      path: "board.json",
      data: encode(JSON.stringify(next)),
    });
    notes = next;
    return notes;
  });
}
