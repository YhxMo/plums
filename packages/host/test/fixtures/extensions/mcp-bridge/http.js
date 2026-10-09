// Test-only finite Streamable HTTP transport. No Node or direct network API.
const MAX_BODY = 256 * 1024;
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const MODERN = "2026-07-28";
export const LEGACY = "2025-11-25";
export const clientInfo = { name: "Plums test bridge", version: "1.0.0" };

function header(headers, name) {
  return Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}
function* messages(body, contentType) {
  if (contentType === "application/json") {
    yield JSON.parse(body);
    return;
  }
  if (contentType !== "text/event-stream") throw Error("MCP_RESPONSE_INVALID");
  // SSE dispatches only complete events. A partial final event is a failure.
  const normalized = body.replace(/\r\n|\r/g, "\n");
  if (!normalized.endsWith("\n\n")) throw Error("MCP_RESPONSE_INVALID");
  const events = normalized.split("\n\n");
  if (events.length > 512) throw Error("MCP_RESPONSE_LIMIT");
  for (const event of events) {
    const data = event
      .split("\n")
      .filter((line) => line === "data" || line.startsWith("data:"))
      .map((line) => (line === "data" ? "" : line.slice(5).replace(/^ /, "")))
      .join("\n");
    if (data) yield JSON.parse(data);
  }
}

/** McpTransport: exchange(message, tool?, headers?) -> finite HTTP reply;
 * fail(reply, fixedReason) reports the actual completed capability call.
 * This fixture has one implementation. A future stdio transport needs its
 * own approved local entry; it must keep MCP approval transport-neutral.
 */
export class HttpMcpTransport {
  constructor(sdk, binding) {
    this.sdk = sdk;
    this.binding = binding;
    this.version = MODERN;
    this.session = undefined;
    this.expired = false;
  }
  async fail(reply, reason) {
    await this.sdk.failResponse(
      reply.callId,
      reason === "HTTP_REJECTED" ? "HTTP_REJECTED" : "RESPONSE_INVALID",
    );
    throw Error(reason);
  }
  async exchange(message, tool, extraHeaders = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.version,
      ...(this.version === MODERN ? { "Mcp-Method": message.method } : {}),
      ...(this.session ? { "MCP-Session-Id": this.session } : {}),
      ...extraHeaders,
    };
    const reply = await this.sdk.capability(
      "api",
      {
        kind: "service",
        operation: "request",
        binding: this.binding,
        sources: [],
        input: {
          path: "/mcp",
          method: "POST",
          headers,
          body: JSON.stringify(message),
        },
      },
      tool,
    );
    const response = reply.result;
    if (response.status === 404 && this.session) {
      this.session = undefined;
      this.expired = true;
    }
    let bytes = 0;
    for (const char of response.body) {
      const point = char.codePointAt(0);
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > MAX_BODY) return this.fail(reply, "MCP_RESPONSE_LIMIT");
    }
    if (
      message.id === undefined &&
      response.status === 202 &&
      response.body === ""
    )
      return { ...reply, status: response.status };
    // An empty legacy 400 is inspected by the client's era probe.
    if (response.status === 400 && response.body === "")
      return { ...reply, status: response.status };
    let decoded, modernError;
    try {
      const type = header(response.headers, "content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      const frames = [];
      for (const frame of messages(response.body, type)) {
        if (
          object(frame) &&
          frame.jsonrpc === "2.0" &&
          object(frame.error) &&
          [-32020, -32021, -32022].includes(frame.error.code)
        )
          modernError = frame;
        frames.push(frame);
      }
      let final;
      for (const frame of frames) {
        if (!object(frame) || frame.jsonrpc !== "2.0")
          throw Error("MCP_RESPONSE_INVALID");
        if (frame.id === undefined && typeof frame.method === "string")
          continue;
        if (
          frame.id !== message.id ||
          final ||
          Object.hasOwn(frame, "result") === Object.hasOwn(frame, "error") ||
          frame.method !== undefined
        )
          throw Error("MCP_RESPONSE_INVALID");
        if (Object.hasOwn(frame, "result") && !object(frame.result))
          throw Error("MCP_RESPONSE_INVALID");
        if (
          Object.hasOwn(frame, "error") &&
          (!object(frame.error) ||
            !Number.isInteger(frame.error.code) ||
            typeof frame.error.message !== "string")
        )
          throw Error("MCP_RESPONSE_INVALID");
        final = frame;
      }
      if (!final) throw Error("MCP_RESPONSE_INVALID");
      decoded = final;
    } catch (error) {
      if (error.message === "MCP_RESPONSE_LIMIT")
        return this.fail(reply, "MCP_RESPONSE_LIMIT");
      if (message.method === "server/discover" && response.status === 400)
        return {
          ...reply,
          status: response.status,
          ...(modernError ? { message: modernError } : {}),
        };
      return this.fail(
        reply,
        error.message === "MCP_RESPONSE_LIMIT"
          ? error.message
          : "MCP_RESPONSE_INVALID",
      );
    }
    if (
      message.method === "initialize" &&
      response.status === 200 &&
      decoded.result
    ) {
      const session = header(response.headers, "mcp-session-id");
      if (
        session !== undefined &&
        (typeof session !== "string" || !/^[\x21-\x7e]{1,256}$/.test(session))
      )
        return this.fail(reply, "MCP_RESPONSE_INVALID");
      this.session = session;
    }
    return { ...reply, status: response.status, message: decoded };
  }
}
