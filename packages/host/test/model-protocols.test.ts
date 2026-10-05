import { expect, it } from "vitest";
import {
  modelRequest,
  modelResponse,
  modelProtocols,
} from "../../../examples/model-connector/runtime/protocols.js";
const messages = [
  { role: "system", content: "system instruction" },
  { role: "user", content: "a text question" },
];
const tools = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "read",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
];
it.each(modelProtocols)(
  "sends ordinary text using %s without forcing function tools",
  (protocol) => {
    const body = modelRequest(
      protocol,
      "arbitrary-model",
      { messages },
      "binding",
    );
    expect(JSON.stringify(body)).toContain("a text question");
    expect(JSON.stringify(body)).toContain("system instruction");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("temperature");
  },
);
it.each([
  [
    "OpenAI Chat Completions",
    { choices: [{ message: { role: "assistant", content: "text reply" } }] },
  ],
  [
    "OpenAI Responses",
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "text reply" }],
        },
      ],
    },
  ],
  ["Anthropic Messages", { content: [{ type: "text", text: "text reply" }] }],
  [
    "Gemini",
    { candidates: [{ content: { parts: [{ text: "text reply" }] } }] },
  ],
] as const)("normalizes %s text replies", (protocol, raw) => {
  expect(modelResponse(protocol, raw, "binding")).toMatchObject({
    choices: [{ message: { role: "assistant", content: "text reply" } }],
  });
});
it("preserves Responses encrypted reasoning, function calls, results and tool schemas without remote storage", () => {
  const output = [
    {
      type: "reasoning",
      id: "reason",
      summary: [],
      encrypted_content: "opaque-reasoning",
    },
    {
      type: "function_call",
      id: "fc",
      call_id: "call",
      name: "read_file",
      arguments: '{"path":"file"}',
    },
  ];
  const reply: any = modelResponse("OpenAI Responses", { output }, "binding");
  const body: any = modelRequest(
    "OpenAI Responses",
    "arbitrary-model",
    {
      messages: [
        ...messages,
        reply.choices[0].message,
        { role: "tool", tool_call_id: "call", content: "result" },
      ],
      tools,
    },
    "binding",
  );
  expect(body.input.slice(2, 4)).toEqual(output);
  expect(body.input[4]).toEqual({
    type: "function_call_output",
    call_id: "call",
    output: "result",
  });
  expect(body.store).toBe(false);
  expect(body.tools[0]).toMatchObject({
    type: "function",
    name: "read_file",
    parameters: tools[0]!.function.parameters,
    strict: false,
  });
});
it("preserves Anthropic thinking signatures and groups multiple tool results into one user turn", () => {
  const content = [
    {
      type: "thinking",
      thinking: "private thought",
      signature: "opaque-signature",
    },
    {
      type: "tool_use",
      id: "call",
      name: "read_file",
      input: { path: "file" },
    },
    {
      type: "tool_use",
      id: "call2",
      name: "read_file",
      input: { path: "file2" },
    },
  ];
  const reply: any = modelResponse(
    "Anthropic Messages",
    { content },
    "binding",
  );
  expect(reply.choices[0].message.content).toBeNull();
  const body: any = modelRequest(
    "Anthropic Messages",
    "arbitrary-model",
    {
      messages: [
        ...messages,
        reply.choices[0].message,
        { role: "tool", tool_call_id: "call", content: "result" },
        { role: "tool", tool_call_id: "call2", content: "result2" },
      ],
      tools,
    },
    "binding",
  );
  expect(body.system).toBe("system instruction");
  expect(body.messages[1].content).toEqual(content);
  expect(body.messages[2].content).toEqual([
    { type: "tool_result", tool_use_id: "call", content: "result" },
    { type: "tool_result", tool_use_id: "call2", content: "result2" },
  ]);
  expect(body.max_tokens).toBe(4096);
  expect(body.tools[0].input_schema).toEqual(tools[0]!.function.parameters);
});
it.each([true, false])(
  "preserves Gemini thought signatures and native call IDs (ID present: %s)",
  (withId) => {
    const parts = [
      {
        text: "private thought",
        thought: true,
        thoughtSignature: "opaque-text-signature",
      },
      {
        functionCall: {
          name: "read_file",
          args: { path: "file" },
          ...(withId ? { id: "native-call" } : {}),
        },
        thoughtSignature: "opaque-call-signature",
      },
    ];
    const reply: any = modelResponse(
      "Gemini",
      { candidates: [{ content: { parts } }] },
      "binding",
    );
    expect(reply.choices[0].message.content).toBeNull();
    const body: any = modelRequest(
      "Gemini",
      "arbitrary-model",
      {
        messages: [
          ...messages,
          reply.choices[0].message,
          {
            role: "tool",
            tool_call_id: reply.choices[0].message.tool_calls[0].id,
            content: '{"text":"file contents"}',
          },
        ],
        tools,
      },
      "binding",
    );
    expect(body.contents[1].parts).toEqual(parts);
    expect(body.contents[2].parts).toEqual([
      {
        functionResponse: {
          name: "read_file",
          response: { result: { text: "file contents" } },
          ...(withId ? { id: "native-call" } : {}),
        },
      },
    ]);
    expect(body.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual(
      tools[0]!.function.parameters,
    );
  },
);
it("does not replay native items after a model binding changes", () => {
  const reply: any = modelResponse(
    "OpenAI Responses",
    {
      output: [
        { type: "reasoning", encrypted_content: "old-private-state" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "reply" }],
        },
      ],
    },
    "old-binding",
  );
  const body = modelRequest(
    "OpenAI Responses",
    "new-model",
    { messages: [...messages, reply.choices[0].message] },
    "new-binding",
  );
  expect(JSON.stringify(body)).not.toContain("old-private-state");
  expect(JSON.stringify(body)).toContain("reply");
});
it.each(modelProtocols)(
  "rejects malformed %s responses instead of returning a false successful chat",
  (protocol) => {
    for (const raw of [
      null,
      [],
      {},
      { choices: [] },
      { content: [] },
      { output: [] },
      { candidates: [] },
    ])
      expect(() => modelResponse(protocol, raw, "binding")).toThrow();
  },
);
it("strips internal protocol metadata before Chat Completions and preserves its reasoning continuation", () => {
  const body: any = modelRequest(
    "OpenAI Chat Completions",
    "model",
    {
      messages: [
        ...messages,
        {
          role: "assistant",
          content: "reply",
          reasoning_content: "reason",
          _plumsModel: {
            binding: "other",
            items: [{ text: "other-provider-data" }],
          },
        },
      ],
    },
    "binding",
  );
  expect(body.messages[2].reasoning_content).toBe("reason");
  expect(JSON.stringify(body)).not.toContain("other-provider-data");
});
