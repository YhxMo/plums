import { expect, it } from "vitest";
import { fromBase64, pngTextChunks } from "../modules/agents/card-png";
import { roleCardJson, withRoleCard } from "../modules/agents/card-export";
import { readRoleCardFile } from "../modules/agents/role-card";
import { parseRoleCard } from "../modules/agents/validation";
import { tinyPng } from "./fixtures/tiny-png";

const agent = {
  name: "写作助手",
  description: "帮你改稿、润色和整理结构。",
  instructions: "简洁、友好地回答用户的问题。",
  model: { provider: "connector.models", model: "deepseek-flash" },
  off: ["memory.local"],
};

it("writes a Character Card V2: 设定 as description, 介绍 as creator notes, Plums' own fields kept", () => {
  const card = roleCardJson(agent);
  expect(card).toMatchObject({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: "写作助手",
      description: "简洁、友好地回答用户的问题。",
      creator_notes: "帮你改稿、润色和整理结构。",
      extensions: {
        plums: {
          version: 1,
          instructions: "简洁、友好地回答用户的问题。",
          description: "帮你改稿、润色和整理结构。",
        },
      },
    },
  });
  // A tavern reads every V2 field it expects.
  for (const field of [
    "personality",
    "scenario",
    "first_mes",
    "mes_example",
    "system_prompt",
    "post_history_instructions",
    "creator",
    "character_version",
  ])
    expect(card.data[field as keyof typeof card.data], field).toBe("");
  expect(card.data.alternate_greetings).toEqual([]);
  expect(card.data.tags).toEqual([]);
  // Memory, conversations, the model and switched-off parts stay behind.
  const text = JSON.stringify(card);
  for (const kept of ["deepseek", "connector.models", "memory.local"])
    expect(text).not.toContain(kept);
});

it("round-trips through a picture card: name, 设定 and 介绍 come back unchanged", async () => {
  const png = withRoleCard(tinyPng(), agent);
  const chunk = pngTextChunks(png).get("chara")!;
  expect(JSON.parse(fromBase64(chunk)).spec).toBe("chara_card_v2");
  const read = await readRoleCardFile(new Blob([png], { type: "image/png" }));
  expect(read.picture).toBeInstanceOf(Blob);
  expect(parseRoleCard(read.text)).toEqual({
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
  });
});

it("keeps an Agent without 设定 without one", async () => {
  const png = withRoleCard(tinyPng(), { ...agent, instructions: undefined });
  const read = await readRoleCardFile(new Blob([png]));
  expect(parseRoleCard(read.text).instructions).toBe("");
});
