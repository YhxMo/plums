import type { Effort } from "../../extensions/contracts";
import type { Endpoint, Protocol } from "./protocols";

/**
 * Thinking strengths follow what each service's own documentation confirms
 * (Anthropic's thinking and effort pages, DeepSeek's thinking-mode guide,
 * OpenAI's reasoning models); anything unconfirmed lists none, so Agents show
 * no control rather than one that may be refused.
 */
type Style = "adaptive" | "budget" | "deepseek" | "openai";

const claude =
  /(?:^|[^a-z])claude-(?:(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?|(\d+)-(\d+)-(?:opus|sonnet|haiku))/;

function style(
  protocol: Protocol,
  preset: string | undefined,
  model: string,
): Style | undefined {
  const name = model.toLowerCase();
  if (protocol === "anthropic-messages") {
    const found = claude.exec(name);
    if (!found) return undefined;
    // `claude-opus-4-6`, or the older `claude-3-7-sonnet` order.
    const [major, minor] = found[1]
      ? [Number(found[1]), Number(found[2] ?? 0)]
      : [Number(found[3]), Number(found[4])];
    // 4.6 and later think adaptively and reject a budget from 4.7 on; 4.5 and
    // earlier only take a budget. Claude 3.7 Sonnet is the one older model with it.
    if (major >= 5 || (major === 4 && minor >= 6)) return "adaptive";
    if (major === 4 || (major === 3 && minor === 7 && /sonnet/.test(name)))
      return "budget";
    return undefined;
  }
  if (preset === "deepseek") return "deepseek";
  if (preset === "openai" && /(?:^|\/)(?:o\d|gpt-5(?!.*chat))/.test(name))
    return "openai";
  return undefined;
}

const levels: Record<Style, readonly Effort[]> = {
  // Always thinks, so there is no "off"; `max` exists on every such model.
  adaptive: ["low", "medium", "high", "max"],
  budget: ["off", "low", "medium", "high", "max"],
  deepseek: ["off", "low", "high", "max"],
  openai: ["low", "medium", "high"],
};

/** The strengths a model takes, or undefined when none is confirmed. */
export function reasoningLevels(
  protocol: Protocol,
  preset: string | undefined,
  model: string,
): readonly Effort[] | undefined {
  const found = style(protocol, preset, model);
  return found && levels[found];
}

/** Thinking tokens for each strength on a model that takes a budget. */
const budgets = { low: 2_000, medium: 8_000, high: 16_000, max: 24_000 };
/** Anthropic's minimum budget, and the reply room kept beneath `max_tokens`. */
const MIN_BUDGET = 1024;
const REPLY_FLOOR = 4096;

/**
 * Request fields for the chosen strength; none when it is unset or the model
 * does not list it. `room` is the request's `max_tokens`, which a budget must
 * stay clear of.
 */
export function reasoningFields(
  endpoint: Pick<Endpoint, "protocol" | "preset" | "model">,
  effort: Effort | undefined,
  room: number,
): Record<string, unknown> {
  const { protocol, preset, model } = endpoint;
  const found = style(protocol, preset, model);
  if (!effort || !found || !levels[found].includes(effort)) return {};
  switch (found) {
    case "adaptive":
      return {
        thinking: { type: "adaptive" },
        output_config: { effort },
      };
    case "budget": {
      if (effort === "off") return {};
      const budget = Math.min(budgets[effort], room - REPLY_FLOOR);
      return budget < MIN_BUDGET
        ? {}
        : { thinking: { type: "enabled", budget_tokens: budget } };
    }
    case "deepseek":
      return effort === "off"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled" }, reasoning_effort: effort };
    case "openai":
      return { reasoning_effort: effort };
  }
}
