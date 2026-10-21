import { create } from "zustand";
import type { AgentConfig, AgentModel } from "../../modules/agents/contract";

/**
 * The Agent being put together in the add dialog. It outlives the dialog,
 * so a detour to add a model connection keeps what was entered; `model`
 * stays unset until chosen and then follows the default.
 */
export type AgentDraft = {
  name: string;
  description: string;
  /** Picture from an imported role card. */
  avatar?: string;
  model?: AgentModel | null;
  /** Parts such as the provider or a model connection switched off. */
  off: string[];
};

const empty: AgentDraft = { name: "", description: "", off: [] };

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
        avatar: card.avatar,
      }),
    }),
}));
