import { create } from "zustand";
import type { AgentConfig, AgentModel } from "@modules/agents/contract";
import { DEFAULT_INSTRUCTIONS } from "@modules/agents/instructions";

/**
 * The Agent being put together in the add dialog. It outlives the dialog,
 * so a detour to add a model connection keeps what was entered; `model`
 * stays unset until chosen and then follows the default.
 */
export type AgentDraft = {
  name: string;
  description: string;
  /** Starts as the default 设定, or a card's own, or a card's introduction when it has none. */
  instructions: string;
  /** Picture from an imported role card. */
  avatar?: string;
  model?: AgentModel | null;
  /** Parts such as the provider or a model connection switched off. */
  off: string[];
  /** Why parts an imported bundle lists stay off here. */
  notes: { id: string; text: string }[];
};

const empty: AgentDraft = {
  name: "",
  description: "",
  instructions: DEFAULT_INSTRUCTIONS,
  off: [],
  notes: [],
};

export const useAgentDraft = create<
  AgentDraft & {
    change(value: Partial<AgentDraft>): void;
    /** Starts over, optionally from a role card's fields. */
    reset(card?: AgentConfig): void;
  }
>((set) => ({
  ...empty,
  change: (value) => set(value),
  reset: (card) =>
    set({
      ...empty,
      model: undefined,
      ...(card && {
        name: card.name,
        description: card.description ?? "",
        instructions: card.instructions ?? card.description ?? "",
        avatar: card.avatar,
      }),
    }),
}));
