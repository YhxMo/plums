import {
  RecordingEgressSink,
  type EgressRequest,
  type EgressResult,
  type McpTool,
} from "@plumsjs/core";
import { FakeModelSink, chatFixture } from "./chat-fixture.js";
import type { FoundationSelection } from "@plumsjs/sdk";

export const modern = "2026-07-28",
  legacy = "2025-11-25";
export const echoTool: McpTool = {
  name: "fixture_echo",
  description: "Synthetic MCP echo",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
};
export interface WireMessage {
  jsonrpc: string;
  id?: number;
  method: string;
  params?: {
    cursor?: string;
    name?: string;
    arguments?: Record<string, unknown>;
    protocolVersion?: string;
    capabilities?: object;
    clientInfo?: object;
    _meta?: Record<string, unknown>;
  };
}
export class FakeMcpSink extends FakeModelSink {
  readonly mcpRequests: { request: EgressRequest; message: WireMessage }[] = [];
  readonly sessions = new Set<string>();
  tools: McpTool[] = [structuredClone(echoTool)];
  pageSize = 2;
  callError = false;
  overrideReply?: (message: WireMessage) => EgressResult | undefined;
  transformResult?: (
    message: WireMessage,
    result: Record<string, unknown>,
  ) => Record<string, unknown>;
  constructor(
    readonly version = modern,
    readonly sse = false,
  ) {
    super();
  }
  header(request: EgressRequest, name: string) {
    return Object.entries(request.headers ?? {}).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1];
  }
  override async send(request: EgressRequest): Promise<EgressResult> {
    if (request.url === "https://model.plums-fixture.test/complete")
      return super.send(request);
    if (
      request.url !== "https://mcp.plums-fixture.test/mcp" ||
      request.method !== "POST"
    )
      throw Error("Unexpected MCP destination");
    await RecordingEgressSink.prototype.send.call(this, request);
    const message = JSON.parse(request.body!) as WireMessage;
    this.mcpRequests.push({ request: structuredClone(request), message });
    if (
      message.jsonrpc !== "2.0" ||
      this.header(request, "accept") !==
        "application/json, text/event-stream" ||
      this.header(request, "content-type") !== "application/json"
    )
      throw Error("Incorrect MCP framing");
    const overridden = this.overrideReply?.(message);
    if (overridden) return overridden;
    const response = (
      result: object,
      headers: Record<string, string> = {},
    ): EgressResult => {
      const completed = {
        ...(this.version === modern ? { resultType: "complete" } : {}),
        ...result,
      };
      const payload = {
        jsonrpc: "2.0",
        id: message.id,
        result: this.transformResult?.(message, completed) ?? completed,
      };
      return this.sse
        ? {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              ...headers,
            },
            body:
              ': synthetic comment\r\nid: prime\r\ndata:\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\r\n\r\nevent: message\r\ndata: ' +
              JSON.stringify(payload, null, 2).replace(/\n/g, "\r\ndata: ") +
              "\r\n\r\n",
          }
        : {
            status: 200,
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify(payload),
          };
    };
    if (message.method === "server/discover") {
      if (this.version === legacy) return { status: 400, body: "" };
      this.assertModern(request, message);
      return response({
        supportedVersions: [modern],
        capabilities: { tools: {} },
        _meta: {
          "io.modelcontextprotocol/serverInfo": {
            name: "Synthetic MCP",
            version: "1.0.0",
          },
        },
      });
    }
    if (message.method === "initialize") {
      if (
        message.params?.protocolVersion !== legacy ||
        !message.params.clientInfo ||
        !message.params.capabilities ||
        this.header(request, "mcp-session-id")
      )
        throw Error("Incorrect legacy handshake");
      const session = `synthetic-session-${this.sessions.size + 1}`;
      this.sessions.add(session);
      return response(
        {
          protocolVersion: legacy,
          capabilities: { tools: {} },
          serverInfo: { name: "Synthetic MCP", version: "1.0.0" },
        },
        { "mCp-SeSsIoN-Id": session },
      );
    }
    if (this.version === legacy) {
      if (
        this.header(request, "mcp-protocol-version") !== legacy ||
        !this.sessions.has(this.header(request, "mcp-session-id") ?? "")
      )
        throw Error("Missing negotiated session");
    } else this.assertModern(request, message);
    if (message.method === "notifications/initialized")
      return { status: 202, body: "" };
    if (message.method === "tools/list") {
      const start = message.params?.cursor ? Number(message.params.cursor) : 0;
      return response({
        tools: this.tools.slice(start, start + this.pageSize),
        ...(start + this.pageSize < this.tools.length
          ? { nextCursor: String(start + this.pageSize) }
          : {}),
      });
    }
    if (message.method === "tools/call") {
      if (!this.tools.some((tool) => tool.name === message.params?.name))
        throw Error("Unknown MCP tool executed");
      if (
        this.version === modern &&
        this.header(request, "mcp-name") !== message.params?.name
      )
        throw Error("Mismatched tool header");
      return response({
        content: [
          { type: "text", text: `Echo: ${message.params?.arguments?.text}` },
        ],
        ...(this.callError ? { isError: true } : {}),
      });
    }
    throw Error("Unexpected MCP method");
  }
  private assertModern(request: EgressRequest, message: WireMessage) {
    const meta = message.params?._meta;
    if (
      this.header(request, "mcp-protocol-version") !== modern ||
      this.header(request, "mcp-method") !== message.method ||
      meta?.["io.modelcontextprotocol/protocolVersion"] !== modern ||
      !meta["io.modelcontextprotocol/clientInfo"] ||
      !meta["io.modelcontextprotocol/clientCapabilities"] ||
      this.header(request, "mcp-session-id")
    )
      throw Error("Missing stateless request metadata");
  }
  get calls() {
    return this.mcpRequests.filter(
      ({ message }) => message.method === "tools/call",
    );
  }
}
export async function mcpFixture(
  version = modern,
  sse = false,
  foundation?: FoundationSelection,
) {
  const egress = new FakeMcpSink(version, sse);
  const f = await chatFixture(foundation, egress);
  const bridge = (
    agent: string,
    operation: "list" | "call",
    input: object = {},
  ) =>
    f.host.invoke(
      agent,
      "fixture.mcp-bridge",
      "fixture.mcp-bridge",
      "connectors",
      "tools",
      { operation, input },
    );
  return {
    ...f,
    get host() {
      return f.host;
    },
    egress,
    create: () => f.create(["model-fake", "mcp-bridge", "agent-loop"]),
    bridge,
    approve: (agent: string) =>
      f.host.approveMcp(agent, "fixture.mcp-bridge", "api", egress.tools),
  };
}
