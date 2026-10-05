export function activate(sdk) {
  let requestId = 0,
    sessionId,
    protocolVersion = "2025-11-25",
    initialized = false,
    tools = [];
  async function request(method, params = {}, tool) {
    const settings = await sdk.settings();
    const id = ++requestId;
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": protocolVersion,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const result = await sdk.capability(
      "mcp-api",
      {
        kind: "egress",
        url: settings.endpoint || "https://mcp.deepwiki.com/mcp",
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        stream: true,
      },
      tool,
    );
    if (
      result.result.status < 200 ||
      result.result.status >= 300 ||
      result.result.redirectTo
    )
      throw Error("MCP transport failed");
    if (result.result.headers?.["mcp-session-id"])
      sessionId = result.result.headers["mcp-session-id"];
    const body = result.result.body;
    let reply;
    if (
      result.result.headers?.["content-type"]?.includes("text/event-stream")
    ) {
      for (const block of body.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) {
          const event = JSON.parse(data);
          if (event.id === id) reply = event;
        }
      }
    } else reply = JSON.parse(body);
    if (!reply || reply.id !== id || reply.error)
      throw Error("MCP request failed");
    return reply.result;
  }
  async function initialize() {
    if (initialized) return;
    const result = await request("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "plums-example", version: "1.0.0" },
    });
    protocolVersion = result.protocolVersion;
    const settings = await sdk.settings();
    const headers = {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": protocolVersion,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    await sdk.capability("mcp-api", {
      kind: "egress",
      url: settings.endpoint || "https://mcp.deepwiki.com/mcp",
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    initialized = true;
  }
  async function discover() {
    await initialize();
    const complete = [],
      cursors = new Set();
    let cursor;
    do {
      const page = await request("tools/list", cursor ? { cursor } : {});
      if (
        !Array.isArray(page.tools) ||
        complete.length + page.tools.length > 1000
      )
        throw Error("Invalid tool list");
      complete.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor) {
        if (
          typeof cursor !== "string" ||
          cursors.has(cursor) ||
          cursors.size >= 100
        )
          throw Error("Invalid pagination");
        cursors.add(cursor);
      }
    } while (cursor);
    tools = complete.map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema,
    }));
    const states = await sdk.mcpCheck(tools);
    return tools.map((tool, i) => ({ ...tool, state: states[i].state }));
  }
  sdk.register("connectors", "discover", discover);
  sdk.register("connectors", "call", async (input) => {
    await discover();
    const tool = tools.find((t) => t.name === input.name);
    if (!tool) throw Error("Tool missing");
    return request(
      "tools/call",
      { name: input.name, arguments: input.arguments || {} },
      tool,
    );
  });
}
