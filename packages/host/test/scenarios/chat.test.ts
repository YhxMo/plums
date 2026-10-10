import { afterEach, expect, it } from "vitest";
import { desktopContribution } from "@plumsjs/sdk";
import { fixtureManifest } from "../fixtures/extensions/pack.js";
import { chatFixture, reply, toolReply } from "./chat-fixture.js";

const fixtures: Awaited<ReturnType<typeof chatFixture>>[] = [];
const fixture = async () => {
  const f = await chatFixture();
  fixtures.push(f);
  return f;
};
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

it("persists CAS memory and history across restart, supports upsert, and serializes concurrent chats", async () => {
  const f = await fixture();
  const agent = await f.create();
  await f.memory(agent.instanceId, "upsert", { id: "r", text: "old" });
  await f.memory(agent.instanceId, "upsert", { id: "r", text: "updated" });
  expect(await f.memory(agent.instanceId, "search", { query: "" })).toEqual([
    { id: "r", text: "updated" },
  ]);
  await Promise.all([
    f.chat(agent.instanceId, "first"),
    f.chat(agent.instanceId, "second"),
  ]);
  const saved = await f.history(agent.instanceId);
  expect(
    saved
      .filter((message) => message.role === "user")
      .map((message) => message.content),
  ).toEqual(["first", "second"]);
  expect(f.egress.inputs[1]!.messages.slice(1)).toEqual([
    ...saved.slice(0, 2),
    { role: "user", content: "second" },
  ]);
  await f.restart();
  await f.grant(agent.instanceId);
  expect(await f.history(agent.instanceId)).toEqual(saved);
  expect(
    await f.memory(agent.instanceId, "search", { query: "updated" }),
  ).toEqual([{ id: "r", text: "updated" }]);
});

it("runs without optional providers and uses the same command through the real frontend bridge", async () => {
  const f = await fixture();
  const agent = await f.create(["model-fake", "agent-loop"]);
  const frontend = await f.host.openFrontend(agent.instanceId);
  expect(frontend).toBeDefined();
  expect(
    await f.host.frontendInvoke(
      frontend!.context.sessionId,
      frontend!.context.handle,
      { kind: "commands", name: "chat", input: { text: "plain chat" } },
    ),
  ).toEqual(reply("Synthetic reply"));
  expect(f.egress.inputs).toEqual([
    { messages: [{ role: "user", content: "plain chat" }] },
  ]);
  expect(
    await f.host.frontendInvoke(
      frontend!.context.sessionId,
      frontend!.context.handle,
      { kind: "commands", name: "history", input: {} },
    ),
  ).toEqual([
    { role: "user", content: "plain chat" },
    reply("Synthetic reply").message,
  ]);
});

it("injects only the bound synthetic credential at the Sink and keeps it out of replies, histories, audit and exports", async () => {
  const f = await fixture();
  const agent = await f.create();
  await f.chat(agent.instanceId, "private chat sentinel");
  expect(f.egress.records[0]).toMatchObject({
    method: "POST",
    headers: { Authorization: "Bearer synthetic-scenario-credential" },
  });
  expect(JSON.stringify(f.egress.inputs)).not.toContain(
    "synthetic-scenario-credential",
  );
  const audit = JSON.stringify(await f.host.audit(agent.instanceId));
  expect(audit).not.toContain("synthetic-scenario-credential");
  expect(audit).not.toContain("private chat sentinel");
  expect(JSON.stringify(await f.history(agent.instanceId))).not.toContain(
    "synthetic-scenario-credential",
  );
  const exported = await f.host.exportAgent(agent.instanceId);
  const { readArchive } = await import("@plumsjs/core");
  // The exported archive's decoded files, not compressed bytes, are inspected below.
  const files = await readArchive(exported);
  const decoded: string[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith(".zip")) {
      for (const [file, content] of Object.entries(await readArchive(bytes)))
        decoded.push(
          `${name}/${file}: ${Buffer.from(content).toString("utf8")}`,
        );
    } else decoded.push(`${name}: ${Buffer.from(bytes).toString("utf8")}`);
  }
  expect(JSON.stringify(decoded)).not.toContain(
    "synthetic-scenario-credential",
  );
});

it.each([
  {
    transport: { status: 502, body: "private error body" },
    reason: "HTTP_REJECTED",
  },
  {
    transport: { status: 200, body: "invalid json private body" },
    reason: "RESPONSE_INVALID",
  },
])(
  "does not retry completed model failures ($reason) or save a fabricated reply",
  async ({ transport, reason }) => {
    const f = await fixture();
    const agent = await f.create();
    f.egress.transport = transport;
    await expect(
      f.chat(agent.instanceId, "failure sentinel"),
    ).rejects.toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { executionState: "completed", reason },
    });
    expect(f.egress.records).toHaveLength(1);
    expect(await f.history(agent.instanceId)).toEqual([]);
    const audit = JSON.stringify(await f.host.audit(agent.instanceId));
    expect(audit).not.toContain("private body");
    expect(audit).not.toContain("failure sentinel");
    f.egress.transport = undefined;
    expect(await f.chat(agent.instanceId, "recovered")).toEqual(
      reply("Synthetic reply"),
    );
  },
);

it("validates contribution input and model output and never weakens resource authorization", async () => {
  const f = await fixture();
  const agent = await f.create();
  await expect(
    f.host.invoke(
      agent.instanceId,
      "fixture.agent-loop",
      "fixture.agent-loop",
      "commands",
      "chat",
      { text: 3 },
    ),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: { reason: "CONTRIBUTION_INPUT_INVALID" },
  });
  expect(f.egress.records).toHaveLength(0);
  f.egress.respond = () => ({ message: { role: "assistant", content: 9 } });
  await expect(
    f.chat(agent.instanceId, "invalid response"),
  ).rejects.toMatchObject({
    code: "CAPABILITY_FAILED",
    details: {
      reason: "CONTRIBUTION_OUTPUT_INVALID",
      executionState: "completed",
    },
  });
  expect(f.egress.records).toHaveLength(1);
  expect(await f.history(agent.instanceId)).toEqual([]);
  const plan = await f.host.resourcePlan(agent.instanceId);
  const privateSpace = plan.spaces.find(
    (space) => space.ownerAgentId === agent.instanceId,
  )!;
  await f.host.setResourceQualification(
    agent.instanceId,
    plan.fingerprint,
    privateSpace.id,
    "fixture.agent-loop",
    [],
  );
  await expect(f.chat(agent.instanceId, "forbidden")).rejects.toBeDefined();
  expect(f.egress.records).toHaveLength(1);
});

it("reports unknown or malformed tools without masking platform denials", async () => {
  const f = await fixture();
  const agent = await f.create();
  expect(
    await f.tools(agent.instanceId, "call", { name: "unknown", arguments: {} }),
  ).toEqual({ ok: false, content: "TOOL_UNKNOWN" });
  expect(
    await f.tools(agent.instanceId, "call", {
      name: "memory_save",
      arguments: { id: "wrong" },
    }),
  ).toEqual({ ok: false, content: "TOOL_INPUT_INVALID" });
  f.egress.respond = (_input, i) =>
    i === 0 ? toolReply("unbound-tool", {}) : reply("Unknown tool handled");
  await f.chat(agent.instanceId, "unknown tool");
  expect(f.egress.inputs[1]!.messages.at(-1)).toEqual({
    role: "tool",
    toolCallId: "test-call",
    content: JSON.stringify({ ok: false, content: "TOOL_UNKNOWN" }),
  });
  await f.host.disable(agent.instanceId, "fixture.memory");
  await expect(
    f.memory(agent.instanceId, "search", { query: "" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

it("S-A shares one memory artifact while keeping tools, histories and introductions private to each Agent", async () => {
  const f = await fixture();
  const assistant = await f.create();
  const tutor = await f.create(
    ["model-fake", "agent-loop", "memory", "card-parser", "v3"],
    "v3",
  );
  const memoryDigest = f.artifacts.get("memory")!.digest;
  expect(
    (await f.host.listLibrary()).filter(
      (item) => item.manifest.id === "fixture.memory",
    ),
  ).toHaveLength(1);
  for (const agent of [assistant, tutor]) {
    expect(
      agent.components!.find(
        (component) => component.packageId === "fixture.memory",
      )!.digest,
    ).toBe(memoryDigest);
    expect((await f.protocols(agent.instanceId)).requirements).toEqual(
      expect.arrayContaining(
        ["model", "memory", "card"].map((requirementId) =>
          expect.objectContaining({
            consumerId: "fixture.agent-loop",
            requirement: expect.objectContaining({ id: requirementId }),
            state: "bound",
            autoBound: true,
          }),
        ),
      ),
    );
  }
  for (const [agent, id, text] of [
    [assistant, "harbor", "Harbor private record"],
    [tutor, "lesson", "Tutor private lesson"],
  ] as const) {
    expect(
      await f.tools(agent.instanceId, "call", {
        name: "memory_save",
        arguments: { id, text },
      }),
    ).toEqual({ ok: true, content: JSON.stringify({ id }) });
  }
  expect(
    await f.tools(tutor.instanceId, "call", {
      name: "memory_search",
      arguments: { query: "harbor" },
    }),
  ).toEqual({ ok: true, content: "[]" });
  expect(
    await f.tools(assistant.instanceId, "call", {
      name: "memory_search",
      arguments: { query: "tutor" },
    }),
  ).toEqual({ ok: true, content: "[]" });
  expect(await f.chat(assistant.instanceId, "harbor")).toEqual(
    reply("Synthetic reply"),
  );
  expect(await f.chat(tutor.instanceId, "lesson")).toEqual(
    reply("Synthetic reply"),
  );
  expect(f.egress.inputs[0]!.messages).toEqual([
    {
      role: "system",
      content:
        "I am a synthetic harbor guide.\nPatient and precise.\nA fictional test harbor.\nKeep fixture replies brief.",
    },
    { role: "system", content: "Harbor private record" },
    { role: "user", content: "harbor" },
  ]);
  expect(f.egress.inputs[1]!.messages[0]!.content).toContain(
    "I am a synthetic private tutor.",
  );
  expect(JSON.stringify(f.egress.inputs[1])).not.toContain(
    "Harbor private record",
  );
  expect(f.egress.inputs[0]!.tools!.map((tool) => tool.name)).toEqual([
    "memory_save",
    "memory_search",
  ]);
  expect(await f.history(assistant.instanceId)).toEqual([
    { role: "user", content: "harbor" },
    reply("Synthetic reply").message,
  ]);
  expect(await f.history(tutor.instanceId)).toEqual([
    { role: "user", content: "lesson" },
    reply("Synthetic reply").message,
  ]);
});

it("returns tool results to the model, preserves call identities and replays history in the next turn", async () => {
  const f = await fixture();
  const agent = await f.create();
  f.egress.respond = (_input, index) =>
    index === 0
      ? toolReply("memory_save", { id: "r", text: "remember this" })
      : reply("Saved");
  expect(await f.chat(agent.instanceId, "save it")).toEqual(reply("Saved"));
  const transcript = [
    { role: "user", content: "save it" },
    toolReply("memory_save", { id: "r", text: "remember this" }).message,
    {
      role: "tool",
      toolCallId: "test-call",
      content: JSON.stringify({
        ok: true,
        content: JSON.stringify({ id: "r" }),
      }),
    },
    reply("Saved").message,
  ];
  expect(await f.history(agent.instanceId)).toEqual(transcript);
  expect(f.egress.inputs[1]!.messages.slice(1)).toEqual(
    transcript.slice(0, -1),
  );
  expect(
    await f.memory(agent.instanceId, "search", { query: "REMEMBER" }),
  ).toEqual([{ id: "r", text: "remember this" }]);
  await f.chat(agent.instanceId, "next");
  expect(f.egress.inputs[2]!.messages.slice(1)).toEqual([
    ...transcript,
    { role: "user", content: "next" },
  ]);
});

it("stops after exactly eight model rounds and persists the completed tool transcript without retrying", async () => {
  const f = await fixture();
  const agent = await f.create();
  f.egress.respond = (_input, index) =>
    toolReply("memory_search", { query: "absent" }, `call-${index}`);
  expect(await f.chat(agent.instanceId, "loop")).toEqual({
    error: { code: "LOOP_LIMIT_EXCEEDED" },
  });
  expect(f.egress.records).toHaveLength(8);
  const history = await f.history(agent.instanceId);
  expect(history).toHaveLength(17);
  expect(history[0]).toEqual({ role: "user", content: "loop" });
  expect(
    history
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId),
  ).toEqual(Array.from({ length: 8 }, (_, i) => `call-${i}`));
});

it.each(["model-fake", "agent-loop", "memory", "tavern"])(
  "%s passes preview/importLibrary with v2 schema declarations",
  async (name) => {
    const f = await fixture();
    const manifest = await fixtureManifest(name);
    expect(manifest.formatVersion).toBe("2.0");
    const declaration = desktopContribution(manifest)!;
    expect(declaration.sdkVersion).toBe("2");
    if (["agent-loop", "memory"].includes(name)) {
      expect(declaration.common?.features).toContain("resources-cas");
      expect(
        manifest.permissions.some((p) =>
          ["engine", "fs", "exec"].includes(p.kind),
        ),
      ).toBe(false);
      expect(
        manifest.permissions.find((p) => p.kind === "resource"),
      ).toMatchObject({ target: "agent", operations: ["read", "write"] });
    }
    for (const contributions of Object.values(declaration.contributes!))
      for (const contribution of contributions!) {
        expect(contribution).toHaveProperty("inputSchema");
        expect(contribution).toHaveProperty("outputSchema");
      }
    expect(
      (await f.host.listLibrary()).some(
        (item) => item.digest === f.artifacts.get(name)!.digest,
      ),
    ).toBe(true);
  },
);
