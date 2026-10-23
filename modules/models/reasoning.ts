import type { Effort } from "../../extensions/contracts";
export type { Effort };
import type { Endpoint, Protocol } from "./protocols";

/**
 * Thinking strengths follow what each service's own documentation confirms
 * (Anthropic's thinking and effort pages, DeepSeek's thinking-mode guide,
 * OpenAI's reasoning models); anything unconfirmed lists none, so Agents show
 * no control rather than one that may be refused.
 */
type Style = "adaptive" | "budget" | "deepseek" | "openai";
/**
 * What a user may pick for one model: a way of thinking, or `none` to offer
 * no control. It replaces the rules below, so any service and model can be
 * given a control; unset follows the rules.
 */
export type ThinkMode = Style | "none";
/** Each way and the API format it is written for. */
export const THINK_STYLES: Record<Style, Protocol> = {
  adaptive: "anthropic-messages",
  budget: "anthropic-messages",
  deepseek: "openai-chat",
  openai: "openai-chat",
};
export const isThinkMode = (value: unknown): value is ThinkMode =>
  value === "none" ||
  (typeof value === "string" && Object.hasOwn(THINK_STYLES, value));

const claude =
  /(?:^|[^a-z])claude-(?:(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?|(\d+)-(\d+)-(?:opus|sonnet|haiku))/;

function style(
  protocol: Protocol,
  preset: string | undefined,
  model: string,
  mode?: ThinkMode,
): Style | undefined {
  // A pick for the other API format cannot be sent, so the rules decide.
  if (mode === "none") return undefined;
  if (mode && THINK_STYLES[mode] === protocol) return mode;
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

/** The strengths a way of thinking takes. */
export const levelsOf = (way: Style) => levels[way];

/** The strengths a model takes, or undefined when none is confirmed or chosen. */
export function reasoningLevels(
  protocol: Protocol,
  preset: string | undefined,
  model: string,
  mode?: ThinkMode,
): readonly Effort[] | undefined {
  const found = style(protocol, preset, model, mode);
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
  endpoint: Pick<Endpoint, "protocol" | "preset" | "model" | "thinking">,
  effort: Effort | undefined,
  room: number,
): Record<string, unknown> {
  const { protocol, preset, model, thinking } = endpoint;
  const found = style(protocol, preset, model, thinking);
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
