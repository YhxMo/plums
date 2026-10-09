import { afterEach, expect, it } from "vitest";
import { cardFixture } from "../fixtures/extensions/pack.js";
import { chatFixture, reply, type ChatMessage } from "./chat-fixture.js";

const fixtures: Awaited<ReturnType<typeof chatFixture>>[] = [];
const fixture = async () => {
  const f = await chatFixture();
  fixtures.push(f);
  return f;
};
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
const user = (content: string): ChatMessage => ({ role: "user", content });
async function withBook(
  f: Awaited<ReturnType<typeof fixture>>,
  version: "v2" | "v3",
  modify?: (book: any) => void,
) {
  const raw = JSON.parse((await cardFixture("worldbook")).toString());
  if (version === "v3") {
    raw.spec = "chara_card_v3";
    raw.spec_version = "3.0";
    raw.data.group_only_greetings = [];
  }
  modify?.(raw.data.character_book);
  f.artifacts.set("book", await f.put(Buffer.from(JSON.stringify(raw))));
  return f.create(
    ["model-fake", "agent-loop", "memory", "card-parser", "tavern", "book"],
    "book",
  );
}

it.each(["v2", "v3"] as const)(
  "S-C %s worldbook reaches the actual model request in insertion order around the introduction",
  async (version) => {
    const f = await fixture();
    const agent = await withBook(f, version);
    expect(await f.chat(agent.instanceId, "PORT LIGHT night Exact")).toEqual(
      reply("Synthetic reply"),
    );
    expect(f.egress.inputs[0]!.messages).toEqual([
      { role: "system", content: "Keyword before card." },
      { role: "system", content: "Always before card." },
      { role: "system", content: "Case-sensitive before card." },
      {
        role: "system",
        content:
          "I am a synthetic harbor guide.\nPatient and precise.\nA fictional test harbor.\nKeep fixture replies brief.",
      },
      { role: "system", content: "Selective after card." },
      user("PORT LIGHT night Exact"),
    ]);
    const actual = JSON.stringify(f.egress.inputs[0]);
    for (const content of [
      "Outside scan depth.",
      "Unmatched entry.",
      "Disabled constant.",
      "Recursion must stay off.",
    ])
      expect(actual).not.toContain(content);
  },
);

it("respects scan depth, case sensitivity and secondary keywords without scanning injected text", async () => {
  const f = await fixture();
  const agent = await withBook(f, "v2");
  const context = await f.context(agent.instanceId, [
    user("outside"),
    user("port LIGHT"),
    user("exact"),
  ]);
  expect(context).toEqual({
    system: [],
    injections: [
      { position: "before_char", content: "Keyword before card." },
      { position: "before_char", content: "Always before card." },
    ],
    unsupported: [],
  });
  expect(
    await f.context(agent.instanceId, [user("LIGHT"), user("night Exact")]),
  ).toMatchObject({
    injections: [
      { position: "before_char", content: "Always before card." },
      { position: "before_char", content: "Case-sensitive before card." },
      { position: "after_char", content: "Selective after card." },
    ],
  });
});

it.each([undefined, 0] as const)(
  "uses default four messages or explicit zero scan depth (%s)",
  async (depth) => {
    const f = await fixture();
    const agent = await withBook(f, "v2", (book) => {
      if (depth === undefined) delete book.scan_depth;
      else book.scan_depth = depth;
    });
    const result = await f.context(agent.instanceId, [
      user("outside"),
      user("port"),
      user("nothing"),
      user("nothing"),
      user("nothing"),
    ]);
    expect(result).toMatchObject({
      injections:
        depth === 0
          ? [{ position: "before_char", content: "Always before card." }]
          : [
              { position: "before_char", content: "Keyword before card." },
              { position: "before_char", content: "Always before card." },
            ],
    });
  },
);

it.each(["card-parser", "card-parser-alt"])(
  "reports unsupported standard fields via %s and ignores regex, recursion, decorators and token budget",
  async (parser) => {
    const f = await fixture();
    const raw = JSON.parse((await cardFixture("worldbook")).toString());
    raw.data.character_book.recursive_scanning = true;
    raw.data.character_book.token_budget = 0;
    raw.data.character_book.entries.push({
      keys: ["^port$"],
      use_regex: true,
      content: "Regex must stay off.",
      enabled: true,
      insertion_order: 1,
      extensions: {},
    });
    raw.data.character_book.entries[0].content = "@@dont_activate\nrecursive";
    f.artifacts.set("book", await f.put(Buffer.from(JSON.stringify(raw))));
    const agent = await f.create(
      ["model-fake", "agent-loop", parser, "tavern", "book"],
      "book",
    );
    const result = await f.context(agent.instanceId, [user("port")]);
    expect(result).toEqual({
      system: [],
      injections: [
        { position: "before_char", content: "Keyword before card." },
        { position: "before_char", content: "recursive" },
      ],
      unsupported: [
        "decorators",
        "recursive-scanning",
        "regex",
        "token-budget",
      ],
    });
    await f.chat(agent.instanceId, "port");
    const actual = JSON.stringify(f.egress.inputs[0]);
    expect(actual).not.toContain("@@dont_activate");
    expect(actual).not.toContain("Regex must stay off.");
    expect(actual).not.toContain("Recursion must stay off.");
    expect(actual).toContain("Keyword before card.");
  },
);

it.each(["v2", "v3"] as const)(
  "R5 switches both consumers to the alternative parser in the same %s Agent without changing results",
  async (version) => {
    const f = await fixture();
    const agent = await withBook(f, version);
    const before = await f.context(agent.instanceId, [
      user("port LIGHT night Exact"),
    ]);
    const replyBefore = await f.chat(
      agent.instanceId,
      "port LIGHT night Exact",
    );
    await f.host.addLibraryComponent(
      agent.instanceId,
      f.artifacts.get("card-parser-alt")!.digest,
    );
    await f.host.enable(agent.instanceId, "fixture.card-parser-alt");
    for (const consumerId of ["fixture.agent-loop", "fixture.tavern"]) {
      const plan = await f.protocols(agent.instanceId);
      const selected = plan.requirements
        .find(
          (r) => r.consumerId === consumerId && r.requirement.id === "card",
        )!
        .candidates.find(
          (c) => c.intent.providerId === "fixture.card-parser-alt",
        )!.intent;
      await f.host.setProtocolBinding(
        agent.instanceId,
        plan.fingerprint,
        consumerId,
        "card",
        selected,
      );
    }
    await f.grant(agent.instanceId);
    expect(
      await f.context(agent.instanceId, [user("port LIGHT night Exact")]),
    ).toEqual(before);
    expect(await f.chat(agent.instanceId, "port LIGHT night Exact")).toEqual(
      replyBefore,
    );
    expect(
      f.egress.inputs[1]!.messages.filter((m) => m.role === "system"),
    ).toEqual(f.egress.inputs[0]!.messages.filter((m) => m.role === "system"));
  },
);

it("a card with no worldbook produces no injections, and an unrecognized card stops before the model", async () => {
  const f = await fixture();
  const agent = await f.create(
    ["model-fake", "agent-loop", "card-parser", "tavern", "v1"],
    "v1",
  );
  expect(await f.context(agent.instanceId, [user("port")])).toEqual({
    system: [],
    injections: [],
    unsupported: [],
  });
  const invalid = await f.create(
    ["model-fake", "agent-loop", "card-parser", "tavern", "non-card"],
    "non-card",
  );
  expect(await f.chat(invalid.instanceId, "port")).toEqual({
    error: { code: "CARD_UNRECOGNIZED" },
  });
  expect(f.egress.records).toHaveLength(0);
  expect(await f.history(invalid.instanceId)).toEqual([]);
});
