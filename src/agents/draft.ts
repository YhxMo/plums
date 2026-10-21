import { create } from "zustand";
import type { AgentConfig, AgentModel } from "../../modules/agents/contract";

/**
 * The Agent being put together in the add dialog. It outlives the dialog,
 * so a detour to add a model connection keeps what was entered; `model`
 * and `extensions` stay unset until chosen and then follow the defaults.
 */
export type AgentDraft = {
  name: string;
  description: string;
  multiSession: boolean;
  model?: AgentModel | null;
  extensions?: string[];
  /** Parts such as the provider or a model connection switched off. */
  off: string[];
};

const empty: AgentDraft = {
  name: "",
  description: "",
  multiSession: false,
  off: [],
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
      extensions: undefined,
      ...(card && {
        name: card.name,
        description: card.description ?? "",
        multiSession: card.multiSession ?? false,
      }),
    }),
}));
