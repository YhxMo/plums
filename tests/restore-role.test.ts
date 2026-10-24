import { expect, it } from "vitest";
import { AgentStore } from "../modules/agents/store";
import { restoreAgents } from "../modules/agents/validation";

async function savedConversation() {
  const store = new AgentStore(
    [],
    async () => {},
    async () => "reply",
  );
  const agent = await store.create({ name: "restore-role" });
  await store.send(agent.id, "question");
  return JSON.parse(JSON.stringify(store.list()));
}

it.each(
  [["user"], ["agent"], {}, null, 42, "system"].map((role) => ({ role })),
)(
  "rejects an invalid persisted role without mutating the source: %j",
  async ({ role }) => {
    const saved = await savedConversation();
    saved[0].sessions[0].messages[0].role = role;
    const before = JSON.stringify(saved);
    expect(() => restoreAgents(saved)).toThrow("会话配置损坏");
    expect(JSON.stringify(saved)).toBe(before);
  },
);

it("restores both string roles with their original attribution", async () => {
  const saved = await savedConversation();
  const restored = restoreAgents(saved);
  expect(restored[0].sessions[0].messages.map((m) => m.role)).toEqual([
    "user",
    "agent",
  ]);
  expect(restored[0].sessions[0].messages.map((m) => m.text)).toEqual([
    "question",
    "reply",
  ]);
  expect(restored).not.toBe(saved);
});
