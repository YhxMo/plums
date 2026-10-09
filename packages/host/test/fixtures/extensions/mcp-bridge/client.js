import { MODERN, LEGACY, clientInfo } from "./http.js";
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function encodedHeader(value) {
  const text = String(value);
  if (
    /^[\x20-\x7e]*$/.test(text) &&
    text.trim() === text &&
    !(text.startsWith("=?base64?") && text.endsWith("?="))
  )
    return text;
  const bytes = [];
  for (const part of encodeURIComponent(text).match(/%[0-9A-F]{2}|./g) ?? [])
    bytes.push(
      part.startsWith("%") ? parseInt(part.slice(1), 16) : part.charCodeAt(0),
    );
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64 = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    base64 +=
      alphabet[(n >>> 18) & 63] +
      alphabet[(n >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : "=") +
      (i + 2 < bytes.length ? alphabet[n & 63] : "=");
  }
  return `=?base64?${base64}?=`;
}
// Only statically reachable primitive properties may mirror to headers.
function annotations(schema) {
  const found = [],
    names = new Set();
  function visit(node, path, reachable, depth) {
    if (depth > 24) throw Error("MCP_TOOL_INVALID");
    if (!object(node)) return;
    if (Object.hasOwn(node, "x-mcp-header")) {
      const name = node["x-mcp-header"];
      if (
        !reachable ||
        !path.length ||
        typeof name !== "string" ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        names.has(name.toLowerCase()) ||
        !["string", "integer", "boolean"].includes(node.type)
      )
        throw Error("MCP_TOOL_INVALID");
      names.add(name.toLowerCase());
      found.push({ name, path, type: node.type });
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && object(value)) {
        for (const [property, child] of Object.entries(value))
          visit(child, [...path, property], reachable, depth + 1);
      } else if (object(value)) visit(value, path, false, depth + 1);
      else if (Array.isArray(value))
        for (const child of value) visit(child, path, false, depth + 1);
    }
  }
  visit(schema, [], true, 0);
  return found;
}

export class McpClient {
  constructor(transport, sdk) {
    this.transport = transport;
    this.sdk = sdk;
    this.nextId = 1;
    this.ready = false;
  }
  message(method, params) {
    return {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params: {
        ...params,
        ...(this.transport.version === MODERN
          ? {
              _meta: {
                "io.modelcontextprotocol/protocolVersion": MODERN,
                "io.modelcontextprotocol/clientInfo": clientInfo,
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            }
          : {}),
      },
    };
  }
  async result(reply) {
    if (reply.status < 200 || reply.status >= 300)
      return this.transport.fail(reply, "HTTP_REJECTED");
    if (reply.message?.error)
      return this.transport.fail(reply, "MCP_REMOTE_ERROR");
    const result = reply.message?.result;
    if (!object(result))
      return this.transport.fail(reply, "MCP_RESPONSE_INVALID");
    const resultType = Object.hasOwn(result, "resultType")
      ? result.resultType
      : this.transport.version === LEGACY
        ? "complete"
        : undefined;
    if (resultType !== "complete")
      return this.transport.fail(reply, "MCP_RESULT_UNSUPPORTED");
    return result;
  }
  async connect() {
    if (this.transport.expired) {
      this.ready = false;
      this.transport.expired = false;
    }
    if (this.ready) return;
    this.transport.version = MODERN;
    this.transport.session = undefined;
    const probe = await this.transport.exchange(
      this.message("server/discover", {}),
    );
    // Only an unrecognized legacy 400 can select handshake semantics.
    if (
      probe.status === 400 &&
      ![-32020, -32021, -32022].includes(probe.message?.error?.code)
    ) {
      this.transport.version = LEGACY;
      const initialized = await this.transport.exchange(
        this.message("initialize", {
          protocolVersion: LEGACY,
          capabilities: {},
          clientInfo,
        }),
      );
      const info = await this.result(initialized);
      if (info.protocolVersion !== LEGACY || !object(info.capabilities?.tools))
        return this.transport.fail(initialized, "MCP_VERSION_UNSUPPORTED");
      const notification = await this.transport.exchange({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      if (notification.status !== 202)
        return this.transport.fail(notification, "MCP_RESPONSE_INVALID");
    } else {
      const info = await this.result(probe);
      if (
        !Array.isArray(info.supportedVersions) ||
        !info.supportedVersions.includes(MODERN) ||
        !object(info.capabilities?.tools)
      )
        return this.transport.fail(probe, "MCP_VERSION_UNSUPPORTED");
    }
    this.ready = true;
  }
  async list() {
    await this.connect();
    const tools = [],
      cursors = new Set(),
      names = new Set();
    let cursor,
      lastReply,
      total = 0;
    for (let page = 0; page < 16; page++) {
      const reply = await this.transport.exchange(
        this.message("tools/list", cursor ? { cursor } : {}),
      );
      lastReply = reply;
      const result = await this.result(reply);
      total += Array.isArray(result.tools) ? result.tools.length : 0;
      if (!Array.isArray(result.tools) || total > 1000)
        return this.transport.fail(reply, "MCP_RESPONSE_LIMIT");
      for (const tool of result.tools) {
        if (
          !object(tool) ||
          typeof tool.name !== "string" ||
          !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name) ||
          names.has(tool.name) ||
          (tool.description !== undefined &&
            typeof tool.description !== "string") ||
          !object(tool.inputSchema) ||
          tool.inputSchema.type !== "object"
        )
          return this.transport.fail(reply, "MCP_TOOL_INVALID");
        names.add(tool.name);
        if (this.transport.version === MODERN) {
          try {
            annotations(tool.inputSchema);
          } catch {
            continue;
          }
        }
        tools.push({
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
        });
      }
      if (result.nextCursor === undefined) {
        await this.sdk.mcpCheck(tools);
        return tools;
      }
      if (
        typeof result.nextCursor !== "string" ||
        !result.nextCursor ||
        cursors.has(result.nextCursor)
      )
        return this.transport.fail(reply, "MCP_RESPONSE_INVALID");
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    return this.transport.fail(lastReply, "MCP_PAGE_LIMIT");
  }
  async call(input) {
    // Refresh every page before each call. The host sees one complete list.
    const tools = await this.list();
    const tool = tools.find((tool) => tool.name === input.name);
    if (!tool) return { ok: false, content: "TOOL_UNKNOWN" };
    const headers = {};
    if (this.transport.version === MODERN) {
      headers["Mcp-Name"] = encodedHeader(input.name);
      for (const field of annotations(tool.inputSchema)) {
        let value = input.arguments;
        for (const key of field.path)
          value =
            object(value) && Object.hasOwn(value, key) ? value[key] : undefined;
        if (value == null) continue;
        if (
          (field.type === "integer" && !Number.isSafeInteger(value)) ||
          (field.type !== "integer" && typeof value !== field.type)
        )
          return { ok: false, content: "TOOL_INPUT_INVALID" };
        headers[`Mcp-Param-${field.name}`] = encodedHeader(value);
      }
    }
    const reply = await this.transport.exchange(
      this.message("tools/call", input),
      tool,
      headers,
    );
    const result = await this.result(reply);
    if (
      !Array.isArray(result.content) ||
      result.content.some(
        (block) =>
          !object(block) ||
          block.type !== "text" ||
          typeof block.text !== "string",
      ) ||
      (result.isError !== undefined && typeof result.isError !== "boolean")
    )
      return this.transport.fail(reply, "MCP_RESULT_UNSUPPORTED");
    return {
      ok: result.isError !== true,
      content: result.content.map((block) => block.text).join("\n"),
    };
  }
}
