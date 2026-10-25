import type { Agent } from "./contract";
import { toBase64, withPngText } from "./card-png";

/**
 * An Agent as a Character Card V2, the format taverns read: its 设定 as the
 * description and its 介绍 as the creator notes, with Plums' own fields in
 * `extensions.plums`. Memory, conversations, the model and its parts stay
 * behind: a card says who the Agent is, not what it knows or uses.
 */
export function roleCardJson(
  agent: Pick<Agent, "name" | "description" | "instructions">,
) {
  const instructions = agent.instructions ?? "";
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: agent.name,
      description: instructions,
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: agent.description,
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [] as string[],
      tags: [] as string[],
      creator: "",
      character_version: "",
      extensions: {
        plums: { version: 1, instructions, description: agent.description },
      },
    },
  };
}

/** The picture with the Agent's card in its `chara` chunk. */
export const withRoleCard = (
  png: Uint8Array,
  agent: Pick<Agent, "name" | "description" | "instructions">,
) => withPngText(png, { chara: toBase64(JSON.stringify(roleCardJson(agent))) });
