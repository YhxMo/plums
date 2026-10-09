import { afterEach, expect, it } from "vitest";
import { desktopContribution } from "@plums/sdk";
import { createArchive, readArchive, type AuditEvent } from "@plums/core";
import { fixtureManifest, packExtension } from "../fixtures/extensions/pack.js";
import { reply, toolReply } from "./chat-fixture.js";
import {
  echoTool,
  legacy,
  modern,
  mcpFixture,
  type WireMessage,
} from "./mcp-fixture.js";

const fixtures: Awaited<ReturnType<typeof mcpFixture>>[] = [];
async function fixture(version = modern, sse = false) {
  const f = await mcpFixture(version, sse);
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

it.each([
  { version: modern, sse: false },
  { version: modern, sse: true },
  { version: legacy, sse: false },
  { version: legacy, sse: true },
])(
  "S-D checks approval, changes and disappearance through the model → loop → MCP bridge ($version, SSE=$sse)",
  async ({ version, sse }) => {
    const f = await fixture(version, sse),
      agent = await f.create(),
      id = agent.instanceId;
    const manifest = await fixtureManifest("mcp-bridge");
    expect(manifest.kind).toBe("connector");
    expect(manifest.formatVersion).toBe("2.0");
    expect(desktopContribution(manifest)?.sdkVersion).toBe("2");
    expect(manifest.permissions).toEqual([
      {
        id: "api",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Test-only remote MCP service",
      },
    ]);
    expect(
      (await f.protocols(id)).requirements.find(
        (r) => r.requirement.id === "tools-mcp",
      ),
    ).toMatchObject({
      autoBound: true,
      selected: { providerId: "fixture.mcp-bridge", provideId: "tools" },
    });
    f.egress.respond = (input) =>
      input.messages.at(-1)?.role === "tool"
        ? reply("MCP result received")
        : toolReply("fixture_echo", { text: "call sentinel" }, "mcp-call");
    await expect(f.chat(id, "unapproved")).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(f.egress.calls).toHaveLength(0);
    expect(await f.history(id)).toEqual([]);
    const approval = (await f.approve(id)) as object[];
    expect(Object.keys(approval[0]!).sort()).toEqual([
      "approvedAt",
      "fingerprint",
      "permissionId",
      "tool",
    ]);
    expect(await f.chat(id, "approved")).toEqual(reply("MCP result received"));
    expect(f.egress.calls).toHaveLength(1);
    expect(f.egress.inputs.at(-1)!.messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "mcp-call",
      content: JSON.stringify({ ok: true, content: "Echo: call sentinel" }),
    });
    for (const change of ["description", "schema"]) {
      f.egress.tools = [
        {
          ...echoTool,
          ...(change === "description"
            ? { description: "Changed echo" }
            : {
                inputSchema: {
                  type: "object",
                  properties: {
                    text: { type: "string" },
                    extra: { type: "boolean" },
                  },
                },
              }),
        },
      ];
      const count = f.egress.calls.length;
      await expect(f.chat(id, "changed")).rejects.toMatchObject({
        code: "CONSENT_REQUIRED",
      });
      expect(f.egress.calls).toHaveLength(count);
      await f.approve(id);
      expect(await f.chat(id, "reapproved")).toEqual(
        reply("MCP result received"),
      );
      expect(f.egress.calls).toHaveLength(count + 1);
    }
    f.egress.tools = [];
    expect(await f.bridge(id, "list")).toEqual([]);
    const count = f.egress.calls.length;
    f.egress.tools = [structuredClone(echoTool)];
    await expect(f.chat(id, "returned tool")).rejects.toMatchObject({
      code: "CONSENT_REQUIRED",
    });
    expect(f.egress.calls).toHaveLength(count);
    await f.approve(id);
    await f.chat(id, "approved again");
    expect(f.egress.calls).toHaveLength(count + 1);
    const methods = f.egress.mcpRequests.map(({ message }) => message.method);
    expect(methods.filter((m) => m === "initialize")).toHaveLength(
      version === legacy ? 1 : 0,
    );
    expect(
      methods.filter((m) => m === "notifications/initialized"),
    ).toHaveLength(version === legacy ? 1 : 0);
    const audit = JSON.stringify(await f.host.audit(id));
    expect(audit).not.toContain("call sentinel");
    expect(audit).not.toContain("synthetic-scenario-credential");
    expect(audit).not.toContain("Echo:");
  },
);

it("reports a complete paginated list once and never replays a remote tool error", async () => {
  const f = await fixture(),
    { instanceId: id } = await f.create();
  f.egress.tools = [
    echoTool,
    ...["a", "b", "c"].map((name) => ({ ...echoTool, name })),
  ];
  expect(await f.bridge(id, "list")).toEqual(f.egress.tools);
  expect(
    f.egress.mcpRequests
      .filter(({ message }) => message.method === "tools/list")
      .map(({ message }) => message.params?.cursor),
  ).toEqual([undefined, "2"]);
  await f.approve(id);
  f.egress.callError = true;
  expect(
    await f.bridge(id, "call", {
      name: echoTool.name,
      arguments: { text: "error" },
    }),
  ).toEqual({ ok: false, content: "Echo: error" });
  expect(f.egress.calls).toHaveLength(1);
});

it("cannot inherit the bridge HTTPS declaration in an unprivileged caller", async () => {
  const f = await fixture();
  const files = await readArchive(await packExtension("agent-loop"));
  const manifest = JSON.parse(Buffer.from(files["manifest.json"]!).toString());
  manifest.permissions = manifest.permissions.filter(
    (p: { kind: string }) => p.kind !== "service",
  );
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
  f.artifacts.set("agent-loop", await f.put(await createArchive(files)));
  const { instanceId: id } = await f.create();
  await f.bridge(id, "list");
  await f.approve(id);
  const count = f.egress.mcpRequests.length;
  await expect(f.chat(id, "forbidden")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
  expect(f.egress.mcpRequests).toHaveLength(count);
  expect(f.egress.calls).toHaveLength(0);
});

it("mirrors approved primitive metadata with UTF-8 Base64 and excludes invalid tool definitions", async () => {
  const f = await fixture(),
    { instanceId: id } = await f.create();
  f.egress.tools = [
    {
      ...echoTool,
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", "x-mcp-header": "Text" },
          nested: {
            type: "object",
            properties: { count: { type: "integer", "x-mcp-header": "Count" } },
          },
        },
      },
    },
    {
      ...echoTool,
      name: "invalid",
      inputSchema: {
        type: "object",
        properties: { text: { type: "number", "x-mcp-header": "Bad" } },
      },
    },
  ];
  const tools = (await f.bridge(id, "list")) as (typeof echoTool)[];
  expect(tools.map((t) => t.name)).toEqual([echoTool.name]);
  await f.host.approveMcp(id, "fixture.mcp-bridge", "api", tools);
  await f.bridge(id, "call", {
    name: echoTool.name,
    arguments: { text: "你好", nested: { count: 7 } },
  });
  expect(f.egress.calls[0]!.request.headers).toMatchObject({
    "Mcp-Param-Text": "=?base64?5L2g5aW9?=",
    "Mcp-Param-Count": "7",
    "Mcp-Name": echoTool.name,
  });
});

function rpc(message: WireMessage, result: object) {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { resultType: "complete", ...result },
    }),
  };
}
it.each([
  "malformed",
  "wrong-id",
  "duplicate",
  "partial-sse",
  "oversized",
  "rpc-error",
  "redirect",
  "input-required",
])(
  "refuses %s completed responses without retrying tools/call",
  async (failure) => {
    const f = await fixture(),
      { instanceId: id } = await f.create();
    await f.bridge(id, "list");
    await f.approve(id);
    f.egress.overrideReply = (message) => {
      if (message.method !== "tools/call") return;
      if (failure === "malformed")
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: "secret invalid body",
        };
      if (failure === "wrong-id")
        return {
          ...rpc(message, {}),
          body: JSON.stringify({ jsonrpc: "2.0", id: 9999, result: {} }),
        };
      if (failure === "oversized")
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: "x".repeat(256 * 1024 + 1),
        };
      if (failure === "rpc-error")
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32602, message: "secret server message" },
          }),
        };
      if (failure === "redirect")
        return {
          status: 302,
          body: "",
          redirectTo: "https://other.plums-fixture.test",
        };
      if (failure === "input-required")
        return rpc(message, {
          resultType: "input_required",
          inputRequests: [],
        });
      const data =
        "data: " +
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [] },
        });
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: failure === "duplicate" ? `${data}\n\n${data}\n\n` : data,
      };
    };
    await expect(
      f.bridge(id, "call", {
        name: echoTool.name,
        arguments: { text: "input secret" },
      }),
    ).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { executionState: "completed" },
    });
    expect(f.egress.calls).toHaveLength(1);
    const audit = JSON.stringify(await f.host.audit(id));
    expect(audit).not.toContain("secret");
  },
);

it.each(
  [-32020, -32021, -32022].flatMap((code) =>
    ["matched", "null", "missing", "mismatched"].flatMap((responseId) =>
      [false, true].map((sse) => ({ code, responseId, sse })),
    ),
  ),
)(
  "does not downgrade a modern protocol error ($code, id=$responseId, SSE=$sse) into legacy initialization",
  async ({ code, responseId, sse }) => {
    const f = await fixture(),
      { instanceId: id } = await f.create();
    f.egress.overrideReply = (message) => {
      const body = JSON.stringify({
        jsonrpc: "2.0",
        ...(responseId === "missing"
          ? {}
          : {
              id:
                responseId === "matched"
                  ? message.id
                  : responseId === "null"
                    ? null
                    : 9999,
            }),
        error: {
          code,
          message: "modern protocol error",
          data: { supported: ["1900-01-01"] },
        },
      });
      return {
        status: 400,
        headers: {
          "content-type": sse ? "text/event-stream" : "application/json",
        },
        body: sse ? `data: ${body}\n\n` : body,
      };
    };
    await expect(f.bridge(id, "list")).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { executionState: "completed" },
    });
    expect(f.egress.mcpRequests.map(({ message }) => message.method)).toEqual([
      "server/discover",
    ]);
  },
);

it("starts a fresh legacy session after expiry on the next explicit call, without replaying the expired operation", async () => {
  const f = await fixture(legacy),
    { instanceId: id } = await f.create();
  await f.bridge(id, "list");
  await f.approve(id);
  let expired = false;
  f.egress.overrideReply = (message) => {
    if (message.method === "tools/call" && !expired) {
      expired = true;
      return {
        status: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "expired" },
        }),
      };
    }
  };
  await expect(
    f.bridge(id, "call", { name: echoTool.name, arguments: { text: "first" } }),
  ).rejects.toBeDefined();
  expect(f.egress.calls).toHaveLength(1);
  expect(
    await f.bridge(id, "call", {
      name: echoTool.name,
      arguments: { text: "second" },
    }),
  ).toEqual({ ok: true, content: "Echo: second" });
  expect(f.egress.calls).toHaveLength(2);
  expect(
    f.egress.mcpRequests.filter(
      ({ message }) => message.method === "initialize",
    ),
  ).toHaveLength(2);
});

it("preserves tool approval through a failed partial list and host restart, without persisting the HTTP session", async () => {
  const f = await fixture(legacy),
    { instanceId: id } = await f.create();
  f.egress.tools = [
    echoTool,
    ...["a", "b"].map((name) => ({ ...echoTool, name })),
  ];
  await f.bridge(id, "list");
  await f.approve(id);
  f.egress.overrideReply = (message) =>
    message.method === "tools/list" && message.params?.cursor
      ? {
          status: 200,
          headers: { "content-type": "application/json" },
          body: "invalid second page",
        }
      : undefined;
  await expect(f.bridge(id, "list")).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { executionState: "completed" },
  });
  f.egress.overrideReply = undefined;
  await f.restart();
  await f.grant(id);
  expect(
    await f.bridge(id, "call", {
      name: echoTool.name,
      arguments: { text: "after restart" },
    }),
  ).toEqual({ ok: true, content: "Echo: after restart" });
  expect(
    f.egress.mcpRequests.filter(
      ({ message }) => message.method === "initialize",
    ),
  ).toHaveLength(2);
  expect(f.egress.calls).toHaveLength(1);
});

it.each(["cursor-loop", "page-limit", "tool-limit", "utf8-limit"])(
  "refuses incomplete or oversized tool lists (%s) before executing tools",
  async (failure) => {
    const f = await fixture(),
      { instanceId: id } = await f.create();
    let page = 0;
    f.egress.overrideReply = (message) => {
      if (message.method !== "tools/list") return;
      page++;
      if (failure === "cursor-loop")
        return rpc(message, { tools: [], nextCursor: "same" });
      if (failure === "page-limit")
        return rpc(message, { tools: [], nextCursor: String(page) });
      if (failure === "utf8-limit")
        return rpc(message, { tools: [], note: "字".repeat(90_000) });
      return rpc(message, {
        tools: Array.from({ length: 1001 }, (_, i) => ({
          ...echoTool,
          name: `tool_${i}`,
        })),
      });
    };
    await expect(f.bridge(id, "list")).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { executionState: "completed" },
    });
    expect(f.egress.calls).toHaveLength(0);
    expect(page).toBe(
      failure === "cursor-loop" ? 2 : failure === "page-limit" ? 16 : 1,
    );
  },
);

it("accepts an unrecognized legacy HTTP 400 probe and rejects malformed contribution input before I/O", async () => {
  const f = await fixture(legacy),
    { instanceId: id } = await f.create();
  f.egress.overrideReply = (message) =>
    message.method === "server/discover"
      ? {
          status: 400,
          headers: { "content-type": "text/plain" },
          body: "Initialization required",
        }
      : undefined;
  expect(await f.bridge(id, "list")).toEqual([echoTool]);
  const count = f.egress.mcpRequests.length;
  await expect(
    f.bridge(id, "call", { name: 3, arguments: {} }),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { reason: "CONTRIBUTION_INPUT_INVALID" },
  });
  expect(f.egress.mcpRequests).toHaveLength(count);
});

it.each(
  [modern, legacy].flatMap((version) =>
    [false, true].flatMap((sse) =>
      ["handshake", "list", "call"].flatMap((stage) =>
        ["missing", "null", "complete", "input_required"].map(
          (classification) => ({
            version,
            sse,
            stage,
            classification,
          }),
        ),
      ),
    ),
  ),
)(
  "classifies completed MCP results explicitly ($version, SSE=$sse, $stage, $classification)",
  async ({ version, sse, stage, classification }) => {
    const f = await fixture(version, sse),
      { instanceId: id } = await f.create();
    if (stage === "call") {
      await f.bridge(id, "list");
      await f.approve(id);
    }
    const method =
      stage === "handshake"
        ? version === modern
          ? "server/discover"
          : "initialize"
        : stage === "list"
          ? "tools/list"
          : "tools/call";
    f.egress.transformResult = (message, result) => {
      if (message.method !== method) return result;
      const altered: Record<string, unknown> = {
        ...result,
        _meta: { sentinel: "unlogged response marker" },
      };
      if (classification === "missing") delete altered.resultType;
      else
        altered.resultType = classification === "null" ? null : classification;
      return altered;
    };
    const operation =
      stage === "call"
        ? f.bridge(id, "call", {
            name: echoTool.name,
            arguments: { text: "result classification" },
          })
        : f.bridge(id, "list");
    const accepted =
      classification === "complete" ||
      (version === legacy && classification === "missing");
    if (accepted) {
      expect(await operation).toEqual(
        stage === "call"
          ? { ok: true, content: "Echo: result classification" }
          : [echoTool],
      );
    } else {
      const failure = await operation.catch((error) => error);
      expect(failure).toMatchObject({
        code: "CAPABILITY_FAILED",
        details: {
          reason: "RESPONSE_INVALID",
          executionState: "completed",
          callId: expect.any(String),
        },
      });
      const audit = (await f.host.audit(id)) as AuditEvent[];
      const callId = (failure as { details: { callId: string } }).details
        .callId;
      expect(
        audit.filter(
          (event) =>
            event.callId === callId &&
            event.phase === "result" &&
            event.outcome === "failed",
        ),
      ).toHaveLength(1);
    }
    expect(
      f.egress.mcpRequests.filter((item) => item.message.method === method),
    ).toHaveLength(1);
    expect(f.egress.calls).toHaveLength(stage === "call" ? 1 : 0);
    const audit = JSON.stringify(await f.host.audit(id));
    expect(audit).not.toContain("unlogged response marker");
    expect(audit).not.toContain("result classification");
    expect(audit).not.toContain("synthetic-scenario-credential");
  },
);

it.each([false, true])(
  "rejects an unclassified modern tool result through the model loop without replay or false history (SSE=%s)",
  async (sse) => {
    const f = await fixture(modern, sse),
      { instanceId: id } = await f.create();
    await f.bridge(id, "list");
    await f.approve(id);
    f.egress.respond = () =>
      toolReply(
        "fixture_echo",
        { text: "unlogged loop argument" },
        "classification-call",
      );
    f.egress.transformResult = (message, result) =>
      message.method === "tools/call"
        ? { ...result, resultType: null }
        : result;
    await expect(f.chat(id, "reject result")).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { reason: "RESPONSE_INVALID", executionState: "completed" },
    });
    expect(f.egress.calls).toHaveLength(1);
    expect(f.egress.inputs).toHaveLength(1);
    expect(await f.history(id)).toEqual([]);
    const audit = JSON.stringify(await f.host.audit(id));
    expect(audit).not.toContain("unlogged loop argument");
    expect(audit).not.toContain("synthetic-scenario-credential");
  },
);

it.each(
  ["Project-ID", "Project_ID", "Project.ID", "Project!ID"].flatMap((header) =>
    [false, true].map((sse) => ({ header, sse })),
  ),
)(
  "carries legal HTTP token annotations through the full model loop ($header, SSE=$sse)",
  async ({ header, sse }) => {
    const f = await fixture(modern, sse),
      { instanceId: id } = await f.create();
    f.egress.tools = [
      {
        ...echoTool,
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", "x-mcp-header": header } },
          required: ["text"],
          additionalProperties: false,
        },
      },
    ];
    await f.bridge(id, "list");
    await f.approve(id);
    f.egress.respond = (input) =>
      input.messages.at(-1)?.role === "tool"
        ? reply("Token header received")
        : toolReply(echoTool.name, { text: "token annotation" }, "header-call");
    expect(await f.chat(id, "header test")).toEqual(
      reply("Token header received"),
    );
    expect(f.egress.calls).toHaveLength(1);
    expect(f.egress.calls[0]!.request.headers?.["Mcp-Param-" + header]).toBe(
      "token annotation",
    );
    expect(f.egress.inputs).toHaveLength(2);
    expect(f.egress.inputs[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "header-call",
      content: JSON.stringify({ ok: true, content: "Echo: token annotation" }),
    });
    const audit = JSON.stringify(await f.host.audit(id));
    expect(audit).not.toContain("token annotation");
    expect(audit).not.toContain("synthetic-scenario-credential");
  },
);
